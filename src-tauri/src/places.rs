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
    /// "drive" | "cloud" | "wsl" | "home" | "folder"
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

/// クラウド同期フォルダらしい名前か（大小無視）。OneDrive（個人/職場の
/// 「OneDrive - 会社名」を含む）・Box・Dropbox・Google Drive など、OS 上は
/// ホーム直下のフォルダとして現れるものを対象にする（クラウドは特別 API では
/// なくパスで扱う方針）。
fn is_cloud_folder(name: &str) -> bool {
    let n = name.trim().to_ascii_lowercase();
    n == "onedrive"
        || n.starts_with("onedrive -")
        || n.starts_with("onedrive-")
        || n == "box"
        || n == "dropbox"
        || n == "google drive"
        || n == "googledrive"
        || n == "creative cloud files"
}

/// ホーム直下のディレクトリ名から、クラウド同期フォルダを Place 化する（純粋）。
/// 名前順に整列。存在確認は build_places 側。
fn cloud_places_from(home: &str, mut names: Vec<String>) -> Vec<Place> {
    names.retain(|n| is_cloud_folder(n));
    names.sort();
    names
        .into_iter()
        .map(|n| {
            let path = format!("{home}/{n}");
            Place::new(n, path, "cloud")
        })
        .collect()
}

/// ホーム直下を走査してクラウド同期フォルダを検出する。
fn cloud_places() -> Vec<Place> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let home_s = to_slash(&home);
    let mut names = Vec::new();
    if let Ok(read) = std::fs::read_dir(&home) {
        for e in read.flatten() {
            if e.path().is_dir() {
                names.push(e.file_name().to_string_lossy().to_string());
            }
        }
    }
    cloud_places_from(&home_s, names)
}

