//! ダウンロード型拡張 (Fude の拡張機構と同じ構成)。
//!
//! 重いエンジン（PDF の pdf.js など）は本体に含めず、使う人だけが 設定 → 拡張機能 で
//! 有効にしたときに取得する。カタログは公開リポジトリ dobachi/tana-extensions の
//! `manifest.json`、実体はそのリリースアセット。各ファイルを SHA-256 で検証してから
//! `<設定フォルダ>/tana/extensions/<id>/<version>/` へ置き、`.complete` で完了を示す。
//!
//! 取得した中身はアプリの権限を持たない sandbox iframe の中でだけ動かす（フロント側）。

use std::fs;
use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

/// 拡張カタログの URL（アプリに固定。HTTPS で取得する）。
const MANIFEST_URL: &str =
    "https://raw.githubusercontent.com/dobachi/tana-extensions/main/manifest.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionFile {
    pub rel: String,
    pub url: String,
    pub sha256: String,
    #[serde(default)]
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub total_size: u64,
    pub files: Vec<ExtensionFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionManifest {
    #[serde(default)]
    pub schema: u32,
    pub extensions: Vec<ExtensionEntry>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ExtensionStatus {
    pub installed: bool,
    pub version: Option<String>,
}

/// ダウンロードの進み具合（バイト数）。完了・失敗はコマンドの戻り値で伝える。
#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    progress: u64,
    total: u64,
}

/// 拡張の置き場所 `<config>/tana/extensions`（無ければ作る）。
fn extensions_root() -> Result<PathBuf, String> {
    let base = dirs::config_dir().ok_or("設定フォルダが見つかりません")?;
    let dir = base.join("tana").join("extensions");
    fs::create_dir_all(&dir).map_err(|e| format!("拡張機能のフォルダを作れません: {e}"))?;
    Ok(dir)
}

/// id / version が置き場所の外へ出ないか（区切り文字や `..` を拒む）。
fn is_safe_component(s: &str) -> bool {
    !s.is_empty()
        && s != "."
        && s != ".."
        && !s.contains('/')
        && !s.contains('\\')
        && !s.contains(':')
}

/// 拡張内のファイル名（`a/b.js` は可。`..`・`\`・絶対パスは不可）。
fn is_safe_rel(rel: &str) -> bool {
    !rel.is_empty()
        && !rel.starts_with('/')
        && !rel.contains('\\')
        && !rel.contains(':')
        && rel
            .split('/')
            .all(|c| !c.is_empty() && c != "." && c != "..")
}

/// 導入済みのバージョンとその場所（`.complete` のあるもの）。
fn find_installed(root: &Path, id: &str) -> Option<(String, PathBuf)> {
    let entries = fs::read_dir(root.join(id)).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && path.join(".complete").exists() {
            if let Some(ver) = path.file_name().and_then(|s| s.to_str()) {
                return Some((ver.to_string(), path));
            }
        }
    }
    None
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(bytes))
}

fn status_in(root: &Path, id: &str) -> Result<ExtensionStatus, String> {
    if !is_safe_component(id) {
        return Err(format!("拡張機能の id が不正です: {id}"));
    }
    Ok(match find_installed(root, id) {
        Some((version, _)) => ExtensionStatus {
            installed: true,
            version: Some(version),
        },
        None => ExtensionStatus {
            installed: false,
            version: None,
        },
    })
}

fn read_file_in(root: &Path, id: &str, rel: &str) -> Result<String, String> {
    if !is_safe_component(id) || !is_safe_rel(rel) {
        return Err("拡張機能のファイル名が不正です".to_string());
    }
    let (_, dir) =
        find_installed(root, id).ok_or_else(|| format!("拡張機能 {id} は入っていません"))?;
    fs::read_to_string(dir.join(rel)).map_err(|e| format!("{rel} を読めません: {e}"))
}

fn uninstall_in(root: &Path, id: &str) -> Result<(), String> {
    if !is_safe_component(id) {
        return Err(format!("拡張機能の id が不正です: {id}"));
    }
    let dir = root.join(id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("拡張機能 {id} を削除できません: {e}"))?;
    }
    Ok(())
}

