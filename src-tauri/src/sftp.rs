//! 最小の SFTP v3 クライアント（リモート接続, FR-20）。
//!
//! `ssh -s HOST sftp` の標準入出力に繋いで話す。相手側には sshd の SFTP
//! サブシステムがあればよく、何もインストールしなくてよい。依存を増やさない
//! 方針（NFR-P2）なので、必要な要求（一覧/stat/読み書き/削除/改名/mkdir/realpath）
//! だけを自前で実装する。
//!
//! パケットの組み立て・解釈は純粋関数（`Writer`/`Reader`/`Attrs`）に分け、
//! 通信は `Read`/`Write` を注入した `Client` が行う。テストはローカルの
//! `sftp-server` を直接起動して実物と話す（無い環境では飛ばす）。

use std::collections::HashMap;
use std::io::{Read, Write};

// ── 要求/応答の種別 (draft-ietf-secsh-filexfer-02) ──
const FXP_INIT: u8 = 1;
const FXP_VERSION: u8 = 2;
const FXP_OPEN: u8 = 3;
const FXP_CLOSE: u8 = 4;
const FXP_READ: u8 = 5;
const FXP_WRITE: u8 = 6;
const FXP_LSTAT: u8 = 7;
const FXP_OPENDIR: u8 = 11;
const FXP_READDIR: u8 = 12;
const FXP_REMOVE: u8 = 13;
const FXP_MKDIR: u8 = 14;
const FXP_RMDIR: u8 = 15;
const FXP_REALPATH: u8 = 16;
const FXP_STAT: u8 = 17;
const FXP_RENAME: u8 = 18;
const FXP_STATUS: u8 = 101;
const FXP_HANDLE: u8 = 102;
const FXP_DATA: u8 = 103;
const FXP_NAME: u8 = 104;
const FXP_ATTRS: u8 = 105;

// ── 状態コード ──
pub const FX_OK: u32 = 0;
pub const FX_EOF: u32 = 1;
pub const FX_NO_SUCH_FILE: u32 = 2;
pub const FX_PERMISSION_DENIED: u32 = 3;

// ── ATTRS のフラグ ──
const ATTR_SIZE: u32 = 0x1;
const ATTR_UIDGID: u32 = 0x2;
const ATTR_PERMISSIONS: u32 = 0x4;
const ATTR_ACMODTIME: u32 = 0x8;
const ATTR_EXTENDED: u32 = 0x8000_0000;

// ── OPEN のフラグ ──
const OPEN_READ: u32 = 0x1;
const OPEN_WRITE: u32 = 0x2;
const OPEN_CREAT: u32 = 0x8;
const OPEN_TRUNC: u32 = 0x10;
const OPEN_EXCL: u32 = 0x20;

const S_IFMT: u32 = 0o170000;
const S_IFDIR: u32 = 0o040000;
const S_IFREG: u32 = 0o100000;
const S_IFLNK: u32 = 0o120000;

/// 1 回の READ/WRITE の大きさ。OpenSSH の上限以下に収める。
pub const CHUNK: u32 = 32 * 1024;
/// 読み書きで同時に出しておく要求数（往復待ちを隠すためのパイプライン）。
const WINDOW: usize = 16;
/// 応答パケットの上限（壊れた/悪意ある長さで巨大確保しないため）。
const MAX_PACKET: u32 = 4 * 1024 * 1024;

/// SFTP の失敗。`code` は状態コード（通信/解釈の失敗は `None`）。
#[derive(Debug, Clone, PartialEq)]
pub struct Error {
    pub code: Option<u32>,
    pub message: String,
}

