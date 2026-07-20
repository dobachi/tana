use std::path::{Path, PathBuf};

use serde::Serialize;

/// ディレクトリ内の 1 エントリ（ファイル/フォルダ）
#[derive(Debug, Serialize, PartialEq)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub is_hidden: bool,
    /// 最終更新時刻（UNIXエポック秒）。取得できない場合は None。
    pub modified: Option<u64>,
}

/// メタデータから最終更新時刻（エポック秒）を取り出す。取得不能なら None。
fn modified_secs(meta: Option<&std::fs::Metadata>) -> Option<u64> {
    meta.and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

/// 隠しエントリ判定。先頭ドット（Unix 慣習）に加え、Windows では隠し属性も見る。
fn is_hidden_entry(name: &str, _meta: Option<&std::fs::Metadata>) -> bool {
    if name.starts_with('.') {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        if let Some(m) = _meta {
            if m.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0 {
                return true;
            }
        }
    }
    false
}

/// 指定ディレクトリのエントリ一覧を返す（フォルダ優先 → 名前順）。
/// Tauri から切り離した純粋関数にしてユニットテスト可能にする。
fn read_dir_entries(path: &Path) -> Result<Vec<DirEntry>, String> {
    let read = std::fs::read_dir(path).map_err(|e| format!("{}: {}", path.display(), e))?;
    let mut entries: Vec<DirEntry> = Vec::new();
    for item in read {
        let item = match item {
            Ok(i) => i,
            Err(_) => continue, // 読めないエントリはスキップ（堅牢性）
        };
        let meta = item.metadata();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let name = item.file_name().to_string_lossy().to_string();
        let is_hidden = is_hidden_entry(&name, meta.as_ref().ok());
        let modified = modified_secs(meta.as_ref().ok());
        entries.push(DirEntry {
            name,
            path: item.path().to_string_lossy().to_string(),
            is_dir,
            size,
            is_hidden,
            modified,
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

/// ディレクトリのエントリ一覧を取得する Tauri コマンド。
#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    read_dir_entries(Path::new(&path))
}

/// ホームディレクトリのパスを返す Tauri コマンド。
#[tauri::command]
fn home_dir() -> Option<String> {
    dirs::home_dir().map(|p| p.to_string_lossy().to_string())
}

/// 親ディレクトリのパスを返す Tauri コマンド（ルートでは None）。
#[tauri::command]
fn parent_dir(path: String) -> Option<String> {
    Path::new(&path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
}

// ===== ファイル操作 (FR-02, FR-03) =====
// 破壊的操作の許可（安全モードのゲート）はフロント側で行う。ここは実行のみ。

/// `src` を `dest_dir` 配下へ置いたときの宛先パスを返す。
/// `dest_name` を与えるとその名前を、無ければ src のベース名を使う。
fn target_path(src: &Path, dest_dir: &Path, dest_name: Option<&str>) -> Option<PathBuf> {
    match dest_name {
        Some(n) => Some(dest_dir.join(n)),
        None => src.file_name().map(|n| dest_dir.join(n)),
    }
}

/// `dest_dir` 内で衝突しないベース名を返す（既存なら "name (1).ext", "name (2).ext" …）。
fn unique_target_name(dest_dir: &Path, name: &str) -> String {
    if !dest_dir.join(name).exists() {
        return name.to_string();
    }
    let p = Path::new(name);
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| name.to_string());
    let ext = p
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let mut i = 1;
    loop {
        let candidate = format!("{} ({}){}", stem, i, ext);
        if !dest_dir.join(&candidate).exists() {
            return candidate;
        }
        i += 1;
    }
}

/// ファイル/ディレクトリを再帰的にコピーする。
fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        std::fs::create_dir_all(dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        }
    } else {
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(src, dst)?;
    }
    Ok(())
}

fn remove_any(path: &Path) -> std::io::Result<()> {
    if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

/// `dest_dir` 内で衝突しないベース名を返す Tauri コマンド。
#[tauri::command]
fn unique_name(dest_dir: String, name: String) -> String {
    unique_target_name(Path::new(&dest_dir), &name)
}

/// `src` を `dest_dir` 配下へコピーする。
/// `dest_name` で宛先名を指定可。既存で overwrite=false なら "EXISTS" を返す。
#[tauri::command]
fn copy_path(
    src: String,
    dest_dir: String,
    dest_name: Option<String>,
    overwrite: bool,
) -> Result<String, String> {
    let src = Path::new(&src);
    let dest_dir = Path::new(&dest_dir);
    let target = target_path(src, dest_dir, dest_name.as_deref()).ok_or("コピー元が不正です")?;
    let same = target == src;
    // 同じ場所への同名コピーは「複製」。上書きはできない（自分自身を消す）。
    if same && overwrite {
        return Err("同じファイルには上書きできません。名前を変えてコピーしてください".into());
    }
    // 既存 or 同一パス → 衝突。overwrite でなければ EXISTS（呼び出し側で3択）。
    if (target.exists() || same) && !overwrite {
        return Err("EXISTS".into());
    }
    if target.exists() && !same {
        remove_any(&target).map_err(|e| e.to_string())?;
    }
    copy_recursive(src, &target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

/// `src` を `dest_dir` 配下へ移動する。別デバイス間は copy+delete でフォールバック。
#[tauri::command]
fn move_path(
    src: String,
    dest_dir: String,
    dest_name: Option<String>,
    overwrite: bool,
) -> Result<String, String> {
    let src = Path::new(&src);
    let dest_dir = Path::new(&dest_dir);
    let target = target_path(src, dest_dir, dest_name.as_deref()).ok_or("移動元が不正です")?;
    let same = target == src;
    // 同じ場所へは移動できない。名前を変えれば実質リネームとして成立する。
    if same && overwrite {
        return Err("同じ場所へは移動できません。名前を変えてください".into());
    }
    if (target.exists() || same) && !overwrite {
        return Err("EXISTS".into());
    }
    if target.exists() && !same {
        remove_any(&target).map_err(|e| e.to_string())?;
    }
    if std::fs::rename(src, &target).is_err() {
        copy_recursive(src, &target).map_err(|e| e.to_string())?;
        remove_any(src).map_err(|e| e.to_string())?;
    }
    Ok(target.to_string_lossy().to_string())
}

/// OS のゴミ箱へ移動する（既定の削除, NFR-R2）。
#[tauri::command]
fn delete_to_trash(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

/// 完全に削除する（元に戻せない, 明示操作）。
#[tauri::command]
fn delete_permanent(path: String) -> Result<(), String> {
    remove_any(Path::new(&path)).map_err(|e| e.to_string())
}

/// 同じ親ディレクトリ内で名前を変更する。宛先が既存なら "EXISTS" を返す。
#[tauri::command]
fn rename_path(path: String, new_name: String) -> Result<String, String> {
    let src = Path::new(&path);
    let parent = src.parent().ok_or("親ディレクトリがありません")?;
    let target = parent.join(&new_name);
    if target == src {
        return Ok(target.to_string_lossy().to_string()); // 変更なし
    }
    if target.exists() {
        return Err("EXISTS".into());
    }
    std::fs::rename(src, &target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

/// 親ディレクトリ配下に新規ディレクトリを作成する。既存なら "EXISTS"。
#[tauri::command]
fn make_dir(parent: String, name: String) -> Result<String, String> {
    let target = Path::new(&parent).join(&name);
    if target.exists() {
        return Err("EXISTS".into());
    }
    std::fs::create_dir(&target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

// ── プレビュー用データ取得 (FR-09) ─────────────────────────

/// プレビュー可能な最大読み取りバイト数の絶対上限（フロント指定値も再クランプ）。
const PREVIEW_READ_CEILING: usize = 1_048_576; // 1 MiB

/// 種別判定用に先頭から返すバイト数。
const SNIFF_BYTES: usize = 16;

/// プレビュー用のファイル内容（上限付き）。バイト列は JS に渡さず、テキストは
/// 常に妥当な UTF-8 にデコード済みで返す（`sniff` の先頭数バイトのみ例外）。
#[derive(Debug, Serialize, PartialEq)]
pub struct PreviewData {
    pub kind: String, // "text" | "binary" | "empty"
    pub size: u64,    // ファイル全体のバイト数
    pub read_bytes: usize,
    pub truncated: bool,  // size > read_bytes
    pub encoding: String, // "utf-8" | "utf-8-lossy" | "binary"
    pub text: Option<String>,
    pub sniff: Vec<u8>, // 先頭最大 SNIFF_BYTES バイト
}

/// フロント指定の上限を絶対上限にクランプする。
fn clamp_max_bytes(n: usize) -> usize {
    n.min(PREVIEW_READ_CEILING)
}

/// 先頭バイト列からテキストかバイナリかを判定する。NUL を含む、または非テキスト
/// 制御文字の比率が高い場合はバイナリとみなす（拡張子が .txt でもこちらを優先）。
fn is_binary_head(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }
    let mut suspicious = 0usize;
    for &b in bytes {
        if b == 0 {
            return true; // NUL は即バイナリ
        }
        // タブ(9)/改行(10)/復帰(13)以外の C0 制御文字を疑わしいとカウント
        if b < 9 || (b > 13 && b < 32) {
            suspicious += 1;
        }
    }
    // 3% 超が疑わしければバイナリ
    suspicious * 100 > bytes.len() * 3
}

/// `n` バイト以下で、UTF-8 のマルチバイト文字の途中に落ちない最大の文字境界を
/// 返す。位置 i が文字境界とは i==0 / i==len / bytes[i] が継続バイトでないこと。
fn truncate_at_char_boundary(bytes: &[u8], n: usize) -> usize {
    let len = bytes.len();
    let mut end = n.min(len);
    while end > 0 && end < len && (bytes[end] & 0b1100_0000) == 0b1000_0000 {
        end -= 1;
    }
    end
}

/// バイト列をテキストにデコードする。先頭 BOM を除去し、妥当な UTF-8 ならその
/// まま、そうでなければ lossy 変換する。戻り値は (テキスト, エンコーディング名)。
fn decode_text(bytes: &[u8]) -> (String, &'static str) {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(s) => (s.to_string(), "utf-8"),
        Err(_) => (String::from_utf8_lossy(bytes).to_string(), "utf-8-lossy"),
    }
}

/// 指定ファイルの内容を上限付きで読み、プレビュー用に整形して返す純粋ロジック。
fn read_preview_impl(path: &Path, max_bytes: usize) -> Result<PreviewData, String> {
    use std::io::Read;

    let meta = std::fs::metadata(path).map_err(|e| format!("{}: {}", path.display(), e))?;
    if meta.is_dir() {
        return Err("ディレクトリはプレビューできません".to_string());
    }
    if !meta.is_file() {
        // シンボリックリンク先以外の特殊ファイル（FIFO/デバイス等）は読まない
        return Err("通常ファイルではありません".to_string());
    }
    let size = meta.len();
    if size == 0 {
        return Ok(PreviewData {
            kind: "empty".to_string(),
            size: 0,
            read_bytes: 0,
            truncated: false,
            encoding: "utf-8".to_string(),
            text: Some(String::new()),
            sniff: Vec::new(),
        });
    }

    let limit = clamp_max_bytes(max_bytes);
    let mut file = std::fs::File::open(path).map_err(|e| format!("{}: {}", path.display(), e))?;
    let mut buf = Vec::new();
    file.by_ref()
        .take(limit as u64)
        .read_to_end(&mut buf)
        .map_err(|e| format!("{}: {}", path.display(), e))?;

    let read_bytes = buf.len();
    let truncated = size as usize > read_bytes;
    let sniff = buf[..buf.len().min(SNIFF_BYTES)].to_vec();

    if is_binary_head(&buf[..buf.len().min(4096)]) {
        return Ok(PreviewData {
            kind: "binary".to_string(),
            size,
            read_bytes,
            truncated,
            encoding: "binary".to_string(),
            text: None,
            sniff,
        });
    }

    let cut = truncate_at_char_boundary(&buf, buf.len());
    let (text, encoding) = decode_text(&buf[..cut]);
    Ok(PreviewData {
        kind: "text".to_string(),
        size,
        read_bytes,
        truncated,
        encoding: encoding.to_string(),
        text: Some(text),
        sniff,
    })
}

/// プレビュー用データを取得する Tauri コマンド。
#[tauri::command]
fn read_preview(path: String, max_bytes: usize) -> Result<PreviewData, String> {
    read_preview_impl(Path::new(&path), max_bytes)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            list_dir,
            home_dir,
            parent_dir,
            unique_name,
            copy_path,
            move_path,
            delete_to_trash,
            delete_permanent,
            rename_path,
            make_dir,
            read_preview
        ])
        .run(tauri::generate_context!())
        .expect("error while running tana application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn lists_entries_with_dirs_first() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir(tmp.path().join("zsub")).unwrap();
        fs::write(tmp.path().join("a.txt"), b"hello").unwrap();
        fs::write(tmp.path().join("b.txt"), b"hi").unwrap();

        let entries = read_dir_entries(tmp.path()).unwrap();
        assert_eq!(entries.len(), 3);
        // フォルダが先頭
        assert!(entries[0].is_dir);
        assert_eq!(entries[0].name, "zsub");
        // 残りは名前順のファイル
        assert_eq!(entries[1].name, "a.txt");
        assert_eq!(entries[1].size, 5);
        assert_eq!(entries[2].name, "b.txt");
    }

    #[test]
    fn errors_on_missing_dir() {
        let result = read_dir_entries(Path::new("/no/such/path/tana-xyz"));
        assert!(result.is_err());
    }

    #[test]
    fn parent_dir_returns_parent() {
        assert_eq!(parent_dir("/a/b/c".into()), Some("/a/b".to_string()));
        assert_eq!(parent_dir("/".into()), None);
    }

    #[test]
    fn marks_dotfiles_as_hidden() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join(".env"), b"x").unwrap();
        fs::write(tmp.path().join("visible.txt"), b"x").unwrap();

        let entries = read_dir_entries(tmp.path()).unwrap();
        let dot = entries.iter().find(|e| e.name == ".env").unwrap();
        let vis = entries.iter().find(|e| e.name == "visible.txt").unwrap();
        assert!(dot.is_hidden);
        assert!(!vis.is_hidden);
    }

    #[test]
    fn target_path_joins_basename() {
        let t = target_path(Path::new("/a/b/file.txt"), Path::new("/x/y"), None).unwrap();
        assert_eq!(t, PathBuf::from("/x/y/file.txt"));
        // dest_name 指定時はその名前
        let t2 = target_path(
            Path::new("/a/b/file.txt"),
            Path::new("/x/y"),
            Some("renamed.txt"),
        );
        assert_eq!(t2.unwrap(), PathBuf::from("/x/y/renamed.txt"));
    }

    #[test]
    fn unique_target_name_increments() {
        let tmp = tempfile::tempdir().unwrap();
        // 衝突なし → そのまま
        assert_eq!(unique_target_name(tmp.path(), "a.txt"), "a.txt");
        // 1つ存在 → " (1)"
        fs::write(tmp.path().join("a.txt"), b"x").unwrap();
        assert_eq!(unique_target_name(tmp.path(), "a.txt"), "a (1).txt");
        // 2つ存在 → " (2)"
        fs::write(tmp.path().join("a (1).txt"), b"x").unwrap();
        assert_eq!(unique_target_name(tmp.path(), "a.txt"), "a (2).txt");
        // 拡張子なし
        fs::write(tmp.path().join("noext"), b"x").unwrap();
        assert_eq!(unique_target_name(tmp.path(), "noext"), "noext (1)");
    }

    #[test]
    fn copy_recursive_copies_dir_tree() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        fs::create_dir(&src).unwrap();
        fs::write(src.join("a.txt"), b"hello").unwrap();
        fs::create_dir(src.join("sub")).unwrap();
        fs::write(src.join("sub/b.txt"), b"world").unwrap();

        let dst = tmp.path().join("dst");
        copy_recursive(&src, &dst).unwrap();
        assert_eq!(fs::read_to_string(dst.join("a.txt")).unwrap(), "hello");
        assert_eq!(fs::read_to_string(dst.join("sub/b.txt")).unwrap(), "world");
        // 元が残っている（コピー）
        assert!(src.join("a.txt").exists());
    }

    #[test]
    fn copy_path_blocks_existing_without_overwrite() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("dest");
        fs::create_dir(&dest).unwrap();
        let src = tmp.path().join("f.txt");
        fs::write(&src, b"x").unwrap();
        fs::write(dest.join("f.txt"), b"old").unwrap();

        let err = copy_path(
            src.to_string_lossy().into(),
            dest.to_string_lossy().into(),
            None,
            false,
        )
        .unwrap_err();
        assert_eq!(err, "EXISTS");
        // overwrite=true なら成功し上書き
        copy_path(
            src.to_string_lossy().into(),
            dest.to_string_lossy().into(),
            None,
            true,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(dest.join("f.txt")).unwrap(), "x");
        // dest_name 指定でインクリメント名コピー
        copy_path(
            src.to_string_lossy().into(),
            dest.to_string_lossy().into(),
            Some("f (1).txt".into()),
            false,
        )
        .unwrap();
        assert!(dest.join("f (1).txt").exists());
    }

    #[test]
    fn copy_to_same_dir_is_conflict_not_error() {
        // 同じディレクトリへの同名コピーは EXISTS（=3択モーダル）になる
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("f.txt");
        fs::write(&f, b"x").unwrap();
        let dir = tmp.path().to_string_lossy().to_string();

        let err = copy_path(f.to_string_lossy().into(), dir.clone(), None, false).unwrap_err();
        assert_eq!(err, "EXISTS");
        // 同一パスへの上書きは拒否（自分自身を消さない）
        let err2 = copy_path(f.to_string_lossy().into(), dir.clone(), None, true).unwrap_err();
        assert!(err2.contains("名前を変えて"));
        // 名前を変えれば複製できる
        copy_path(
            f.to_string_lossy().into(),
            dir,
            Some("f (1).txt".into()),
            false,
        )
        .unwrap();
        assert!(tmp.path().join("f (1).txt").exists());
        assert!(f.exists()); // 元は残る
    }

    #[test]
    fn move_path_moves_and_removes_source() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("dest");
        fs::create_dir(&dest).unwrap();
        let src = tmp.path().join("m.txt");
        fs::write(&src, b"data").unwrap();

        move_path(
            src.to_string_lossy().into(),
            dest.to_string_lossy().into(),
            None,
            false,
        )
        .unwrap();
        assert!(!src.exists());
        assert_eq!(fs::read_to_string(dest.join("m.txt")).unwrap(), "data");
    }

    #[test]
    fn rename_path_renames_and_blocks_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a.txt");
        fs::write(&a, b"x").unwrap();

        let newp = rename_path(a.to_string_lossy().into(), "b.txt".into()).unwrap();
        assert!(!a.exists());
        assert!(tmp.path().join("b.txt").exists());
        assert!(newp.ends_with("b.txt"));

        // 既存名へのリネームは EXISTS
        fs::write(tmp.path().join("c.txt"), b"y").unwrap();
        let err = rename_path(
            tmp.path().join("b.txt").to_string_lossy().into(),
            "c.txt".into(),
        )
        .unwrap_err();
        assert_eq!(err, "EXISTS");
    }

    #[test]
    fn make_dir_creates_and_blocks_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_string_lossy().to_string();
        make_dir(dir.clone(), "newdir".into()).unwrap();
        assert!(tmp.path().join("newdir").is_dir());
        // 既存なら EXISTS
        let err = make_dir(dir, "newdir".into()).unwrap_err();
        assert_eq!(err, "EXISTS");
    }

    #[test]
    fn delete_permanent_removes_file_and_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("x.txt");
        fs::write(&f, b"x").unwrap();
        delete_permanent(f.to_string_lossy().into()).unwrap();
        assert!(!f.exists());

        let d = tmp.path().join("d");
        fs::create_dir(&d).unwrap();
        fs::write(d.join("inner.txt"), b"y").unwrap();
        delete_permanent(d.to_string_lossy().into()).unwrap();
        assert!(!d.exists());
    }

    // ── プレビュー (FR-09) ──────────────────────────────

    #[test]
    fn clamp_max_bytes_caps_at_ceiling() {
        assert_eq!(clamp_max_bytes(0), 0);
        assert_eq!(clamp_max_bytes(100), 100);
        assert_eq!(
            clamp_max_bytes(PREVIEW_READ_CEILING + 1),
            PREVIEW_READ_CEILING
        );
        assert_eq!(clamp_max_bytes(usize::MAX), PREVIEW_READ_CEILING);
    }

    #[test]
    fn is_binary_head_detects_nul_and_control_ratio() {
        assert!(!is_binary_head(b""));
        assert!(!is_binary_head(b"hello world\n\ttab"));
        assert!(!is_binary_head("日本語テキスト".as_bytes()));
        assert!(is_binary_head(b"ab\0cd")); // NUL
                                            // 制御文字だらけ
        assert!(is_binary_head(&[0x01, 0x02, 0x03, 0x04, 0x05, b'a']));
    }

    #[test]
    fn truncate_at_char_boundary_keeps_multibyte_whole() {
        // "あ" は 3 バイト (0xE3 0x81 0x82)
        let s = "あい".as_bytes(); // 6 バイト
        assert_eq!(truncate_at_char_boundary(s, 6), 6); // ぴったり
        assert_eq!(truncate_at_char_boundary(s, 5), 3); // 2文字目の途中→1文字で切る
        assert_eq!(truncate_at_char_boundary(s, 4), 3); // 同上
        assert_eq!(truncate_at_char_boundary(s, 3), 3); // 1文字目ぴったり
        assert_eq!(truncate_at_char_boundary(s, 2), 0); // 1文字目の途中→空
        assert_eq!(truncate_at_char_boundary(s, 1), 0);
        // 常に有効な UTF-8 になること
        for n in 0..=6 {
            let cut = truncate_at_char_boundary(s, n);
            assert!(std::str::from_utf8(&s[..cut]).is_ok());
        }
    }

    #[test]
    fn decode_text_strips_bom_and_handles_invalid() {
        let (t, e) = decode_text(&[0xEF, 0xBB, 0xBF, b'h', b'i']);
        assert_eq!(t, "hi");
        assert_eq!(e, "utf-8");
        let (t2, e2) = decode_text(&[0xff, 0xfe, b'x']);
        assert_eq!(e2, "utf-8-lossy");
        assert!(t2.contains('x'));
    }

    #[test]
    fn read_preview_impl_handles_missing_dir_empty_and_text() {
        let tmp = tempfile::tempdir().unwrap();
        // 存在しない
        assert!(read_preview_impl(&tmp.path().join("nope.txt"), 1024).is_err());
        // ディレクトリ
        assert!(read_preview_impl(tmp.path(), 1024).is_err());
        // 空ファイル
        let empty = tmp.path().join("empty.txt");
        fs::write(&empty, b"").unwrap();
        let p = read_preview_impl(&empty, 1024).unwrap();
        assert_eq!(p.kind, "empty");
        assert_eq!(p.size, 0);
        assert!(!p.truncated);
        // テキスト
        let txt = tmp.path().join("a.md");
        fs::write(&txt, "# 見出し\n本文".as_bytes()).unwrap();
        let p = read_preview_impl(&txt, 1024).unwrap();
        assert_eq!(p.kind, "text");
        assert_eq!(p.encoding, "utf-8");
        assert_eq!(p.text.as_deref(), Some("# 見出し\n本文"));
        assert!(!p.truncated);
    }

    #[test]
    fn read_preview_impl_truncates_and_flags() {
        let tmp = tempfile::tempdir().unwrap();
        let big = tmp.path().join("big.txt");
        fs::write(&big, "x".repeat(1000).as_bytes()).unwrap();
        let p = read_preview_impl(&big, 100).unwrap();
        assert_eq!(p.kind, "text");
        assert_eq!(p.read_bytes, 100);
        assert!(p.truncated);
        assert_eq!(p.size, 1000);
    }

    #[test]
    fn read_preview_impl_flags_binary() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("data.bin");
        fs::write(&bin, [0u8, 1, 2, 3, 4, 0, 255]).unwrap();
        let p = read_preview_impl(&bin, 1024).unwrap();
        assert_eq!(p.kind, "binary");
        assert!(p.text.is_none());
        assert_eq!(p.encoding, "binary");
        assert!(!p.sniff.is_empty());
    }
}
