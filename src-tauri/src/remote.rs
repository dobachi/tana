//! リモート接続 (FR-20)。ssh 越しの SFTP で他のマシンのファイルを扱う。
//!
//! アプリ内ではリモートの場所を `sftp://HOST/絶対パス` という文字列で表す
//! （HOST は ssh に渡す接続先。`~/.ssh/config` の Host 名や `user@host`）。
//! 接続は最初に使ったときに `ssh -s HOST sftp` を起動して張り、以後は使い回す。
//! 回線が切れていたら次の読み取りで一度だけ張り直す。
//!
//! 接続ごとに「書き込みを許可」するかを持ち、既定は**閲覧のみ**。書き込み系の
//! 操作は許可されるまで `READ_ONLY` で断る（安全モードとは独立した二重のゲート）。
//!
//! パス・ssh 設定の解釈は純粋関数、接続の生成は `Connector` として注入する
//! （テストではローカルの sftp-server に繋ぐ）。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;

use crate::sftp::{self, Client};
use crate::DirEntry;

pub const SCHEME: &str = "sftp://";

// ───────────────────────── 純粋: パス ─────────────────────────

/// リモートの場所（接続先 + 絶対パス）。
#[derive(Debug, Clone, PartialEq)]
pub struct RemotePath {
    pub host: String,
    /// 相手側の POSIX パス。空はホーム（未解決）。
    pub path: String,
}

impl RemotePath {
    pub fn to_uri(&self) -> String {
        format_uri(&self.host, &self.path)
    }
}

/// `sftp://HOST/path` を分解する。リモートでない・接続先が不正なら None。
pub fn parse_uri(s: &str) -> Option<RemotePath> {
    let rest = s.strip_prefix(SCHEME)?;
    let (host, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    if !valid_host(host) {
        return None;
    }
    Some(RemotePath {
        host: host.to_string(),
        path: path.to_string(),
    })
}

/// 接続先とパスから `sftp://HOST/path` を作る。
pub fn format_uri(host: &str, path: &str) -> String {
    if path.is_empty() || path.starts_with('/') {
        format!("{}{}{}", SCHEME, host, path)
    } else {
        format!("{}{}/{}", SCHEME, host, path)
    }
}

/// ssh に渡してよい接続先か。`-` 始まり（ssh のオプションとして読まれる）や
/// 空白・制御文字・パス区切りを含むものは拒む。
pub fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 255
        && !host.starts_with('-')
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-@:[]%".contains(c))
}

/// POSIX パスの親（ルートは None）。
pub fn parent_of(path: &str) -> Option<String> {
    let p = path.trim_end_matches('/');
    if p.is_empty() {
        return None;
    }
    match p.rfind('/') {
        Some(0) => Some("/".to_string()),
        Some(i) => Some(p[..i].to_string()),
        None => None,
    }
}

/// POSIX パスの末尾の名前。
pub fn base_name(path: &str) -> &str {
    let p = path.trim_end_matches('/');
    p.rsplit('/').next().unwrap_or(p)
}

/// 単一の名前として使えるか（区切りや `.`/`..` を含まない）。
pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains('/') && !name.contains('\0')
}

/// 衝突しない名前を `exists` で問い合わせながら探す（"a (1).txt", "a (2).txt" …）。
/// ローカルの `unique_target_name` と同じ規則。
pub fn unique_with(
    name: &str,
    mut exists: impl FnMut(&str) -> Result<bool, String>,
) -> Result<String, String> {
    if !exists(name)? {
        return Ok(name.to_string());
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for i in 1..10_000 {
        let candidate = format!("{} ({}){}", stem, i, ext);
        if !exists(&candidate)? {
            return Ok(candidate);
        }
    }
    Err("空いている名前が見つかりません".into())
}

// ───────────────────────── 純粋: ~/.ssh/config ─────────────────────────

/// `~/.ssh/config` の本文から、接続先として選べる Host 名を取り出す。
/// ワイルドカード（`*` `?`）や否定（`!`）を含むパターンは除く。重複は先勝ち。
pub fn ssh_config_hosts(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        let mut words = line.split(|c: char| c.is_whitespace() || c == '=');
        let Some(key) = words.next() else { continue };
        if !key.eq_ignore_ascii_case("host") {
            continue;
        }
        for w in words.filter(|w| !w.is_empty()) {
            let w = w.trim_matches('"');
            if w.contains(['*', '?', '!']) || !valid_host(w) {
                continue;
            }
            if !out.iter().any(|h| h == w) {
                out.push(w.to_string());
            }
        }
    }
    out
}

/// ssh の失敗出力から、人に見せる 1 行を取り出す（警告行は飛ばす）。
pub fn ssh_error_line(stderr: &str) -> Option<String> {
    stderr
        .lines()
        .map(str::trim)
        .rfind(|l| !l.is_empty() && !l.starts_with("Warning:"))
        .map(str::to_string)
}

// ───────────────────────── 接続 ─────────────────────────

type Io = Client<Box<dyn Read + Send>, Box<dyn Write + Send>>;

/// 張った接続 1 本。落とすと相手側のプロセスも終わる。
pub struct Session {
    client: Io,
    child: Option<std::process::Child>,
}

