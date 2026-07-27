//! places.rs — 「場所(Places)」の検出 (FR-07)。
//!
//! クラウド/WSL アクセスは特別な API ではなく「ファイルパス」で実現する方針
//! なので、ここではドライブ/ボリュームと標準フォルダを列挙してサイドバーに
//! 出す。OS 依存の列挙（ドライブの存在確認・/Volumes や /mnt の走査）は薄く
//! 保ち、並べ替え・重複除去・ドライブ候補生成といった純粋ロジックは注入で
//! テスト可能な関数に切り出す。

use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;

/// サイドバーに出す「場所」1 件。
#[derive(Debug, Serialize, PartialEq, Clone)]
pub struct Place {
    pub name: String,
    pub path: String,
    /// "drive" | "home" | "folder"
    pub kind: String,
}

impl Place {
    fn new(name: impl Into<String>, path: impl Into<String>, kind: &str) -> Self {
        Place {
            name: name.into(),
            path: path.into(),
            kind: kind.into(),
        }
    }
}

/// パス区切りを "/" に統一する（ドライブの "C:/" 形式と揃える）。
fn to_slash(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

/// 候補（存在するとは限らない）から、実在するものだけを・パス重複なしで、
/// 入力順を保って返す。存在判定を注入して単体テスト可能にする。
pub fn build_places<F: Fn(&str) -> bool>(candidates: Vec<Place>, exists: F) -> Vec<Place> {
    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|p| exists(&p.path))
        .filter(|p| seen.insert(p.path.clone()))
        .collect()
}

/// Windows のドライブ候補（A:〜Z:）。パスは "C:/" 形式に統一。存在確認は
/// build_places 側に委ねる（この関数自体は FS を触らず純粋）。
/// Windows 本番と、全 OS のテストでのみコンパイルする（他 OS ではデッドコード）。
#[cfg(any(windows, test))]
pub fn windows_drive_candidates() -> Vec<Place> {
    ('A'..='Z')
        .map(|c| Place::new(format!("{c}:"), format!("{c}:/"), "drive"))
        .collect()
}

/// 標準フォルダの候補（dirs から取得できたものだけ）。存在確認は build_places 側。
pub fn standard_candidates() -> Vec<Place> {
    let mut v = Vec::new();
    if let Some(p) = dirs::home_dir() {
        v.push(Place::new("ホーム", to_slash(&p), "home"));
    }
    if let Some(p) = dirs::desktop_dir() {
        v.push(Place::new("デスクトップ", to_slash(&p), "folder"));
    }
    if let Some(p) = dirs::document_dir() {
        v.push(Place::new("ドキュメント", to_slash(&p), "folder"));
    }
    if let Some(p) = dirs::download_dir() {
        v.push(Place::new("ダウンロード", to_slash(&p), "folder"));
    }
    v
}

/// あるディレクトリ直下のサブディレクトリを、ボリューム（ドライブ扱い）として
/// 列挙する（macOS の /Volumes・Linux の /mnt, /media 用）。
#[cfg(unix)]
fn read_volume_dir(base: &str) -> Vec<Place> {
    let mut out = Vec::new();
    if let Ok(read) = std::fs::read_dir(base) {
        for entry in read.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                out.push(Place::new(name, to_slash(&path), "drive"));
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// OS ごとのドライブ/ボリューム候補。
#[cfg(windows)]
fn drive_candidates() -> Vec<Place> {
    windows_drive_candidates()
}

#[cfg(target_os = "macos")]
fn drive_candidates() -> Vec<Place> {
    read_volume_dir("/Volumes")
}

#[cfg(all(unix, not(target_os = "macos")))]
fn drive_candidates() -> Vec<Place> {
    // WSL からは /mnt/<letter> に Windows ドライブが、
    // 一般の Linux では /media にリムーバブルが現れる。
    let mut v = read_volume_dir("/mnt");
    v.extend(read_volume_dir("/media"));
    v
}

/// 「場所」一覧を返す Tauri コマンド。ドライブ/ボリュームを先に、続けて
/// 標準フォルダを並べる（別ドライブへ切り替える導線を上位に置く）。
#[tauri::command]
pub fn list_places() -> Vec<Place> {
    let mut candidates = drive_candidates();
    candidates.extend(standard_candidates());
    build_places(candidates, |p| Path::new(p).exists())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(name: &str, path: &str, kind: &str) -> Place {
        Place::new(name, path, kind)
    }

    #[test]
    fn windows_drive_candidates_covers_a_to_z() {
        let d = windows_drive_candidates();
        assert_eq!(d.len(), 26);
        assert_eq!(d[0], p("A:", "A:/", "drive"));
        assert_eq!(d[2], p("C:", "C:/", "drive"));
        assert_eq!(d[25], p("Z:", "Z:/", "drive"));
    }

    #[test]
    fn build_places_keeps_only_existing_in_order() {
        let existing: HashSet<&str> = ["C:/", "I:/"].into_iter().collect();
        let got = build_places(windows_drive_candidates(), |p| existing.contains(p));
        assert_eq!(got, vec![p("C:", "C:/", "drive"), p("I:", "I:/", "drive")]);
    }

    #[test]
    fn build_places_dedups_by_path_keeping_first() {
        let cand = vec![
            p("ホーム", "C:/Users/x", "home"),
            p("C:", "C:/", "drive"),
            p("dup", "C:/Users/x", "folder"), // 同じパスは後勝ちにせず捨てる
        ];
        let got = build_places(cand, |_| true);
        assert_eq!(
            got,
            vec![p("ホーム", "C:/Users/x", "home"), p("C:", "C:/", "drive")]
        );
    }

    #[test]
    fn build_places_empty_when_nothing_exists() {
        let got = build_places(windows_drive_candidates(), |_| false);
        assert!(got.is_empty());
    }
}