/// 取得済みのファイル群を検証して `<id>/<version>` に置く。途中で失敗したら何も残さない。
/// ネットワークから切り離してあり、単体テストできる。
fn store_verified(
    root: &Path,
    entry: &ExtensionEntry,
    files: &[(String, Vec<u8>)],
) -> Result<PathBuf, String> {
    if !is_safe_component(&entry.id) || !is_safe_component(&entry.version) {
        return Err("拡張機能の id / バージョンが不正です".to_string());
    }
    let id_dir = root.join(&entry.id);
    fs::create_dir_all(&id_dir).map_err(|e| format!("{} を作れません: {e}", entry.id))?;
    let tmp = id_dir.join(format!("{}.tmp", entry.version));
    let _ = fs::remove_dir_all(&tmp);
    let result = (|| {
        for (rel, bytes) in files {
            let spec = entry
                .files
                .iter()
                .find(|f| &f.rel == rel)
                .ok_or_else(|| format!("カタログに無いファイルです: {rel}"))?;
            if !is_safe_rel(rel) {
                return Err(format!("ファイル名が不正です: {rel}"));
            }
            let actual = sha256_hex(bytes);
            if spec.sha256.is_empty() || !actual.eq_ignore_ascii_case(&spec.sha256) {
                return Err(format!(
                    "{rel} の検証に失敗しました（SHA-256 が一致しません）"
                ));
            }
            let dest = tmp.join(rel);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("{rel} を置けません: {e}"))?;
            }
            fs::write(&dest, bytes).map_err(|e| format!("{rel} を書き込めません: {e}"))?;
        }
        if files.len() != entry.files.len() {
            return Err("ダウンロードしたファイルが足りません".to_string());
        }
        let final_dir = id_dir.join(&entry.version);
        let _ = fs::remove_dir_all(&final_dir);
        fs::rename(&tmp, &final_dir).map_err(|e| format!("拡張機能を配置できません: {e}"))?;
        fs::write(final_dir.join(".complete"), entry.version.as_bytes())
            .map_err(|e| format!("拡張機能を配置できません: {e}"))?;
        Ok(final_dir)
    })();
    match result {
        Ok(final_dir) => {
            // 古いバージョンは消して場所を空ける
            if let Ok(entries) = fs::read_dir(&id_dir) {
                for e in entries.flatten() {
                    let p = e.path();
                    if p.is_dir() && p != final_dir {
                        let _ = fs::remove_dir_all(&p);
                    }
                }
            }
            Ok(final_dir)
        }
        Err(e) => {
            let _ = fs::remove_dir_all(&tmp);
            Err(e)
        }
    }
}

fn http_client() -> reqwest::Client {
    // reqwest は updater と同じく TLS の実装を選ばない構成なので、ここで ring を使うと決める
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::new()
}