impl Session {
    pub fn new(
        reader: Box<dyn Read + Send>,
        writer: Box<dyn Write + Send>,
        child: Option<std::process::Child>,
    ) -> Result<Self, sftp::Error> {
        Ok(Session {
            client: Client::handshake(reader, writer)?,
            child,
        })
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if let Some(c) = self.child.as_mut() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

/// 接続先名から Session を作る関数（本番は ssh、テストはローカルの sftp-server）。
/// 第 2 引数は「未登録のホスト鍵を登録してよいか」（利用者が確認したときだけ true）。
pub type Connector = Arc<dyn Fn(&str, bool) -> Result<Session, String> + Send + Sync>;

/// アプリ全体の接続表。Tauri の State として持ち、ワーカースレッドへ複製して渡す。
#[derive(Clone)]
pub struct RemoteState {
    inner: Arc<Inner>,
}

struct Inner {
    connector: Connector,
    sessions: Mutex<HashMap<String, Arc<Mutex<Session>>>>,
    /// 書き込みを許可した接続先（再接続しても保つ。アプリを終えると忘れる）。
    writable: Mutex<HashMap<String, bool>>,
    /// 接続先ごとのホーム（`sftp://HOST` だけを開いたときの行き先）。
    homes: Mutex<HashMap<String, String>>,
    /// ホスト鍵が未登録でも登録して繋いでよいと利用者が確認した接続先。
    trusted: Mutex<std::collections::HashSet<String>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Default for RemoteState {
    fn default() -> Self {
        RemoteState::with_connector(Arc::new(ssh_connect))
    }
}

/// 接続の一覧表示用。
#[derive(Debug, Serialize, PartialEq)]
pub struct SessionInfo {
    pub host: String,
    pub writable: bool,
    pub home: Option<String>,
}

impl RemoteState {
    pub fn with_connector(connector: Connector) -> Self {
        RemoteState {
            inner: Arc::new(Inner {
                connector,
                sessions: Mutex::new(HashMap::new()),
                writable: Mutex::new(HashMap::new()),
                homes: Mutex::new(HashMap::new()),
                trusted: Mutex::new(Default::default()),
            }),
        }
    }

    fn session(&self, host: &str) -> Result<Arc<Mutex<Session>>, String> {
        if let Some(s) = lock(&self.inner.sessions).get(host) {
            return Ok(s.clone());
        }
        // 接続中は表を握らない（他の接続先の操作を止めないため）
        let trust = lock(&self.inner.trusted).contains(host);
        let s = Arc::new(Mutex::new((self.inner.connector)(host, trust)?));
        let mut map = lock(&self.inner.sessions);
        Ok(map.entry(host.to_string()).or_insert(s).clone())
    }

    fn drop_session(&self, host: &str) {
        lock(&self.inner.sessions).remove(host);
    }

    /// 接続を使って `f` を実行する。通信路の失敗なら接続を捨て、`retry` のときだけ
    /// 一度張り直してやり直す（書き込みは二重に実行しないよう retry しない）。
    fn with<T>(
        &self,
        host: &str,
        retry: bool,
        mut f: impl FnMut(&mut Io) -> Result<T, sftp::Error>,
    ) -> Result<T, String> {
        let mut attempt = 0;
        loop {
            let s = self.session(host)?;
            let result = {
                let mut g = lock(&s);
                f(&mut g.client)
            };
            match result {
                Ok(v) => return Ok(v),
                Err(e) if e.is_connection() => {
                    self.drop_session(host);
                    attempt += 1;
                    if !retry || attempt > 1 {
                        return Err(format!("{} との接続が切れました（{}）", host, e));
                    }
                }
                Err(e) => return Err(e.to_string()),
            }
        }
    }

    /// 未登録のホスト鍵を登録して繋ぐことを許す（利用者の確認後に呼ぶ）。
    pub fn trust_host(&self, host: &str) {
        lock(&self.inner.trusted).insert(host.to_string());
    }

    pub fn is_writable(&self, host: &str) -> bool {
        lock(&self.inner.writable)
            .get(host)
            .copied()
            .unwrap_or(false)
    }

    pub fn set_writable(&self, host: &str, writable: bool) {
        lock(&self.inner.writable).insert(host.to_string(), writable);
    }

    fn ensure_writable(&self, host: &str) -> Result<(), String> {
        if self.is_writable(host) {
            Ok(())
        } else {
            Err(format!("READ_ONLY:{}", host))
        }
    }

    /// 接続してホームを返す（`sftp://HOST/home/you`）。
    pub fn connect(&self, host: &str) -> Result<String, String> {
        if !valid_host(host) {
            return Err(format!("接続先が不正です: {}", host));
        }
        let home = self.with(host, true, |c| c.realpath("."))?;
        lock(&self.inner.homes).insert(host.to_string(), home.clone());
        Ok(format_uri(host, &home))
    }

    pub fn disconnect(&self, host: &str) {
        self.drop_session(host);
        lock(&self.inner.homes).remove(host);
    }

    pub fn sessions(&self) -> Vec<SessionInfo> {
        let homes = lock(&self.inner.homes).clone();
        let mut hosts: Vec<String> = lock(&self.inner.sessions).keys().cloned().collect();
        hosts.sort();
        hosts
            .into_iter()
            .map(|h| SessionInfo {
                writable: self.is_writable(&h),
                home: homes.get(&h).map(|p| format_uri(&h, p)),
                host: h,
            })
            .collect()
    }

    /// `sftp://HOST`・`sftp://HOST/~/x` のような入力を絶対パスの URI に直す。
    pub fn resolve(&self, uri: &str) -> Result<String, String> {
        let rp = parse_uri(uri).ok_or_else(|| format!("リモートの場所ではありません: {}", uri))?;
        let rel = match rp.path.as_str() {
            "" | "/~" | "/~/" => ".".to_string(),
            p if p.starts_with("/~/") => p[3..].to_string(), // 相手のホーム基準
            p => p.to_string(),
        };
        let abs = self.with(&rp.host, true, |c| c.realpath(&rel))?;
        Ok(format_uri(&rp.host, &abs))
    }

    pub fn list_dir(&self, uri: &str) -> Result<Vec<DirEntry>, String> {
        let rp = parse_uri(uri).ok_or_else(|| format!("リモートの場所ではありません: {}", uri))?;
        let dir = rp.path.clone();
        let host = rp.host.clone();
        let names = self
            .with(&host, true, |c| {
                let mut names = c.read_dir(&dir)?;
                // リンクは辿った先で判定する（フォルダへのリンクを開けるように）
                for n in names.iter_mut().filter(|n| n.attrs.is_symlink()) {
                    if let Ok(a) = c.stat(&sftp::join(&dir, &n.name)) {
                        n.attrs = a;
                    }
                }
                Ok(names)
            })
            .map_err(|e| format!("{}: {}", uri, e))?;
        Ok(entries_from(&host, &dir, names))
    }

    pub fn dir_signature(&self, uri: &str) -> u64 {
        self.list_dir(uri)
            .map(|e| crate::fold_signature(&e))
            .unwrap_or(0)
    }

    pub fn read_preview(&self, uri: &str, max_bytes: usize) -> Result<crate::PreviewData, String> {
        let rp = parse_uri(uri).ok_or("リモートの場所ではありません")?;
        let limit = crate::clamp_max_bytes(max_bytes) as u64;
        self.with(&rp.host, true, |c| {
            let a = c.stat(&rp.path)?;
            if a.is_dir() {
                return Err(sftp::Error {
                    code: Some(4),
                    message: "ディレクトリはプレビューできません".into(),
                });
            }
            if !a.is_file() {
                // FIFO/デバイス等は読まない（ローカルの read_preview と同じ）
                return Err(sftp::Error {
                    code: Some(4),
                    message: "通常ファイルではありません".into(),
                });
            }
            let mut buf = Vec::new();
            if a.size != Some(0) {
                c.read_to(&rp.path, Some(limit), &mut |d| {
                    buf.extend_from_slice(d);
                    Ok(())
                })?;
            }
            Ok(crate::preview_from_buf(
                a.size.unwrap_or(buf.len() as u64),
                buf,
            ))
        })
    }

    /// 手元の一時フォルダへ落として、そのパスを返す（既定アプリで開く・画像プレビュー用）。
    /// 同じ場所・大きさ・更新時刻のものが既にあれば取り直さない。
    pub fn fetch(&self, uri: &str, cache_root: &Path) -> Result<String, String> {
        let rp = parse_uri(uri).ok_or("リモートの場所ではありません")?;
        let local = cache_path(cache_root, &rp);
        let attrs = self.with(&rp.host, true, |c| c.stat(&rp.path))?;
        if attrs.is_dir() {
            return Err("フォルダは開けません".into());
        }
        if fresh(&local, &attrs) {
            return Ok(local.to_string_lossy().to_string());
        }
        if let Some(parent) = local.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        self.download(&rp, &local)?;
        if let Some(m) = attrs.mtime {
            let t = std::time::UNIX_EPOCH + std::time::Duration::from_secs(m);
            if let Ok(f) = std::fs::File::options().write(true).open(&local) {
                let _ = f.set_modified(t);
            }
        }
        Ok(local.to_string_lossy().to_string())
    }

    fn exists(&self, loc: &Loc) -> Result<bool, String> {
        match loc {
            Loc::Local(p) => Ok(p.exists()),
            Loc::Remote(rp) => self.with(&rp.host, true, |c| c.exists(&rp.path)),
        }
    }

    pub fn unique_name(&self, dest_dir: &str, name: &str) -> Result<String, String> {
        let dir = Loc::parse(dest_dir);
        unique_with(name, |n| self.exists(&dir.child(n)))
    }

    /// `src` を `dest_dir` 配下へコピーする（どちらか一方以上がリモート）。
    /// 衝突の扱いはローカルの copy_path と同じ（既存で overwrite=false なら "EXISTS"）。
    pub fn copy(
        &self,
        src: &str,
        dest_dir: &str,
        dest_name: Option<&str>,
        overwrite: bool,
    ) -> Result<String, String> {
        let (from, to) = self.prepare_target(src, dest_dir, dest_name, overwrite, "コピー")?;
        self.transfer(&from, &to)?;
        Ok(to.to_string())
    }

    /// `src` を `dest_dir` 配下へ移動する。同じ接続先どうしは改名、それ以外は複製して消す。
    pub fn move_to(
        &self,
        src: &str,
        dest_dir: &str,
        dest_name: Option<&str>,
        overwrite: bool,
    ) -> Result<String, String> {
        let from = Loc::parse(src);
        if let Loc::Remote(rp) = &from {
            self.ensure_writable(&rp.host)?; // 元を消すので元側にも許可が要る
        }
        let (from, to) = self.prepare_target(src, dest_dir, dest_name, overwrite, "移動")?;
        match (&from, &to) {
            (Loc::Remote(a), Loc::Remote(b)) if a.host == b.host => {
                self.with(&a.host, false, |c| c.rename(&a.path, &b.path))?;
            }
            _ => {
                self.transfer(&from, &to)?;
                self.remove(&from)?;
            }
        }
        Ok(to.to_string())
    }

    /// 宛先を決め、衝突を確かめ、上書きなら既存を消す（コピー/移動の共通前処理）。
    fn prepare_target(
        &self,
        src: &str,
        dest_dir: &str,
        dest_name: Option<&str>,
        overwrite: bool,
        verb: &str,
    ) -> Result<(Loc, Loc), String> {
        let from = Loc::parse(src);
        let dir = Loc::parse(dest_dir);
        if let Loc::Remote(rp) = &dir {
            self.ensure_writable(&rp.host)?;
        }
        let name = match dest_name {
            Some(n) => n.to_string(),
            None => from.name(),
        };
        if !valid_name(&name) {
            return Err(format!("{}元が不正です", verb));
        }
        let to = dir.child(&name);
        let same = to == from;
        if same && overwrite {
            return Err(format!(
                "同じ場所へは{}できません。名前を変えてください",
                verb
            ));
        }
        let exists = self.exists(&to)?;
        if (exists || same) && !overwrite {
            return Err("EXISTS".into());
        }
        if exists {
            self.remove(&to)?;
        }
        Ok((from, to))
    }

    /// 中身ごと複製する。リモート→リモートは手元の一時フォルダを経由する。
    fn transfer(&self, from: &Loc, to: &Loc) -> Result<(), String> {
        match (from, to) {
            (Loc::Local(a), Loc::Local(b)) => {
                Err(format!("ローカル同士は対象外です: {:?} → {:?}", a, b))
            }
            (Loc::Local(a), Loc::Remote(b)) => self.upload(a, b),
            (Loc::Remote(a), Loc::Local(b)) => self.download(a, b),
            (Loc::Remote(a), Loc::Remote(b)) => {
                let tmp = scratch_dir()?;
                let local = tmp.join(base_name(&a.path));
                let r = self
                    .download(a, &local)
                    .and_then(|_| self.upload(&local, b));
                let _ = std::fs::remove_dir_all(&tmp);
                r
            }
        }
    }

    fn download(&self, from: &RemotePath, to: &Path) -> Result<(), String> {
        self.with(&from.host, true, |c| download_tree(c, &from.path, to))
    }

    fn upload(&self, from: &Path, to: &RemotePath) -> Result<(), String> {
        self.with(&to.host, false, |c| upload_tree(c, from, &to.path))
    }

    fn remove(&self, loc: &Loc) -> Result<(), String> {
        match loc {
            Loc::Local(p) => if p.is_dir() {
                std::fs::remove_dir_all(p)
            } else {
                std::fs::remove_file(p)
            }
            .map_err(|e| e.to_string()),
            Loc::Remote(rp) => {
                self.ensure_writable(&rp.host)?;
                self.with(&rp.host, false, |c| c.remove_all(&rp.path))
            }
        }
    }

    /// 完全に削除する（リモートにゴミ箱は無い）。
    pub fn delete(&self, uri: &str) -> Result<(), String> {
        let rp = parse_uri(uri).ok_or("リモートの場所ではありません")?;
        if rp.path.is_empty() || rp.path == "/" {
            return Err("ルートは削除できません".into());
        }
        self.remove(&Loc::Remote(rp))
    }

    pub fn rename(&self, uri: &str, new_name: &str) -> Result<String, String> {
        let rp = parse_uri(uri).ok_or("リモートの場所ではありません")?;
        self.ensure_writable(&rp.host)?;
        if !valid_name(new_name) {
            return Err("名前が不正です".into());
        }
        let parent = parent_of(&rp.path).ok_or("親ディレクトリがありません")?;
        let target = sftp::join(&parent, new_name);
        if target == rp.path {
            return Ok(rp.to_uri());
        }
        self.with(&rp.host, false, |c| {
            if c.exists(&target)? {
                return Err(sftp::Error {
                    code: Some(4),
                    message: "EXISTS".into(),
                });
            }
            c.rename(&rp.path, &target)
        })?;
        Ok(format_uri(&rp.host, &target))
    }

    pub fn make_dir(&self, parent: &str, name: &str) -> Result<String, String> {
        let rp = parse_uri(parent).ok_or("リモートの場所ではありません")?;
        self.ensure_writable(&rp.host)?;
        if !valid_name(name) {
            return Err("名前が不正です".into());
        }
        let target = sftp::join(&rp.path, name);
        self.with(&rp.host, false, |c| {
            if c.exists(&target)? {
                return Err(sftp::Error {
                    code: Some(4),
                    message: "EXISTS".into(),
                });
            }
            c.mkdir(&target)
        })?;
        Ok(format_uri(&rp.host, &target))
    }
}

/// ローカルかリモートかの場所。
#[derive(Debug, Clone, PartialEq)]
enum Loc {
    Local(PathBuf),
    Remote(RemotePath),
}

impl Loc {
    fn parse(s: &str) -> Loc {
        match parse_uri(s) {
            Some(rp) => Loc::Remote(rp),
            None => Loc::Local(PathBuf::from(s)),
        }
    }
    fn child(&self, name: &str) -> Loc {
        match self {
            Loc::Local(p) => Loc::Local(p.join(name)),
            Loc::Remote(rp) => Loc::Remote(RemotePath {
                host: rp.host.clone(),
                path: sftp::join(&rp.path, name),
            }),
        }
    }
    fn name(&self) -> String {
        match self {
            Loc::Local(p) => p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            Loc::Remote(rp) => base_name(&rp.path).to_string(),
        }
    }
}

impl std::fmt::Display for Loc {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Loc::Local(p) => write!(f, "{}", p.to_string_lossy()),
            Loc::Remote(rp) => f.write_str(&rp.to_uri()),
        }
    }
}

/// SFTP のエントリ群を一覧用の DirEntry へ（フォルダ優先 → 名前順）。純粋。
pub fn entries_from(host: &str, dir: &str, names: Vec<sftp::Name>) -> Vec<DirEntry> {
    let mut entries: Vec<DirEntry> = names
        .into_iter()
        .map(|n| DirEntry {
            path: format_uri(host, &sftp::join(dir, &n.name)),
            is_dir: n.attrs.is_dir(),
            size: n.attrs.size.unwrap_or(0),
            is_hidden: n.name.starts_with('.'),
            modified: n.attrs.mtime,
            name: n.name,
        })
        .collect();
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    entries
}

/// キャッシュ上の置き場所: `<root>/<host>/<相手の絶対パス>`。名前を保つので
/// 既定アプリが拡張子で判断できる。`..` 等は落として root の外に出さない。
pub fn cache_path(root: &Path, rp: &RemotePath) -> PathBuf {
    let mut p = root.join(rp.host.replace([':', '@', '[', ']', '%'], "_"));
    for seg in rp.path.split('/') {
        if seg.is_empty() || seg == "." || seg == ".." {
            continue;
        }
        p.push(seg);
    }
    p
}

/// 手元の写しが相手と同じ（大きさと更新時刻が一致）か。
fn fresh(local: &Path, attrs: &sftp::Attrs) -> bool {
    let Ok(meta) = std::fs::metadata(local) else {
        return false;
    };
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    attrs.size == Some(meta.len()) && attrs.mtime.is_some() && attrs.mtime == mtime
}

fn scratch_dir() -> Result<PathBuf, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("tana-xfer-{}-{}", std::process::id(), nanos));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn download_tree(c: &mut Io, from: &str, to: &Path) -> Result<(), sftp::Error> {
    let a = c.stat(from)?;
    if a.is_dir() {
        std::fs::create_dir_all(to)?;
        for n in c.read_dir(from)? {
            download_tree(c, &sftp::join(from, &n.name), &to.join(&n.name))?;
        }
        return Ok(());
    }
    let mut f = std::fs::File::create(to)?;
    c.read_to(from, None, &mut |d| f.write_all(d))?;
    Ok(())
}