/// あるディレクトリ直下のサブディレクトリを指定 kind の Place として列挙する
/// （macOS の /Volumes・Linux の /mnt, /media 用）。名前順。
#[cfg(any(not(windows), test))]
fn read_subdirs(base: &str, kind: &str) -> Vec<Place> {
    let mut out = Vec::new();
    if let Ok(read) = std::fs::read_dir(base) {
        for entry in read.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                out.push(Place::new(name, to_slash(&path), kind));
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
    read_subdirs("/Volumes", "drive")
}

#[cfg(all(unix, not(target_os = "macos")))]
fn drive_candidates() -> Vec<Place> {
    // WSL からは /mnt/<letter> に Windows ドライブが、
    // 一般の Linux では /media にリムーバブルが現れる。
    let mut v = read_subdirs("/mnt", "drive");
    v.extend(read_subdirs("/media", "drive"));
    v
}

/// レジストリ（`HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss`）の
/// 登録 1 件: サブキー名（GUID）とディストロ名。
#[cfg(any(windows, test))]
#[derive(Debug, Clone, PartialEq)]
pub struct WslDistro {
    pub id: String,
    pub name: String,
}

/// Docker Desktop / Rancher Desktop が自分用に入れる内部ディストロ。
/// 中身はユーザーのファイルではないので「場所」には出さない。
#[cfg(any(windows, test))]
fn is_internal_distro(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.starts_with("docker-desktop") || n.starts_with("rancher-desktop")
}

/// インストール済みディストロから「場所」を作る（純粋）。
///
/// パスは `//wsl$/<distro>`（to_slash 済みの UNC 形式。`\\wsl$` は Windows 10
/// の古い版でも通じる）。既定のディストロを先頭に、残りは名前順。空の名前・
/// 内部ディストロ・名前の重複は除く。
#[cfg(any(windows, test))]
pub fn wsl_places_from(distros: Vec<WslDistro>, default_id: Option<&str>) -> Vec<Place> {
    let default_id = default_id.map(|d| d.to_ascii_lowercase());
    let mut v: Vec<&WslDistro> = distros
        .iter()
        .filter(|d| !d.name.trim().is_empty() && !is_internal_distro(&d.name))
        .collect();
    let is_default = |d: &WslDistro| Some(d.id.to_ascii_lowercase()) == default_id;
    v.sort_by(|a, b| {
        is_default(b)
            .cmp(&is_default(a))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    let mut seen = HashSet::new();
    v.into_iter()
        .filter(|d| seen.insert(d.name.to_lowercase()))
        .map(|d| Place::new(d.name.clone(), format!("//wsl$/{}", d.name), "wsl"))
        .collect()
}

/// インストール済みの WSL ディストロをレジストリから読む（Windows のみ）。
///
/// `\\wsl$` / `\\wsl.localhost` の直下は FindFirstFile では列挙できない
/// （PowerShell でも「パスが存在しない」になる）ため、そこを read_dir しても
/// 何も見つからない。登録はレジストリにあり、止まっているディストロも載る。
#[cfg(windows)]
fn installed_wsl_distros() -> (Vec<WslDistro>, Option<String>) {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let Ok(lxss) = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Lxss")
    else {
        return (Vec::new(), None);
    };
    let default_id: Option<String> = lxss.get_value("DefaultDistribution").ok();
    let mut out = Vec::new();
    for id in lxss.enum_keys().flatten() {
        let Ok(key) = lxss.open_subkey(&id) else {
            continue;
        };
        if let Ok(name) = key.get_value::<String, _>("DistributionName") {
            out.push(WslDistro { id, name });
        }
    }
    (out, default_id)
}

/// WSL ディストロ（Windows のみ）。存在確認はしない: 止まっているディストロの
/// パスに触ると、それだけで起動してしまう（起動はクリックしたときでよい）。
#[cfg(windows)]
fn wsl_places() -> Vec<Place> {
    let (distros, default_id) = installed_wsl_distros();
    wsl_places_from(distros, default_id.as_deref())
}

#[cfg(not(windows))]
fn wsl_places() -> Vec<Place> {
    Vec::new()
}

/// 「場所」一覧を返す Tauri コマンド。ドライブ/ボリュームを先に、続けて
/// 標準フォルダを並べる（別ドライブへ切り替える導線を上位に置く）。
#[tauri::command]
pub fn list_places() -> Vec<Place> {
    let mut candidates = drive_candidates();
    candidates.extend(cloud_places());
    let drives_and_cloud = build_places(candidates, |p| Path::new(p).exists());
    let standard = build_places(standard_candidates(), |p| Path::new(p).exists());
    // WSL は存在確認を通さない（wsl_places のコメント参照）。並びは
    // ドライブ・クラウド → WSL → 標準フォルダのまま。
    let mut all = drives_and_cloud;
    all.extend(wsl_places());
    all.extend(standard);
    build_places(all, |_| true)
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

    #[test]
    fn read_subdirs_lists_only_dirs_with_given_kind_sorted() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("Ubuntu")).unwrap();
        std::fs::create_dir(tmp.path().join("Debian")).unwrap();
        std::fs::write(tmp.path().join("afile"), b"x").unwrap();
        let base = tmp.path().to_string_lossy().to_string();
        let got = read_subdirs(&base, "wsl");
        let names: Vec<_> = got.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["Debian", "Ubuntu"]); // 名前順・ファイルは除外
        assert!(got.iter().all(|p| p.kind == "wsl"));
    }

    fn distro(id: &str, name: &str) -> WslDistro {
        WslDistro {
            id: id.into(),
            name: name.into(),
        }
    }

    #[test]
    fn wsl_places_lists_installed_distros_as_unc_paths_by_name() {
        let got = wsl_places_from(
            vec![distro("{b}", "Ubuntu-22.04"), distro("{a}", "CentOS7")],
            None,
        );
        assert_eq!(
            got,
            vec![
                p("CentOS7", "//wsl$/CentOS7", "wsl"),
                p("Ubuntu-22.04", "//wsl$/Ubuntu-22.04", "wsl"),
            ]
        );
    }

    #[test]
    fn wsl_places_puts_the_default_distro_first() {
        let got = wsl_places_from(
            vec![
                distro("{a}", "Alpine"),
                distro("{B-GUID}", "Ubuntu"),
                distro("{c}", "Debian"),
            ],
            Some("{b-guid}"), // GUID の大小文字は区別しない
        );
        let names: Vec<_> = got.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["Ubuntu", "Alpine", "Debian"]);
    }

    #[test]
    fn wsl_places_skips_internal_empty_and_duplicate_distros() {
        let got = wsl_places_from(
            vec![
                distro("{1}", "docker-desktop"),
                distro("{2}", "docker-desktop-data"),
                distro("{3}", "Rancher-Desktop"),
                distro("{4}", "  "),
                distro("{5}", "Ubuntu"),
                distro("{6}", "ubuntu"),
            ],
            None,
        );
        assert_eq!(got, vec![p("Ubuntu", "//wsl$/Ubuntu", "wsl")]);
    }

    #[test]
    fn wsl_places_empty_without_distros() {
        assert!(wsl_places_from(Vec::new(), Some("{x}")).is_empty());
    }

    #[test]
    fn is_cloud_folder_matches_known_services_case_insensitively() {
        assert!(is_cloud_folder("OneDrive"));
        assert!(is_cloud_folder("onedrive"));
        assert!(is_cloud_folder("OneDrive - Contoso")); // 職場/学校
        assert!(is_cloud_folder("Box"));
        assert!(is_cloud_folder("Dropbox"));
        assert!(is_cloud_folder("Google Drive"));
        assert!(!is_cloud_folder("Documents"));
        assert!(!is_cloud_folder("OneDrives")); // 前方一致だけで拾わない
    }

    #[test]
    fn cloud_places_from_filters_sorts_and_builds_paths() {
        let home = "C:/Users/x";
        let names = vec![
            "Documents".to_string(),
            "OneDrive - Contoso".to_string(),
            "Box".to_string(),
            "OneDrive".to_string(),
        ];
        let got = cloud_places_from(home, names);
        assert_eq!(
            got,
            vec![
                p("Box", "C:/Users/x/Box", "cloud"),
                p("OneDrive", "C:/Users/x/OneDrive", "cloud"),
                p(
                    "OneDrive - Contoso",
                    "C:/Users/x/OneDrive - Contoso",
                    "cloud"
                ),
            ]
        );
    }
}
