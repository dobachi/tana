use std::path::Path;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![list_dir, home_dir, parent_dir])
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
}