impl Error {
    fn proto(msg: impl Into<String>) -> Self {
        Error {
            code: None,
            message: msg.into(),
        }
    }
    pub fn is_not_found(&self) -> bool {
        self.code == Some(FX_NO_SUCH_FILE)
    }
    /// 通信路そのものが壊れた（再接続で直る可能性がある）か。
    pub fn is_connection(&self) -> bool {
        self.code.is_none()
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::proto(format!("接続が切れました: {}", e))
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// 状態コードを人が読む文言へ（サーバの英語メッセージより優先する）。
pub fn status_text(code: u32, server_msg: &str) -> String {
    match code {
        FX_NO_SUCH_FILE => "見つかりません".to_string(),
        FX_PERMISSION_DENIED => "権限がありません".to_string(),
        8 => "相手のサーバが対応していない操作です".to_string(),
        _ if !server_msg.is_empty() => server_msg.to_string(),
        _ => format!("失敗しました (SFTP {})", code),
    }
}

// ───────────────────────── 純粋: パケットの組み立て/解釈 ─────────────────────────

/// 要求パケットの本体を組み立てる。`finish` で長さを前置した完成形になる。
#[derive(Default)]
pub struct Writer {
    buf: Vec<u8>,
}

impl Writer {
    pub fn new(kind: u8) -> Self {
        Writer { buf: vec![kind] }
    }
    pub fn u32(mut self, v: u32) -> Self {
        self.buf.extend_from_slice(&v.to_be_bytes());
        self
    }
    pub fn u64(mut self, v: u64) -> Self {
        self.buf.extend_from_slice(&v.to_be_bytes());
        self
    }
    pub fn bytes(mut self, v: &[u8]) -> Self {
        self = self.u32(v.len() as u32);
        self.buf.extend_from_slice(v);
        self
    }
    pub fn str(self, v: &str) -> Self {
        self.bytes(v.as_bytes())
    }
    /// 属性。ここでは「何も指定しない」か「パーミッションだけ」を送る。
    pub fn attrs(self, perms: Option<u32>) -> Self {
        match perms {
            Some(p) => self.u32(ATTR_PERMISSIONS).u32(p),
            None => self.u32(0),
        }
    }
    pub fn finish(self) -> Vec<u8> {
        let mut out = (self.buf.len() as u32).to_be_bytes().to_vec();
        out.extend_from_slice(&self.buf);
        out
    }
}

/// 応答パケット本体（種別バイトの後）を前から読む。
pub struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Reader { buf, pos: 0 }
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        if self.buf.len() - self.pos < n {
            return Err(Error::proto("応答が途中で切れています"));
        }
        let s = &self.buf[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }
    pub fn u32(&mut self) -> Result<u32> {
        let b = self.take(4)?;
        Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }
    pub fn u64(&mut self) -> Result<u64> {
        let hi = self.u32()? as u64;
        let lo = self.u32()? as u64;
        Ok((hi << 32) | lo)
    }
    pub fn bytes(&mut self) -> Result<&'a [u8]> {
        let n = self.u32()? as usize;
        self.take(n)
    }
    pub fn string(&mut self) -> Result<String> {
        Ok(String::from_utf8_lossy(self.bytes()?).to_string())
    }
    pub fn attrs(&mut self) -> Result<Attrs> {
        let flags = self.u32()?;
        let mut a = Attrs::default();
        if flags & ATTR_SIZE != 0 {
            a.size = Some(self.u64()?);
        }
        if flags & ATTR_UIDGID != 0 {
            self.u32()?;
            self.u32()?;
        }
        if flags & ATTR_PERMISSIONS != 0 {
            a.perms = Some(self.u32()?);
        }
        if flags & ATTR_ACMODTIME != 0 {
            self.u32()?; // atime
            a.mtime = Some(self.u32()? as u64);
        }
        if flags & ATTR_EXTENDED != 0 {
            let n = self.u32()?;
            for _ in 0..n {
                self.bytes()?;
                self.bytes()?;
            }
        }
        Ok(a)
    }
}

/// ファイル属性（使うものだけ）。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Attrs {
    pub size: Option<u64>,
    pub perms: Option<u32>,
    pub mtime: Option<u64>,
}

impl Attrs {
    fn kind(&self) -> Option<u32> {
        self.perms.map(|p| p & S_IFMT)
    }
    pub fn is_dir(&self) -> bool {
        self.kind() == Some(S_IFDIR)
    }
    pub fn is_symlink(&self) -> bool {
        self.kind() == Some(S_IFLNK)
    }
    /// 通常ファイルか（種別が分からないサーバではファイル扱い）。
    pub fn is_file(&self) -> bool {
        matches!(self.kind(), None | Some(S_IFREG))
    }
}

/// ディレクトリの 1 エントリ（`.` と `..` は除く）。
#[derive(Debug, Clone, PartialEq)]
pub struct Name {
    pub name: String,
    pub attrs: Attrs,
}

/// 応答 1 件。`id` で要求と突き合わせる。
#[derive(Debug, PartialEq)]
pub enum Response {
    Status { code: u32, message: String },
    Handle(Vec<u8>),
    Data(Vec<u8>),
    Name(Vec<Name>),
    Attrs(Attrs),
}

