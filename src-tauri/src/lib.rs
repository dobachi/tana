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
        entries.push(DirEntry {
            name,
            path: item.path().to_string_lossy().to_string(),
            is_dir,
            size,
            is_hidden,
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
    if target == src {
        return Err("コピー元と宛先が同じです".into());
    }
    if target.exists() && !overwrite {
        return Err("EXISTS".into());
    }
    if target.exists() {
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
    if target == src {
        return Err("移動元と宛先が同じです".into());
    }
    if target.exists() {
        if !overwrite {
            return Err("EXISTS".into());
        }
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

/// 新規ディレクトリを作成する。
#[tauri::command]
fn make_dir(path: String) -> Result<(), String> {
    std::fs::create_dir(Path::new(&path)).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_dir,
            home_dir,
            parent_dir,
            unique_name,
            copy_path,
            move_path,
            delete_to_trash,
            delete_permanent,
            make_dir
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
}