fn upload_tree(c: &mut Io, from: &Path, to: &str) -> Result<(), sftp::Error> {
    if from.is_dir() {
        c.mkdir(to)?;
        for e in std::fs::read_dir(from)? {
            let e = e?;
            let name = e.file_name().to_string_lossy().to_string();
            upload_tree(c, &e.path(), &sftp::join(to, &name))?;
        }
        return Ok(());
    }
    let mut f = std::fs::File::open(from)?;
    c.write_from(to, true, &mut f)?;
    Ok(())
}

// ───────────────────────── ssh の起動 ─────────────────────────

/// ssh に渡す引数（純粋）。パスワード等の対話はできないので BatchMode。
/// 生存確認で、スリープや回線断に 1 分以内に気づく。
/// ~/.ssh/config の転送（Fude の RemoteForward 等）は張らず、接続共有の親にもならない
/// （Tana が切断したときに、相乗りしている他の ssh まで道連れにしないため）。
/// `accept_new` は利用者が確認したときだけ: 未登録の鍵は登録、**変わった鍵は従来どおり拒否**。
pub fn ssh_args(host: &str, accept_new: bool) -> Vec<String> {
    let mut v: Vec<&str> = vec![
        "-o",
        "BatchMode=yes",
        "-o",
        "ClearAllForwardings=yes",
        "-o",
        "ControlMaster=no",
    ];
    if accept_new {
        v.extend(["-o", "StrictHostKeyChecking=accept-new"]);
    }
    v.extend([
        "-o",
        "ConnectTimeout=15",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=3",
        "-s",
        "--",
        host,
        "sftp",
    ]);
    v.into_iter().map(str::to_string).collect()
}