/// 応答パケット本体（長さの後: 種別 + id + …）を解釈する。
pub fn parse_response(packet: &[u8]) -> Result<(u32, Response)> {
    let (&kind, rest) = packet
        .split_first()
        .ok_or_else(|| Error::proto("空の応答"))?;
    let mut r = Reader::new(rest);
    let id = r.u32()?;
    let resp = match kind {
        FXP_STATUS => {
            let code = r.u32()?;
            // v3 では message/lang は省略されうる
            let message = r.string().unwrap_or_default();
            Response::Status { code, message }
        }
        FXP_HANDLE => Response::Handle(r.bytes()?.to_vec()),
        FXP_DATA => Response::Data(r.bytes()?.to_vec()),
        FXP_NAME => {
            let n = r.u32()?;
            let mut names = Vec::with_capacity(n.min(4096) as usize);
            for _ in 0..n {
                let name = r.string()?;
                let _long = r.bytes()?;
                let attrs = r.attrs()?;
                names.push(Name { name, attrs });
            }
            Response::Name(names)
        }
        FXP_ATTRS => Response::Attrs(r.attrs()?),
        k => return Err(Error::proto(format!("想定外の応答種別 {}", k))),
    };
    Ok((id, resp))
}

/// POSIX パスを連結する（`dir` は絶対パス想定。末尾の `/` を重ねない）。
pub fn join(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{}{}", dir, name)
    } else {
        format!("{}/{}", dir, name)
    }
}

// ───────────────────────── 通信 ─────────────────────────

/// SFTP クライアント。要求は同期的に投げて応答を待つ（読み書きだけ先行要求する）。
pub struct Client<R: Read, W: Write> {
    reader: R,
    writer: W,
    next_id: u32,
    /// パイプライン中に先に届いた応答（id → 応答）。
    pending: HashMap<u32, Response>,
}

impl<R: Read, W: Write> Client<R, W> {
    /// INIT/VERSION を交わして使える状態にする。
    pub fn handshake(reader: R, mut writer: W) -> Result<Self> {
        writer.write_all(&Writer::new(FXP_INIT).u32(3).finish())?;
        writer.flush()?;
        let mut c = Client {
            reader,
            writer,
            next_id: 1,
            pending: HashMap::new(),
        };
        let pkt = c.read_packet()?;
        match pkt.first() {
            Some(&FXP_VERSION) => Ok(c),
            _ => Err(Error::proto("SFTP サーバの応答ではありません")),
        }
    }

    fn read_packet(&mut self) -> Result<Vec<u8>> {
        let mut len = [0u8; 4];
        self.reader.read_exact(&mut len)?;
        let len = u32::from_be_bytes(len);
        if len == 0 || len > MAX_PACKET {
            return Err(Error::proto(format!("不正な応答長 {}", len)));
        }
        let mut buf = vec![0u8; len as usize];
        self.reader.read_exact(&mut buf)?;
        Ok(buf)
    }

    fn send(&mut self, kind: u8, body: impl FnOnce(Writer) -> Writer) -> Result<u32> {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        let pkt = body(Writer::new(kind).u32(id)).finish();
        self.writer.write_all(&pkt)?;
        self.writer.flush()?;
        Ok(id)
    }

    fn wait(&mut self, id: u32) -> Result<Response> {
        if let Some(r) = self.pending.remove(&id) {
            return Ok(r);
        }
        loop {
            let pkt = self.read_packet()?;
            let (got, resp) = parse_response(&pkt)?;
            if got == id {
                return Ok(resp);
            }
            self.pending.insert(got, resp);
        }
    }

    fn call(&mut self, kind: u8, body: impl FnOnce(Writer) -> Writer) -> Result<Response> {
        let id = self.send(kind, body)?;
        self.wait(id)
    }

    fn expect_ok(resp: Response) -> Result<()> {
        match resp {
            Response::Status { code: FX_OK, .. } => Ok(()),
            other => Err(unexpected(other)),
        }
    }

    fn expect_handle(resp: Response) -> Result<Vec<u8>> {
        match resp {
            Response::Handle(h) => Ok(h),
            other => Err(unexpected(other)),
        }
    }

    fn expect_attrs(resp: Response) -> Result<Attrs> {
        match resp {
            Response::Attrs(a) => Ok(a),
            other => Err(unexpected(other)),
        }
    }