async fn fetch_manifest() -> Result<ExtensionManifest, String> {
    let resp = http_client()
        .get(MANIFEST_URL)
        .send()
        .await
        .map_err(|e| format!("拡張機能の一覧を取得できません: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "拡張機能の一覧を取得できません: HTTP {}",
            resp.status()
        ));
    }
    let text = resp
        .text()
        .await
        .map_err(|e| format!("拡張機能の一覧を読めません: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("拡張機能の一覧が壊れています: {e}"))
}

/// 拡張が入っているか。
#[tauri::command]
pub fn extension_status(id: String) -> Result<ExtensionStatus, String> {
    status_in(&extensions_root()?, &id)
}

/// 導入済み拡張のファイルの中身（テキスト）。フロントが sandbox iframe へ渡して blob: で読む。
#[tauri::command]
pub fn read_extension_file(id: String, rel: String) -> Result<String, String> {
    read_file_in(&extensions_root()?, &id, &rel)
}

/// 拡張を削除する。
#[tauri::command]
pub fn uninstall_extension(id: String) -> Result<(), String> {
    uninstall_in(&extensions_root()?, &id)
}

/// 拡張をダウンロード・検証・配置する。進み具合は `on_progress` に流す。
#[tauri::command]
pub async fn install_extension(
    id: String,
    on_progress: Channel<DownloadProgress>,
) -> Result<(), String> {
    install_inner(&id, &on_progress).await
}

async fn install_inner(id: &str, on_progress: &Channel<DownloadProgress>) -> Result<(), String> {
    if !is_safe_component(id) {
        return Err(format!("拡張機能の id が不正です: {id}"));
    }
    let entry = fetch_manifest()
        .await?
        .extensions
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| format!("拡張機能 {id} は一覧にありません"))?;
    let total = if entry.total_size > 0 {
        entry.total_size
    } else {
        entry.files.iter().map(|f| f.size).sum()
    };

    let client = http_client();
    let mut done: u64 = 0;
    let mut files = Vec::with_capacity(entry.files.len());
    for f in &entry.files {
        if !is_safe_rel(&f.rel) {
            return Err(format!("ファイル名が不正です: {}", f.rel));
        }
        let resp = client
            .get(&f.url)
            .send()
            .await
            .map_err(|e| format!("{} をダウンロードできません: {e}", f.rel))?;
        if !resp.status().is_success() {
            return Err(format!(
                "{} をダウンロードできません: HTTP {}",
                f.rel,
                resp.status()
            ));
        }
        let mut buf = Vec::new();
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("{} の受信が途切れました: {e}", f.rel))?;
            buf.extend_from_slice(&chunk);
            done += chunk.len() as u64;
            let _ = on_progress.send(DownloadProgress {
                progress: done,
                total,
            });
        }
        files.push((f.rel.clone(), buf));
    }
    store_verified(&extensions_root()?, &entry, &files).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(files: &[(&str, &[u8])]) -> ExtensionEntry {
        ExtensionEntry {
            id: "pdfjs".into(),
            name: "PDF Preview".into(),
            version: "1.0.0".into(),
            description: None,
            total_size: 0,
            files: files
                .iter()
                .map(|(rel, bytes)| ExtensionFile {
                    rel: rel.to_string(),
                    url: format!("https://example.invalid/{rel}"),
                    sha256: sha256_hex(bytes),
                    size: bytes.len() as u64,
                })
                .collect(),
        }
    }

    fn owned(files: &[(&str, &[u8])]) -> Vec<(String, Vec<u8>)> {
        files
            .iter()
            .map(|(r, b)| (r.to_string(), b.to_vec()))
            .collect()
    }

    /// 実際のカタログを取得して pdfjs が載っていることを確かめる（ネットワークが要るので手動:
    /// `cargo test extensions -- --ignored`）。
    #[test]
    #[ignore]
    fn fetches_real_manifest() {
        let m = tauri::async_runtime::block_on(fetch_manifest()).unwrap();
        let pdf = m.extensions.iter().find(|e| e.id == "pdfjs").unwrap();
        assert!(pdf
            .files
            .iter()
            .all(|f| is_safe_rel(&f.rel) && !f.sha256.is_empty()));
    }

    #[test]
    fn manifest_parses() {
        let json = r#"{"schema":1,"extensions":[{"id":"pdfjs","name":"PDF","version":"4.10.38",
            "files":[{"rel":"pdf.min.mjs","url":"https://x/pdf.min.mjs","sha256":"ab","size":2}]}]}"#;
        let m: ExtensionManifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.extensions[0].id, "pdfjs");
        assert_eq!(m.extensions[0].files[0].size, 2);
        assert_eq!(m.extensions[0].total_size, 0);
    }

    #[test]
    fn rejects_unsafe_names() {
        for bad in ["", ".", "..", "a/b", "a\\b", "c:x"] {
            assert!(!is_safe_component(bad), "{bad}");
        }
        assert!(is_safe_component("4.10.38"));
        assert!(is_safe_rel("fonts/a.ttf"));
        for bad in ["", "/etc/passwd", "../x", "a/../b", "a\\b", "c:/x", "a//b"] {
            assert!(!is_safe_rel(bad), "{bad}");
        }
    }

    #[test]
    fn stores_verified_files_and_reports_status() {
        let root = tempfile::tempdir().unwrap();
        let files: &[(&str, &[u8])] = &[("pdf.min.mjs", b"engine"), ("sub/cmaps.json", b"{}")];
        let e = entry(files);
        assert_eq!(status_in(root.path(), "pdfjs").unwrap().installed, false);
        let dir = store_verified(root.path(), &e, &owned(files)).unwrap();
        assert!(dir.join(".complete").exists());
        assert_eq!(
            status_in(root.path(), "pdfjs").unwrap(),
            ExtensionStatus {
                installed: true,
                version: Some("1.0.0".into())
            }
        );
        assert_eq!(
            read_file_in(root.path(), "pdfjs", "sub/cmaps.json").unwrap(),
            "{}"
        );
        assert!(read_file_in(root.path(), "pdfjs", "../x").is_err());
        uninstall_in(root.path(), "pdfjs").unwrap();
        assert_eq!(status_in(root.path(), "pdfjs").unwrap().installed, false);
    }

    #[test]
    fn checksum_mismatch_leaves_nothing_installed() {
        let root = tempfile::tempdir().unwrap();
        let e = entry(&[("pdf.min.mjs", b"engine")]);
        let err = store_verified(root.path(), &e, &owned(&[("pdf.min.mjs", b"tampered")]));
        assert!(err.unwrap_err().contains("SHA-256"));
        assert_eq!(status_in(root.path(), "pdfjs").unwrap().installed, false);
        assert!(!root.path().join("pdfjs/1.0.0.tmp").exists());
    }

    #[test]
    fn missing_or_unknown_files_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let e = entry(&[("a.js", b"a"), ("b.js", b"b")]);
        assert!(store_verified(root.path(), &e, &owned(&[("a.js", b"a")])).is_err());
        assert!(store_verified(root.path(), &e, &owned(&[("zzz.js", b"a")])).is_err());
        assert_eq!(status_in(root.path(), "pdfjs").unwrap().installed, false);
    }

    #[test]
    fn new_version_replaces_old() {
        let root = tempfile::tempdir().unwrap();
        let files: &[(&str, &[u8])] = &[("a.js", b"a")];
        let mut e = entry(files);
        store_verified(root.path(), &e, &owned(files)).unwrap();
        e.version = "2.0.0".into();
        store_verified(root.path(), &e, &owned(files)).unwrap();
        assert!(!root.path().join("pdfjs/1.0.0").exists());
        assert_eq!(
            status_in(root.path(), "pdfjs").unwrap().version.as_deref(),
            Some("2.0.0")
        );
    }
}