/// ssh の失敗がホスト鍵の未登録（初めての相手）によるものか。鍵が変わった場合
/// （なりすましの疑い）は含めない。
pub fn is_unknown_host_key(stderr: &str) -> bool {
    stderr.contains("Host key verification failed")
        && !stderr.contains("REMOTE HOST IDENTIFICATION HAS CHANGED")
}

fn ssh_connect(host: &str, accept_new: bool) -> Result<Session, String> {
    use std::process::{Command, Stdio};
    if !valid_host(host) {
        return Err(format!("接続先が不正です: {}", host));
    }
    let mut cmd = Command::new("ssh");
    cmd.args(ssh_args(host, accept_new))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("ssh を起動できません（{}）", e))?;
    let out = child.stdout.take().ok_or("ssh の出力を取れません")?;
    let inp = child.stdin.take().ok_or("ssh の入力を取れません")?;
    // 失敗理由（認証・名前解決など）を拾うため stderr を溜めておく
    let err_buf = Arc::new(Mutex::new(String::new()));
    if let Some(mut stderr) = child.stderr.take() {
        let buf = err_buf.clone();
        std::thread::spawn(move || {
            let mut chunk = [0u8; 1024];
            while let Ok(n) = stderr.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                let mut b = lock(&buf);
                if b.len() < 16 * 1024 {
                    b.push_str(&String::from_utf8_lossy(&chunk[..n]));
                }
            }
        });
    }
    match Session::new(Box::new(out), Box::new(inp), Some(child)) {
        Ok(s) => Ok(s),
        Err(e) => {
            // 子プロセスは Session::new 内で落ちた（drop 済み）。stderr の読み終わりを少し待つ
            std::thread::sleep(std::time::Duration::from_millis(200));
            let stderr = lock(&err_buf).clone();
            if is_unknown_host_key(&stderr) {
                // フロントが確認ダイアログを出して trust_host → 再接続する目印
                return Err(format!("UNKNOWN_HOST_KEY:{}", host));
            }
            let detail = ssh_error_line(&stderr).unwrap_or_else(|| e.to_string());
            Err(format!("{} に接続できません（{}）", host, detail))
        }
    }
}