    /// パスを正規化した絶対パスにする（`.` は相手のホーム）。
    pub fn realpath(&mut self, path: &str) -> Result<String> {
        match self.call(FXP_REALPATH, |w| w.str(path))? {
            Response::Name(mut n) if !n.is_empty() => Ok(n.remove(0).name),
            other => Err(unexpected(other)),
        }
    }

    /// リンクを辿った属性。
    pub fn stat(&mut self, path: &str) -> Result<Attrs> {
        let r = self.call(FXP_STAT, |w| w.str(path))?;
        Self::expect_attrs(r)
    }

    /// リンク自体の属性。
    pub fn lstat(&mut self, path: &str) -> Result<Attrs> {
        let r = self.call(FXP_LSTAT, |w| w.str(path))?;
        Self::expect_attrs(r)
    }

    /// 存在するか（見つからない以外の失敗はそのまま返す）。
    pub fn exists(&mut self, path: &str) -> Result<bool> {
        match self.lstat(path) {
            Ok(_) => Ok(true),
            Err(e) if e.is_not_found() => Ok(false),
            Err(e) => Err(e),
        }
    }

    /// ディレクトリのエントリ一覧（`.`/`..` 除く。属性は lstat 相当）。
    pub fn read_dir(&mut self, path: &str) -> Result<Vec<Name>> {
        let r = self.call(FXP_OPENDIR, |w| w.str(path))?;
        let handle = Self::expect_handle(r)?;
        let mut out = Vec::new();
        let result = loop {
            let h = handle.clone();
            match self.call(FXP_READDIR, |w| w.bytes(&h)) {
                Ok(Response::Name(names)) => out.extend(
                    names
                        .into_iter()
                        .filter(|n| n.name != "." && n.name != ".."),
                ),
                Ok(Response::Status { code: FX_EOF, .. }) => break Ok(()),
                Ok(other) => break Err(unexpected(other)),
                Err(e) => break Err(e),
            }
        };
        let _ = self.close(&handle);
        result.map(|_| out)
    }

    fn close(&mut self, handle: &[u8]) -> Result<()> {
        let r = self.call(FXP_CLOSE, |w| w.bytes(handle))?;
        Self::expect_ok(r)
    }

    fn open(&mut self, path: &str, flags: u32) -> Result<Vec<u8>> {
        let r = self.call(FXP_OPEN, |w| w.str(path).u32(flags).attrs(None))?;
        Self::expect_handle(r)
    }

    /// ファイルを先頭から最大 `limit` バイト読み、`sink` へ順に流す。読んだ総バイト数を返す。
    pub fn read_to(
        &mut self,
        path: &str,
        limit: Option<u64>,
        sink: &mut dyn FnMut(&[u8]) -> std::io::Result<()>,
    ) -> Result<u64> {
        let handle = self.open(path, OPEN_READ)?;
        let result = self.read_handle(&handle, limit, sink);
        let _ = self.close(&handle);
        result
    }

    fn read_handle(
        &mut self,
        handle: &[u8],
        limit: Option<u64>,
        sink: &mut dyn FnMut(&[u8]) -> std::io::Result<()>,
    ) -> Result<u64> {
        let limit = limit.unwrap_or(u64::MAX);
        let mut queued: std::collections::VecDeque<(u32, u64, u32)> = Default::default();
        let mut next_off: u64 = 0; // 次に要求するオフセット
        let mut done: u64 = 0; // sink へ渡し終えたバイト数
        let mut eof = false;
        loop {
            while !eof && queued.len() < WINDOW && next_off < limit {
                let len = CHUNK.min((limit - next_off).min(u32::MAX as u64) as u32);
                let off = next_off;
                let id = self.send(FXP_READ, |w| w.bytes(handle).u64(off).u32(len))?;
                queued.push_back((id, off, len));
                next_off += len as u64;
            }
            let Some((id, off, len)) = queued.pop_front() else {
                return Ok(done);
            };
            match self.wait(id)? {
                Response::Data(d) => {
                    if eof || off != done {
                        // EOF 後の先行要求、または短い読みで穴が空いた後の応答は捨てる
                        continue;
                    }
                    sink(&d)?;
                    done += d.len() as u64;
                    if (d.len() as u32) < len {
                        // 短い読み（ファイル末尾か、サーバの上限）。続きを取り直す
                        self.drain(&mut queued)?;
                        next_off = done;
                    }
                }
                Response::Status { code: FX_EOF, .. } => {
                    eof = true;
                    self.drain(&mut queued)?;
                }
                other => {
                    let _ = self.drain(&mut queued);
                    return Err(unexpected(other));
                }
            }
        }
    }