/// `~/.ssh/config` の Host 名一覧（読めなければ空）。
pub fn configured_hosts() -> Vec<String> {
    dirs::home_dir()
        .map(|h| h.join(".ssh").join("config"))
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|t| ssh_config_hosts(&t))
        .unwrap_or_default()
}

/// 一時ファイルの置き場（既定アプリで開く写し・画像プレビュー）。
pub fn cache_root() -> PathBuf {
    std::env::temp_dir().join("tana-remote")
}

// ───────────────────────── Tauri コマンド ─────────────────────────
// SFTP は回線を待つので、UI を止めないようワーカースレッドで実行する。

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

type St<'a> = tauri::State<'a, RemoteState>;

#[tauri::command]
pub async fn remote_connect(state: St<'_>, host: String) -> Result<String, String> {
    let s = state.inner().clone();
    blocking(move || s.connect(&host)).await
}

#[tauri::command]
pub fn remote_disconnect(state: St<'_>, host: String) {
    state.disconnect(&host);
}

#[tauri::command]
pub fn remote_sessions(state: St<'_>) -> Vec<SessionInfo> {
    state.sessions()
}

#[tauri::command]
pub fn remote_trust_host(state: St<'_>, host: String) {
    state.trust_host(&host);
}

#[tauri::command]
pub fn remote_set_writable(state: St<'_>, host: String, writable: bool) {
    state.set_writable(&host, writable);
}

#[tauri::command]
pub fn remote_hosts() -> Vec<String> {
    configured_hosts()
}

#[tauri::command]
pub async fn remote_resolve(state: St<'_>, path: String) -> Result<String, String> {
    let s = state.inner().clone();
    blocking(move || s.resolve(&path)).await
}

#[tauri::command]
pub async fn remote_list_dir(state: St<'_>, path: String) -> Result<Vec<DirEntry>, String> {
    let s = state.inner().clone();
    blocking(move || s.list_dir(&path)).await
}

#[tauri::command]
pub async fn remote_dir_signature(state: St<'_>, path: String) -> Result<u64, String> {
    let s = state.inner().clone();
    blocking(move || Ok(s.dir_signature(&path))).await
}

#[tauri::command]
pub async fn remote_read_preview(
    state: St<'_>,
    path: String,
    max_bytes: usize,
) -> Result<crate::PreviewData, String> {
    let s = state.inner().clone();
    blocking(move || s.read_preview(&path, max_bytes)).await
}

#[tauri::command]
pub async fn remote_fetch(state: St<'_>, path: String) -> Result<String, String> {
    let s = state.inner().clone();
    blocking(move || s.fetch(&path, &cache_root())).await
}

#[tauri::command]
pub async fn remote_unique_name(
    state: St<'_>,
    dest_dir: String,
    name: String,
) -> Result<String, String> {
    let s = state.inner().clone();
    blocking(move || s.unique_name(&dest_dir, &name)).await
}

#[tauri::command]
pub async fn remote_copy(
    state: St<'_>,
    src: String,
    dest_dir: String,
    dest_name: Option<String>,
    overwrite: bool,
) -> Result<String, String> {
    let s = state.inner().clone();
    blocking(move || s.copy(&src, &dest_dir, dest_name.as_deref(), overwrite)).await
}

#[tauri::command]
pub async fn remote_move(
    state: St<'_>,
    src: String,
    dest_dir: String,
    dest_name: Option<String>,
    overwrite: bool,
) -> Result<String, String> {
    let s = state.inner().clone();
    blocking(move || s.move_to(&src, &dest_dir, dest_name.as_deref(), overwrite)).await
}

#[tauri::command]
pub async fn remote_delete(state: St<'_>, path: String) -> Result<(), String> {
    let s = state.inner().clone();
    blocking(move || s.delete(&path)).await
}

#[tauri::command]
pub async fn remote_rename(
    state: St<'_>,
    path: String,
    new_name: String,
) -> Result<String, String> {
    let s = state.inner().clone();
    blocking(move || s.rename(&path, &new_name)).await
}