    /// 先行要求の応答を読み捨てる。
    fn drain(&mut self, queued: &mut std::collections::VecDeque<(u32, u64, u32)>) -> Result<()> {
        while let Some((id, _, _)) = queued.pop_front() {
            self.wait(id)?;
        }
        Ok(())
    }

    /// `source` の内容で `path` を作る（`exclusive` なら既存で失敗、さもなくば切り詰めて上書き）。
    pub fn write_from(
        &mut self,
        path: &str,
        exclusive: bool,
        source: &mut dyn Read,
    ) -> Result<u64> {
        let flags = OPEN_WRITE | OPEN_CREAT | if exclusive { OPEN_EXCL } else { OPEN_TRUNC };
        let handle = self.open(path, flags)?;
        let result = self.write_handle(&handle, source);
        let closed = self.close(&handle);
        let n = result?;
        closed?;
        Ok(n)
    }

    fn write_handle(&mut self, handle: &[u8], source: &mut dyn Read) -> Result<u64> {
        let mut queued: std::collections::VecDeque<u32> = Default::default();
        let mut off: u64 = 0;
        let mut buf = vec![0u8; CHUNK as usize];
        let mut first_err: Option<Error> = None;
        loop {
            let n = if first_err.is_none() {
                read_full(source, &mut buf)?
            } else {
                0
            };
            if n > 0 {
                let o = off;
                let data = &buf[..n];
                let id = self.send(FXP_WRITE, |w| w.bytes(handle).u64(o).bytes(data))?;
                queued.push_back(id);
                off += n as u64;
            }
            // 窓が埋まったら、または入力が尽きたら応答を回収する
            while queued.len() >= WINDOW || (n == 0 && !queued.is_empty()) {
                let id = queued.pop_front().unwrap();
                if let Err(e) = self.wait(id).and_then(Self::expect_ok) {
                    first_err.get_or_insert(e);
                }
            }
            if n == 0 {
                return match first_err {
                    Some(e) => Err(e),
                    None => Ok(off),
                };
            }
        }
    }

    pub fn remove(&mut self, path: &str) -> Result<()> {
        let r = self.call(FXP_REMOVE, |w| w.str(path))?;
        Self::expect_ok(r)
    }

    pub fn rmdir(&mut self, path: &str) -> Result<()> {
        let r = self.call(FXP_RMDIR, |w| w.str(path))?;
        Self::expect_ok(r)
    }

    pub fn mkdir(&mut self, path: &str) -> Result<()> {
        let r = self.call(FXP_MKDIR, |w| w.str(path).attrs(None))?;
        Self::expect_ok(r)
    }

    /// 改名。v3 の RENAME は宛先が既存だと失敗する（上書きは呼び出し側で消してから）。
    pub fn rename(&mut self, from: &str, to: &str) -> Result<()> {
        let r = self.call(FXP_RENAME, |w| w.str(from).str(to))?;
        Self::expect_ok(r)
    }

    /// ファイルもディレクトリも消す（ディレクトリは中身ごと。リンクは辿らない）。
    pub fn remove_all(&mut self, path: &str) -> Result<()> {
        let a = self.lstat(path)?;
        if a.is_dir() {
            for n in self.read_dir(path)? {
                self.remove_all(&join(path, &n.name))?;
            }
            self.rmdir(path)
        } else {
            self.remove(path)
        }
    }
}

/// `buf` が埋まるか入力が尽きるまで読む（短い読みを詰める）。
fn read_full(source: &mut dyn Read, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        match source.read(&mut buf[n..]) {
            Ok(0) => break,
            Ok(k) => n += k,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) => return Err(e),
        }
    }
    Ok(n)
}

fn unexpected(resp: Response) -> Error {
    match resp {
        Response::Status { code, message } => Error {
            code: Some(code),
            message: status_text(code, &message),
        },
        other => Error::proto(format!("想定外の応答: {:?}", kind_name(&other))),
    }
}