#[tauri::command]
pub async fn remote_make_dir(
    state: St<'_>,
    parent: String,
    name: String,
) -> Result<String, String> {
    let s = state.inner().clone();
    blocking(move || s.make_dir(&parent, &name)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_formats_uris() {
        assert_eq!(
            parse_uri("sftp://k16/home/u"),
            Some(RemotePath {
                host: "k16".into(),
                path: "/home/u".into()
            })
        );
        assert_eq!(parse_uri("sftp://me@k16").unwrap().path, "");
        assert_eq!(parse_uri("/home/u"), None);
        assert_eq!(parse_uri("sftp:///x"), None); // 接続先なし
        assert_eq!(parse_uri("sftp://-oProxyCommand=x/"), None); // オプション注入
        assert_eq!(format_uri("k16", "/a"), "sftp://k16/a");
        assert_eq!(format_uri("k16", ""), "sftp://k16");
        assert_eq!(format_uri("k16", "a"), "sftp://k16/a");
    }

    #[test]
    fn valid_host_rejects_injection_and_spaces() {
        assert!(valid_host("k16"));
        assert!(valid_host("user@host.example.com"));
        assert!(valid_host("[::1]"));
        assert!(!valid_host(""));
        assert!(!valid_host("-oX"));
        assert!(!valid_host("a b"));
        assert!(!valid_host("a;rm"));
        assert!(!valid_host("a/b"));
    }

    #[test]
    fn parent_base_and_name_rules() {
        assert_eq!(parent_of("/a/b"), Some("/a".into()));
        assert_eq!(parent_of("/a"), Some("/".into()));
        assert_eq!(parent_of("/"), None);
        assert_eq!(base_name("/a/b/"), "b");
        assert!(valid_name("x.txt"));
        assert!(!valid_name(".."));
        assert!(!valid_name("a/b"));
        assert!(!valid_name(""));
    }

    #[test]
    fn unique_with_increments_like_local() {
        let taken = ["a.txt", "a (1).txt", ".env"];
        let f = |n: &str| Ok(taken.contains(&n));
        assert_eq!(unique_with("a.txt", f).unwrap(), "a (2).txt");
        assert_eq!(unique_with("b.txt", f).unwrap(), "b.txt");
        assert_eq!(unique_with(".env", f).unwrap(), ".env (1)");
        assert!(unique_with("x", |_| Err("down".into())).is_err());
    }

    #[test]
    fn ssh_config_hosts_skips_patterns_and_duplicates() {
        let cfg = "\
# comment
Host k16 gpd
  HostName 100.64.0.1
Host *.example.com !bad
host=lower
Host k16
Match all
Host \"quoted\"
";
        assert_eq!(ssh_config_hosts(cfg), ["k16", "gpd", "lower", "quoted"]);
        assert!(ssh_config_hosts("").is_empty());
    }

    #[test]
    fn ssh_error_line_picks_last_meaningful_line() {
        let e = "Warning: Permanently added 'x'\nuser@k16: Permission denied (publickey).\n";
        assert_eq!(
            ssh_error_line(e).as_deref(),
            Some("user@k16: Permission denied (publickey).")
        );
        assert_eq!(ssh_error_line(""), None);
    }

    #[test]
    fn ssh_args_end_options_before_host() {
        let a = ssh_args("k16", false);
        let i = a.iter().position(|x| x == "--").unwrap();
        assert_eq!(&a[i + 1..], ["k16", "sftp"]);
        assert!(a.contains(&"BatchMode=yes".to_string()));
        // Fude の RemoteForward / 接続共有を横取りしない
        assert!(a.contains(&"ClearAllForwardings=yes".to_string()));
        assert!(a.contains(&"ControlMaster=no".to_string()));
        assert!(!a.iter().any(|x| x.starts_with("StrictHostKeyChecking")));
        let b = ssh_args("k16", true);
        assert!(b.contains(&"StrictHostKeyChecking=accept-new".to_string()));
        let i = b.iter().position(|x| x == "--").unwrap();
        assert_eq!(&b[i + 1..], ["k16", "sftp"]);
    }

    #[test]
    fn unknown_host_key_is_not_a_changed_key() {
        assert!(is_unknown_host_key(
            "No ED25519 host key is known for k16 and you have requested strict checking.\r\nHost key verification failed.\r\n"
        ));
        assert!(!is_unknown_host_key(
            "@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @\nHost key verification failed.\n"
        ));
        assert!(!is_unknown_host_key("Permission denied (publickey)."));
    }

    #[test]
    fn trust_host_is_passed_to_connector_only_after_consent() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s2 = seen.clone();
        let st = RemoteState::with_connector(Arc::new(move |h: &str, trust: bool| {
            lock(&s2).push(trust);
            Err(format!("UNKNOWN_HOST_KEY:{}", h))
        }));
        assert_eq!(st.connect("k16").unwrap_err(), "UNKNOWN_HOST_KEY:k16");
        st.trust_host("k16");
        let _ = st.connect("k16");
        assert_eq!(*lock(&seen), [false, true]);
    }

    #[test]
    fn cache_path_stays_inside_root() {
        let rp = RemotePath {
            host: "me@k16".into(),
            path: "/a/../../etc/passwd".into(),
        };
        let p = cache_path(Path::new("/tmp/r"), &rp);
        assert!(p.starts_with("/tmp/r/me_k16"));
        assert!(!p.components().any(|c| c.as_os_str() == ".."));
        assert!(p.ends_with("passwd"));
    }

    #[test]
    fn entries_from_sorts_dirs_first_and_builds_uris() {
        let mk = |name: &str, dir: bool| sftp::Name {
            name: name.into(),
            attrs: sftp::Attrs {
                size: Some(3),
                perms: Some(if dir { 0o040755 } else { 0o100644 }),
                mtime: Some(10),
            },
        };
        let e = entries_from(
            "k16",
            "/",
            vec![mk("b.txt", false), mk(".x", true), mk("A", true)],
        );
        let names: Vec<_> = e.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, [".x", "A", "b.txt"]);
        assert_eq!(e[2].path, "sftp://k16/b.txt");
        assert!(e[0].is_hidden && e[0].is_dir);
        assert_eq!(e[2].modified, Some(10));
    }

    // ── ローカルの sftp-server を「接続先」にした結合テスト ──

    fn local_state() -> Option<RemoteState> {
        // sftp-server が無い環境では飛ばす
        drop(crate::sftp::tests::local_server()?);
        let connector: Connector = Arc::new(|_host: &str, _trust: bool| {
            let mut child = crate::sftp::tests::local_server().ok_or("no sftp-server")?;
            let out = child.stdout.take().unwrap();
            let inp = child.stdin.take().unwrap();
            Session::new(Box::new(out), Box::new(inp), Some(child)).map_err(|e| e.to_string())
        });
        Some(RemoteState::with_connector(connector))
    }

    fn uri(dir: &tempfile::TempDir, rel: &str) -> String {
        let p = if rel.is_empty() {
            dir.path().to_path_buf()
        } else {
            dir.path().join(rel)
        };
        format_uri("h", &p.to_string_lossy())
    }

    #[test]
    fn session_connects_lists_and_previews() {
        let Some(st) = local_state() else { return };
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("a.md"), "# hi").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(dir.path().join("sub"), dir.path().join("link")).unwrap();

        let home = st.connect("h").unwrap();
        assert!(home.starts_with("sftp://h/"));
        assert_eq!(st.sessions()[0].host, "h");
        assert!(!st.sessions()[0].writable);

        let e = st.list_dir(&uri(&dir, "")).unwrap();
        let names: Vec<_> = e.iter().map(|e| e.name.as_str()).collect();
        #[cfg(unix)]
        assert_eq!(names, ["link", "sub", "a.md"]); // リンク先がフォルダなのでフォルダ扱い
        assert_eq!(e.last().unwrap().path, uri(&dir, "a.md"));

        let p = st.read_preview(&uri(&dir, "a.md"), 100).unwrap();
        assert_eq!(p.text.as_deref(), Some("# hi"));
        assert!(st.read_preview(&uri(&dir, "sub"), 100).is_err());

        let err = st.list_dir(&uri(&dir, "nope")).unwrap_err();
        assert!(err.contains("見つかりません"), "{}", err);
        assert_ne!(st.dir_signature(&uri(&dir, "")), 0);

        // realpath はリンクを辿る（macOS の一時フォルダ /var は /private/var の別名）
        let canon = std::fs::canonicalize(dir.path()).unwrap();
        assert_eq!(
            st.resolve(&format!("{}/sub/..", uri(&dir, ""))).unwrap(),
            format_uri("h", &canon.to_string_lossy())
        );
        st.disconnect("h");
        assert!(st.sessions().is_empty());
        // 切断後も次の操作で張り直す
        assert!(st.list_dir(&uri(&dir, "")).is_ok());
    }

    #[test]
    fn writes_are_refused_until_allowed() {
        let Some(st) = local_state() else { return };
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "x").unwrap();
        let ro = |r: Result<String, String>| r.unwrap_err().starts_with("READ_ONLY:");
        assert!(ro(st.make_dir(&uri(&dir, ""), "n")));
        assert!(ro(st.rename(&uri(&dir, "a.txt"), "b.txt")));
        assert!(st
            .delete(&uri(&dir, "a.txt"))
            .unwrap_err()
            .starts_with("READ_ONLY:"));
        let local = tempfile::tempdir().unwrap();
        std::fs::write(local.path().join("up.txt"), "u").unwrap();
        assert!(ro(st.copy(
            &local.path().join("up.txt").to_string_lossy(),
            &uri(&dir, ""),
            None,
            false
        )));
        // リモート→ローカルのコピーは読むだけなので閲覧のみでもできる
        let l = local.path().to_string_lossy().to_string();
        st.copy(&uri(&dir, "a.txt"), &l, None, false).unwrap();
        assert_eq!(
            std::fs::read_to_string(local.path().join("a.txt")).unwrap(),
            "x"
        );
        // 移動は元を消すので元側の許可が要る
        assert!(ro(st.move_to(
            &uri(&dir, "a.txt"),
            &l,
            Some("m.txt"),
            false
        )));
        assert!(dir.path().join("a.txt").exists());
        assert!(!dir.path().join("n").exists());
    }

    #[test]
    fn copy_move_rename_mkdir_delete_when_writable() {
        let Some(st) = local_state() else { return };
        st.set_writable("h", true);
        let remote = tempfile::tempdir().unwrap();
        let local = tempfile::tempdir().unwrap();
        let l = |rel: &str| local.path().join(rel).to_string_lossy().to_string();
        std::fs::create_dir_all(local.path().join("tree/inner")).unwrap();
        std::fs::write(local.path().join("tree/inner/f.txt"), "deep").unwrap();
        std::fs::write(local.path().join("one.txt"), "1").unwrap();

        // ローカル → リモート（フォルダごと）
        let out = st.copy(&l("tree"), &uri(&remote, ""), None, false).unwrap();
        assert_eq!(out, uri(&remote, "tree"));
        assert_eq!(
            std::fs::read_to_string(remote.path().join("tree/inner/f.txt")).unwrap(),
            "deep"
        );
        // 衝突は EXISTS、上書き指定で置き換え
        assert_eq!(
            st.copy(&l("tree"), &uri(&remote, ""), None, false)
                .unwrap_err(),
            "EXISTS"
        );
        std::fs::write(local.path().join("tree/inner/f.txt"), "new").unwrap();
        st.copy(&l("tree"), &uri(&remote, ""), None, true).unwrap();
        assert_eq!(
            std::fs::read_to_string(remote.path().join("tree/inner/f.txt")).unwrap(),
            "new"
        );
        // 宛先名の指定と、空き名の提案
        st.copy(&l("one.txt"), &uri(&remote, ""), Some("two.txt"), false)
            .unwrap();
        assert_eq!(
            st.unique_name(&uri(&remote, ""), "two.txt").unwrap(),
            "two (1).txt"
        );
        // 同じ場所への同名コピー（複製）は衝突扱い
        assert_eq!(
            st.copy(&uri(&remote, "two.txt"), &uri(&remote, ""), None, false)
                .unwrap_err(),
            "EXISTS"
        );
        // リモート → リモート（同じ接続先、一時フォルダ経由）
        st.copy(
            &uri(&remote, "tree"),
            &uri(&remote, "tree"),
            Some("copy"),
            false,
        )
        .unwrap();
        assert!(remote.path().join("tree/copy/inner/f.txt").exists());
        // 同じ接続先どうしの移動は改名
        st.move_to(&uri(&remote, "two.txt"), &uri(&remote, "tree"), None, false)
            .unwrap();
        assert!(remote.path().join("tree/two.txt").exists());
        assert!(!remote.path().join("two.txt").exists());
        // リモート → ローカルの移動は複製して元を消す
        st.move_to(&uri(&remote, "tree/two.txt"), &l(""), None, false)
            .unwrap();
        assert!(local.path().join("two.txt").exists());
        assert!(!remote.path().join("tree/two.txt").exists());
        // ローカル → リモートの移動も元を消す
        st.move_to(&l("two.txt"), &uri(&remote, ""), None, false)
            .unwrap();
        assert!(!local.path().join("two.txt").exists());
        assert!(remote.path().join("two.txt").exists());

        // 改名・新規フォルダ・削除
        assert_eq!(
            st.rename(&uri(&remote, "two.txt"), "three.txt").unwrap(),
            uri(&remote, "three.txt")
        );
        assert_eq!(
            st.rename(&uri(&remote, "three.txt"), "tree").unwrap_err(),
            "EXISTS"
        );
        assert!(st.rename(&uri(&remote, "three.txt"), "../x").is_err());
        st.make_dir(&uri(&remote, ""), "nd").unwrap();
        assert_eq!(st.make_dir(&uri(&remote, ""), "nd").unwrap_err(), "EXISTS");
        st.delete(&uri(&remote, "tree")).unwrap();
        assert!(!remote.path().join("tree").exists());
        assert!(st.delete("sftp://h/").is_err());
    }

    #[test]
    fn fetch_downloads_once_and_refreshes_on_change() {
        let Some(st) = local_state() else { return };
        let remote = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        std::fs::write(remote.path().join("pic.png"), "v1").unwrap();
        let got = st.fetch(&uri(&remote, "pic.png"), cache.path()).unwrap();
        assert!(got.ends_with("pic.png"));
        assert_eq!(std::fs::read_to_string(&got).unwrap(), "v1");
        // 同じなら取り直さない（手元を書き換えても残る）
        std::fs::write(&got, "v1").unwrap();
        let t = std::time::UNIX_EPOCH
            + std::time::Duration::from_secs(
                std::fs::metadata(remote.path().join("pic.png"))
                    .unwrap()
                    .modified()
                    .unwrap()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs(),
            );
        std::fs::File::options()
            .write(true)
            .open(&got)
            .unwrap()
            .set_modified(t)
            .unwrap();
        // 相手が変われば取り直す
        std::fs::write(remote.path().join("pic.png"), "version2").unwrap();
        let got2 = st.fetch(&uri(&remote, "pic.png"), cache.path()).unwrap();
        assert_eq!(std::fs::read_to_string(&got2).unwrap(), "version2");
        assert!(st.fetch(&uri(&remote, ""), cache.path()).is_err());
    }

    #[test]
    fn connection_failure_is_reported_with_host() {
        let st = RemoteState::with_connector(Arc::new(|h: &str, _trust: bool| {
            Err(format!("{} に接続できません（Permission denied）", h))
        }));
        let e = st.list_dir("sftp://k16/x").unwrap_err();
        assert!(
            e.contains("k16") && e.contains("Permission denied"),
            "{}",
            e
        );
        assert!(st.connect("-bad").is_err());
    }

    /// 本物の ssh で繋ぐ確認（手動）。`TANA_TEST_SSH_HOST=k16 cargo test -- --ignored real_ssh`
    #[test]
    #[ignore]
    fn real_ssh_host_lists_home() {
        let Ok(host) = std::env::var("TANA_TEST_SSH_HOST") else {
            return;
        };
        let st = RemoteState::default();
        let home = st.connect(&host).unwrap();
        assert!(home.starts_with(&format!("sftp://{}/", host)));
        let entries = st.list_dir(&home).unwrap();
        assert!(!entries.is_empty());
        assert!(st
            .make_dir(&home, "tana-should-not-exist")
            .unwrap_err()
            .starts_with("READ_ONLY:"));
        let bad = RemoteState::default().connect("tana-no-such-host.invalid");
        assert!(bad.unwrap_err().contains("接続できません"));
    }
}