fn kind_name(r: &Response) -> &'static str {
    match r {
        Response::Status { .. } => "STATUS",
        Response::Handle(_) => "HANDLE",
        Response::Data(_) => "DATA",
        Response::Name(_) => "NAME",
        Response::Attrs(_) => "ATTRS",
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn writer_prefixes_length_and_encodes_strings() {
        let pkt = Writer::new(FXP_STAT).u32(7).str("/a").finish();
        assert_eq!(
            pkt,
            vec![0, 0, 0, 11, FXP_STAT, 0, 0, 0, 7, 0, 0, 0, 2, b'/', b'a']
        );
    }

    #[test]
    fn writer_encodes_u64_and_attrs() {
        let pkt = Writer::new(FXP_READ)
            .u64(1 << 33)
            .attrs(Some(0o755))
            .finish();
        assert_eq!(&pkt[5..13], &[0, 0, 0, 2, 0, 0, 0, 0]);
        assert_eq!(&pkt[13..17], &ATTR_PERMISSIONS.to_be_bytes());
        assert_eq!(&pkt[17..21], &0o755u32.to_be_bytes());
    }

    fn body(kind: u8, w: impl FnOnce(Writer) -> Writer) -> Vec<u8> {
        // finish() の長さ 4 バイトを落とした「本体」
        w(Writer::new(kind)).finish()[4..].to_vec()
    }

    #[test]
    fn parses_status_with_and_without_message() {
        let p = body(FXP_STATUS, |w| w.u32(3).u32(2).str("No such file").str(""));
        assert_eq!(
            parse_response(&p).unwrap(),
            (
                3,
                Response::Status {
                    code: 2,
                    message: "No such file".into()
                }
            )
        );
        let p = body(FXP_STATUS, |w| w.u32(4).u32(0));
        assert_eq!(
            parse_response(&p).unwrap().1,
            Response::Status {
                code: 0,
                message: String::new()
            }
        );
    }

    #[test]
    fn parses_name_with_all_attr_fields() {
        let p = body(FXP_NAME, |w| {
            w.u32(9)
                .u32(1)
                .str("dir")
                .str("drwxr-xr-x ...")
                .u32(ATTR_SIZE | ATTR_UIDGID | ATTR_PERMISSIONS | ATTR_ACMODTIME | ATTR_EXTENDED)
                .u64(4096)
                .u32(1000)
                .u32(1000)
                .u32(S_IFDIR | 0o755)
                .u32(1)
                .u32(1_700_000_000)
                .u32(1)
                .str("k")
                .str("v")
        });
        let (id, r) = parse_response(&p).unwrap();
        assert_eq!(id, 9);
        let Response::Name(n) = r else {
            panic!("NAME ではない")
        };
        assert_eq!(n.len(), 1);
        assert_eq!(n[0].name, "dir");
        assert_eq!(n[0].attrs.size, Some(4096));
        assert_eq!(n[0].attrs.mtime, Some(1_700_000_000));
        assert!(n[0].attrs.is_dir());
        assert!(!n[0].attrs.is_file());
    }

    #[test]
    fn truncated_packet_is_error_not_panic() {
        let mut p = body(FXP_NAME, |w| w.u32(1).u32(1).str("x"));
        p.truncate(p.len() - 1);
        assert!(parse_response(&p).is_err());
        assert!(parse_response(&[]).is_err());
        assert!(parse_response(&[200, 0, 0, 0, 1]).is_err());
    }

    #[test]
    fn attrs_kind_helpers() {
        let link = Attrs {
            perms: Some(S_IFLNK | 0o777),
            ..Default::default()
        };
        assert!(link.is_symlink() && !link.is_dir() && !link.is_file());
        assert!(Attrs::default().is_file()); // 種別不明はファイル扱い
    }

    #[test]
    fn join_does_not_double_slash() {
        assert_eq!(join("/", "a"), "/a");
        assert_eq!(join("/x", "a"), "/x/a");
        assert_eq!(join("/x/", "a"), "/x/a");
    }

    #[test]
    fn status_text_prefers_friendly_wording() {
        assert_eq!(status_text(2, "No such file"), "見つかりません");
        assert_eq!(status_text(4, "Failure"), "Failure");
        assert_eq!(status_text(4, ""), "失敗しました (SFTP 4)");
    }

    // ── 実物の sftp-server と話す結合テスト ──

    /// ローカルの OpenSSH sftp-server を起動する。無ければ None（テストは飛ばす）。
    pub(crate) fn local_server() -> Option<std::process::Child> {
        let bin = [
            "/usr/lib/openssh/sftp-server",
            "/usr/lib/sftp-server",
            "/usr/libexec/sftp-server",
            "/usr/libexec/openssh/sftp-server",
        ]
        .into_iter()
        .find(|p| std::path::Path::new(p).exists())?;
        std::process::Command::new(bin)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .ok()
    }

    type LocalClient = Client<std::process::ChildStdout, std::process::ChildStdin>;

    fn connect() -> Option<(std::process::Child, LocalClient)> {
        let mut child = local_server()?;
        let out = child.stdout.take().unwrap();
        let inp = child.stdin.take().unwrap();
        Some((child, Client::handshake(out, inp).unwrap()))
    }

    fn p(dir: &tempfile::TempDir, name: &str) -> String {
        dir.path().join(name).to_string_lossy().to_string()
    }

    #[test]
    fn server_lists_stats_and_reads() {
        let Some((_child, mut c)) = connect() else {
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("a.txt"), b"hello").unwrap();
        let root = dir.path().to_string_lossy().to_string();

        let mut names: Vec<_> = c.read_dir(&root).unwrap();
        names.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(
            names.iter().map(|n| n.name.as_str()).collect::<Vec<_>>(),
            ["a.txt", "sub"]
        );
        assert!(names[1].attrs.is_dir());
        assert_eq!(names[0].attrs.size, Some(5));

        assert!(c.stat(&p(&dir, "sub")).unwrap().is_dir());
        assert!(c.exists(&p(&dir, "a.txt")).unwrap());
        assert!(!c.exists(&p(&dir, "nope")).unwrap());
        let e = c.read_dir(&p(&dir, "nope")).unwrap_err();
        assert!(e.is_not_found());

        let mut got = Vec::new();
        c.read_to(&p(&dir, "a.txt"), None, &mut |d| {
            got.extend_from_slice(d);
            Ok(())
        })
        .unwrap();
        assert_eq!(got, b"hello");
        assert!(c.realpath(".").unwrap().starts_with('/'));
    }

    #[test]
    fn server_round_trips_large_file_with_pipelining_and_limit() {
        let Some((_child, mut c)) = connect() else {
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        // 窓(WINDOW*CHUNK)を超え、CHUNK の倍数でもない大きさ
        let data: Vec<u8> = (0..(CHUNK as usize * (WINDOW + 3) + 123))
            .map(|i| (i * 7 % 251) as u8)
            .collect();
        let path = p(&dir, "big.bin");
        let n = c
            .write_from(&path, true, &mut std::io::Cursor::new(&data))
            .unwrap();
        assert_eq!(n, data.len() as u64);
        assert_eq!(std::fs::read(dir.path().join("big.bin")).unwrap(), data);

        let mut got = Vec::new();
        c.read_to(&path, None, &mut |d| {
            got.extend_from_slice(d);
            Ok(())
        })
        .unwrap();
        assert_eq!(got, data);

        let mut head = Vec::new();
        let n = c
            .read_to(&path, Some(1000), &mut |d| {
                head.extend_from_slice(d);
                Ok(())
            })
            .unwrap();
        assert_eq!(n, 1000);
        assert_eq!(head, &data[..1000]);

        // exclusive は既存で失敗、非 exclusive は切り詰めて上書き
        assert!(c
            .write_from(&path, true, &mut std::io::Cursor::new(b"x"))
            .is_err());
        c.write_from(&path, false, &mut std::io::Cursor::new(b"xy"))
            .unwrap();
        assert_eq!(std::fs::read(dir.path().join("big.bin")).unwrap(), b"xy");
    }

    #[test]
    fn server_mkdir_rename_and_remove_all() {
        let Some((_child, mut c)) = connect() else {
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let d = p(&dir, "d");
        c.mkdir(&d).unwrap();
        assert!(c.mkdir(&d).is_err()); // 既存
        c.mkdir(&join(&d, "e")).unwrap();
        c.write_from(&join(&d, "e/f.txt"), true, &mut std::io::Cursor::new(b"1"))
            .unwrap();
        c.rename(&d, &p(&dir, "d2")).unwrap();
        assert!(dir.path().join("d2/e/f.txt").exists());
        c.remove_all(&p(&dir, "d2")).unwrap();
        assert!(!dir.path().join("d2").exists());
    }
}
