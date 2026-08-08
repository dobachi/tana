//! wsl.rs — WSL(Linux) 上の Tana から Windows 側のアプリで開く (FR-13 の WSL 拡張)。
//!
//! WSL で動く Tana から Windows のアプリを起動するには 2 つの仕事が要る。
//!   1. **パス変換**: Windows 側は `/home/user/x.md` を解釈できない。
//!      `/mnt/c/...` → `C:\...`、それ以外 → `\\wsl.localhost\<distro>\...` に直す。
//!   2. **起動経路**: WSL interop（binfmt_misc）で `.exe` を直接 exec できる。
//!      既定アプリは `explorer.exe <winpath>`、選択表示は `explorer.exe /select,<winpath>`。
//!
//! OS 依存部（/proc 読み・プロセス起動）は薄く保ち、パス変換と判定は引数注入の
//! 純粋関数に切り出して places.rs と同じくテスト可能にする。
//!
//! 注意（実装上の落とし穴。いずれも WSL 実機で確認済み）:
//! - `explorer.exe` は**成功しても終了コード 1** を返す。終了コードで成否を判定しない。
//! - `cmd.exe /c start` は cwd が Linux パスだと警告して Windows ディレクトリに落ちる。
//!   そのため既定アプリの起動には `explorer.exe` を使う。
//! - **`/select,` に空白入りパスを直接渡せない**。interop が引数全体を引用符で包むため
//!   explorer が解釈に失敗し、まったく別の場所（ドキュメント等）が開く。空白があるときは
//!   PowerShell の Start-Process にコマンドラインを組ませる（`needs_start_process`）。
//!   なお `/select,` を伴わない「開く」は引用符付きでも正しく動く。
//! - 起動したアプリは Tana より長生きしうるので待たない（ゾンビ回収だけ別スレッド）。

use serde::Serialize;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

/// WSL 内のパスを Windows から見るときの UNC 接頭辞。
/// 旧来の `\\wsl$` も生きているが、現行の推奨は `\\wsl.localhost`。
const UNC_PREFIX: &str = r"\\wsl.localhost";

/// 既定の自動マウント先（`/etc/wsl.conf` の `[automount] root=` で変えられる）。
const DEFAULT_MNT_ROOT: &str = "/mnt";

/// フロントに返す WSL 連携の可否。
#[derive(Debug, Serialize, PartialEq, Clone, Default)]
pub struct WslInfo {
    /// WSL 上で動作し、かつ interop が有効（= Windows アプリを起動できる）
    pub available: bool,
    /// ディストロ名（UNC パスの組み立てに使う）。取得できなければ空。
    pub distro: String,
}

// ===== 判定（純粋） =====

/// WSL 上かどうか。`WSL_DISTRO_NAME` があれば確実、無ければ osrelease を見る。
fn looks_like_wsl(distro_env: Option<&str>, osrelease: &str) -> bool {
    if distro_env.map(|s| !s.trim().is_empty()).unwrap_or(false) {
        return true;
    }
    let lower = osrelease.to_ascii_lowercase();
    lower.contains("microsoft") || lower.contains("wsl")
}

/// interop（.exe の直接実行）が有効か。
/// binfmt_misc の登録内容が読めればそれを、読めなければ `WSL_INTEROP` の有無を見る。
fn interop_enabled_from(binfmt: Option<&str>, interop_env: bool) -> bool {
    match binfmt {
        Some(content) => content.lines().any(|l| l.trim() == "enabled"),
        None => interop_env,
    }
}

/// `/proc/mounts` から Windows ドライブの自動マウント先を推定する。
/// `C:\ /mnt/c 9p …`（WSL2）や `C: /mnt/c drvfs …`（WSL1）のような行の
/// マウント先の親を返す。`[automount] root=` を変えた環境でも変換が効くようにする。
fn automount_root_from_mounts(mounts: &str) -> Option<String> {
    for line in mounts.lines() {
        let mut it = line.split_whitespace();
        let (Some(src), Some(target)) = (it.next(), it.next()) else {
            continue;
        };
        if !is_windows_path(src) {
            continue;
        }
        // マウント先の末尾が 1 文字（ドライブレター）である行だけを見る。
        let Some((parent, last)) = target.rsplit_once('/') else {
            continue;
        };
        if last.len() != 1 || !last.starts_with(|c: char| c.is_ascii_alphabetic()) {
            continue;
        }
        return Some(if parent.is_empty() {
            "/".to_string()
        } else {
            parent.to_string()
        });
    }
    None
}

/// `C:\…` / `C:/…` / `\\server\…` のような Windows パスか。
fn is_windows_path(p: &str) -> bool {
    if p.starts_with(r"\\") {
        return true;
    }
    let b = p.as_bytes();
    b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
}

/// 末尾の `/` を落とす（ルート `/` はそのまま）。
fn trim_trailing_slashes(p: &str) -> &str {
    let t = p.trim_end_matches('/');
    if t.is_empty() {
        "/"
    } else {
        t
    }
}

/// 自動マウント配下（`/mnt/c/...`）ならドライブレター形式へ。そうでなければ None。
fn drive_path(path: &str, mnt_root: &str) -> Option<String> {
    let root = trim_trailing_slashes(mnt_root);
    let rest = path.strip_prefix(root)?.strip_prefix('/')?;
    let (letter, tail) = match rest.split_once('/') {
        Some((l, t)) => (l, t),
        None => (rest, ""),
    };
    let mut chars = letter.chars();
    let c = chars.next()?;
    if chars.next().is_some() || !c.is_ascii_alphabetic() {
        return None; // `/mnt/wsl` のような 1 文字でない配下はドライブではない
    }
    Some(format!(
        "{}:\\{}",
        c.to_ascii_uppercase(),
        tail.replace('/', "\\")
    ))
}

/// Linux パス → Windows パス。
/// - `/mnt/c/x` → `C:\x`（自動マウント）
/// - それ以外の絶対パス → `\\wsl.localhost\<distro>\x`
/// - すでに Windows パスならそのまま（区切りだけ `\` に揃える）
pub fn to_windows_path(path: &str, distro: &str, mnt_root: &str) -> Result<String, String> {
    let p = path.trim();
    if p.is_empty() {
        return Err("パスが空です".to_string());
    }
    if is_windows_path(p) {
        return Ok(p.replace('/', "\\"));
    }
    if !p.starts_with('/') {
        return Err(format!("絶対パスではありません: {p}"));
    }
    let trimmed = trim_trailing_slashes(p);
    if let Some(drive) = drive_path(trimmed, mnt_root) {
        return Ok(drive);
    }
    let distro = distro.trim();
    if distro.is_empty() {
        return Err("WSL のディストロ名が取得できませんでした".to_string());
    }
    // trimmed は先頭が `/` なので、置換するとそのまま UNC の区切りになる。
    // ルート `/` のときだけ `\\wsl.localhost\<distro>\` になる。
    Ok(format!(
        "{UNC_PREFIX}\\{distro}{}",
        trimmed.replace('/', "\\")
    ))
}

/// Windows パス → Linux パス。外部アプリの登録に `C:\Program Files\...\x.exe` を
/// 貼られても exec できるようにするための変換。UNC は対象外（None）。
pub fn windows_to_linux_path(path: &str, mnt_root: &str) -> Option<String> {
    let p = path.trim();
    if p.starts_with(r"\\") || !is_windows_path(p) {
        return None;
    }
    let (drive, rest) = p.split_at(1);
    let rest = rest.strip_prefix(':')?;
    let root = trim_trailing_slashes(mnt_root);
    let tail = rest.replace('\\', "/");
    let tail = tail.trim_start_matches('/');
    let letter = drive.to_ascii_lowercase();
    Some(if tail.is_empty() {
        format!("{root}/{letter}")
    } else {
        format!("{root}/{letter}/{tail}")
    })
}

/// 外部アプリのコマンドとして exec できる形に直す。
/// Windows パス表記なら `/mnt/...` へ、それ以外（`notepad.exe` 等）はそのまま。
fn resolve_program(app: &str, mnt_root: &str) -> String {
    windows_to_linux_path(app, mnt_root).unwrap_or_else(|| app.trim().to_string())
}

/// 実行を許すコマンド文字列か（シェルを介さないので注入は無いが、制御文字は弾く）。
fn valid_program(app: &str) -> bool {
    !app.trim().is_empty() && !app.chars().any(|c| c.is_control())
}

/// `explorer.exe` が PATH に無いときのフォールバック先。
/// WSL の PATH には通常 Windows 側が追記されるが、デスクトップランチャや
/// systemd 経由の起動では欠けていることがあるため、絶対パスでも探せるようにする。
fn explorer_fallback(mnt_root: &str) -> String {
    format!("{}/c/Windows/explorer.exe", trim_trailing_slashes(mnt_root))
}

// ===== OS 層（薄く保つ） =====

fn read_first<'a>(paths: impl IntoIterator<Item = &'a str>) -> Option<String> {
    paths
        .into_iter()
        .find_map(|p| std::fs::read_to_string(p).ok())
}

/// WSL 連携の可否を調べる（プロセス内で一度だけ）。
fn detect() -> &'static WslInfo {
    static INFO: OnceLock<WslInfo> = OnceLock::new();
    INFO.get_or_init(|| {
        let distro = std::env::var("WSL_DISTRO_NAME").unwrap_or_default();
        let osrelease = std::fs::read_to_string("/proc/sys/kernel/osrelease").unwrap_or_default();
        if !looks_like_wsl(Some(&distro), &osrelease) {
            return WslInfo::default();
        }
        let binfmt = read_first([
            "/proc/sys/fs/binfmt_misc/WSLInterop",
            "/proc/sys/fs/binfmt_misc/WSLInterop-late",
        ]);
        let available =
            interop_enabled_from(binfmt.as_deref(), std::env::var_os("WSL_INTEROP").is_some());
        WslInfo {
            available,
            distro: distro.trim().to_string(),
        }
    })
}

/// 自動マウント先（プロセス内で一度だけ推定）。推定できなければ既定の `/mnt`。
fn automount_root() -> &'static str {
    static ROOT: OnceLock<String> = OnceLock::new();
    ROOT.get_or_init(|| {
        std::fs::read_to_string("/proc/mounts")
            .ok()
            .and_then(|m| automount_root_from_mounts(&m))
            .unwrap_or_else(|| DEFAULT_MNT_ROOT.to_string())
    })
}

fn ensure_available() -> Result<&'static WslInfo, String> {
    let info = detect();
    if !info.available {
        return Err(
            "WSL の Windows 連携が使えません（WSL 環境でないか、interop が無効です）".to_string(),
        );
    }
    Ok(info)
}

/// 起動用に Windows パスへ変換する（連携可否のチェック込み）。
fn win_path_for(path: &str) -> Result<String, String> {
    let info = ensure_available()?;
    to_windows_path(path, &info.distro, automount_root())
}

/// 起動して待たない。アプリは Tana より長生きしうるので `wait` は別スレッドに任せる
/// （待たずに Child を捨てるとゾンビが残るため）。
fn spawn_detached(mut cmd: Command, label: &str) -> Result<(), String> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    match cmd.spawn() {
        Ok(mut child) => {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(format!(
            "{label} が見つかりません。コマンド名を確認してください"
        )),
        Err(e) => Err(format!("{label} を起動できませんでした: {e}")),
    }
}

// ===== Tauri コマンド =====

/// WSL 連携の可否をフロントへ返す。メニューや設定の出し分けに使う。
#[tauri::command]
pub fn wsl_info() -> WslInfo {
    detect().clone()
}

/// Linux パスに対応する Windows パスを返す（「Windows パスをコピー」用）。
#[tauri::command]
pub fn windows_path(path: String) -> Result<String, String> {
    win_path_for(&path)
}

/// Windows 側で開く。app 未指定なら Windows の既定アプリ（explorer.exe 経由）。
#[tauri::command]
pub fn open_in_windows(path: String, app: Option<String>) -> Result<(), String> {
    let win = win_path_for(&path)?;
    if !Path::new(&path).exists() {
        return Err(format!("{path} が見つかりません"));
    }
    match app.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(a) => {
            if !valid_program(a) {
                return Err("使用できない文字がコマンドに含まれています".to_string());
            }
            let program = resolve_program(a, automount_root());
            let mut cmd = Command::new(&program);
            cmd.arg(&win);
            spawn_detached(cmd, a)
        }
        // 既定アプリは explorer.exe に委ねる（関連付けを解決してくれる）。
        None => spawn_explorer(&win),
    }
}

/// エクスプローラーで選択表示する（Windows 版の「ファイルマネージャで表示」）。
///
/// 空白を含むパスは explorer.exe に直接渡せない（下の `needs_start_process` 参照）ので、
/// その場合だけ PowerShell の Start-Process にコマンドラインの組み立てを任せる。
#[tauri::command]
pub fn reveal_in_windows(path: String) -> Result<(), String> {
    let win = win_path_for(&path)?;
    if !Path::new(&path).exists() {
        return Err(format!("{path} が見つかりません"));
    }
    if !needs_start_process(&win) {
        // `/select,<path>` は 1 引数。カンマの直後に空白を入れると解釈が壊れる。
        return spawn_explorer(&format!("/select,{win}"));
    }
    match spawn_select_via_powershell(&win) {
        Ok(()) => Ok(()),
        // PowerShell が無い環境では、選択は諦めて親フォルダを開く（無反応にしない）。
        Err(e) => match parent_windows_path(&path) {
            Some(parent) => spawn_explorer(&parent),
            None => Err(e),
        },
    }
}

/// explorer.exe へ引数を直接渡せないパスか。
///
/// WSL interop は空白を含む引数を**全体ごと**引用符で囲む（`"/select,C:\a b.txt"`）。
/// explorer.exe はこの形を解釈できず、まったく別の場所を開いてしまう（実機確認済み）。
/// 引用符を自分で足しても interop に `\"` へエスケープされるため、argv をどう並べても
/// 正規形 `/select,"C:\a b.txt"` は作れない。
fn needs_start_process(win: &str) -> bool {
    win.contains(' ') || win.contains('"') || win.contains('\t')
}

/// PowerShell の Start-Process に `/select,"<path>"` を組ませる。
///
/// 引数はスクリプト本文に埋めず環境変数で渡す（WSLENV で Windows 側へ引き継ぐ）。
/// こうするとスクリプト本文に引用符が現れないので、interop のエスケープに触れずに済む。
fn spawn_select_via_powershell(win: &str) -> Result<(), String> {
    let mut cmd = Command::new("powershell.exe");
    cmd.env("TANA_REVEAL_ARG", format!("/select,\"{win}\""))
        .env("WSLENV", "TANA_REVEAL_ARG")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Start-Process explorer.exe -ArgumentList $env:TANA_REVEAL_ARG",
        ]);
    spawn_detached(cmd, "powershell.exe")
}

/// 親ディレクトリの Windows パス（選択表示を諦めるときのフォールバック先）。
fn parent_windows_path(path: &str) -> Option<String> {
    let parent = Path::new(path).parent()?.to_string_lossy().to_string();
    let info = detect();
    to_windows_path(&parent, &info.distro, automount_root()).ok()
}

/// explorer.exe を 1 引数で起動する。PATH に無ければ絶対パスで再試行する。
fn spawn_explorer(arg: &str) -> Result<(), String> {
    let mut cmd = Command::new("explorer.exe");
    cmd.arg(arg);
    match spawn_detached(cmd, "explorer.exe") {
        Ok(()) => Ok(()),
        Err(first) => {
            let fallback = explorer_fallback(automount_root());
            if !Path::new(&fallback).exists() {
                return Err(first);
            }
            let mut cmd = Command::new(&fallback);
            cmd.arg(arg);
            spawn_detached(cmd, "explorer.exe")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DISTRO: &str = "Ubuntu-22.04";

    fn win(path: &str) -> Result<String, String> {
        to_windows_path(path, DISTRO, "/mnt")
    }

    #[test]
    fn looks_like_wsl_uses_distro_env_first() {
        assert!(looks_like_wsl(Some("Ubuntu"), "5.15.0-generic"));
        assert!(!looks_like_wsl(Some("  "), "5.15.0-generic"));
        assert!(!looks_like_wsl(None, "5.15.0-generic"));
    }

    #[test]
    fn looks_like_wsl_falls_back_to_osrelease() {
        assert!(looks_like_wsl(None, "6.18.33.2-microsoft-standard-WSL2"));
        assert!(looks_like_wsl(Some(""), "4.4.0-19041-Microsoft")); // WSL1
    }

    #[test]
    fn interop_enabled_reads_binfmt_registration() {
        let enabled = "enabled\ninterpreter /init\nflags: PF\noffset 0\nmagic 4d5a\n";
        let disabled = "disabled\ninterpreter /init\n";
        assert!(interop_enabled_from(Some(enabled), false));
        assert!(!interop_enabled_from(Some(disabled), true)); // 登録内容が優先
    }

    #[test]
    fn interop_falls_back_to_env_when_binfmt_unreadable() {
        assert!(interop_enabled_from(None, true));
        assert!(!interop_enabled_from(None, false));
    }

    #[test]
    fn automount_root_detected_from_drive_mounts() {
        // WSL2 の実際の書式（源が `C:\134`、fstype が 9p）
        let mounts = "none /mnt/wsl tmpfs rw 0 0\n\
             C:\\134 /mnt/c 9p rw,aname=drvfs;path=C:\\ 0 0\n\
             I:\\134 /mnt/i 9p rw 0 0\n";
        assert_eq!(automount_root_from_mounts(mounts).as_deref(), Some("/mnt"));
    }

    #[test]
    fn automount_root_honors_custom_root() {
        let mounts = "C: /windrives/c drvfs rw 0 0\n"; // WSL1 書式 + automount root 変更
        assert_eq!(
            automount_root_from_mounts(mounts).as_deref(),
            Some("/windrives")
        );
    }

    #[test]
    fn automount_root_none_when_no_drive_mounted() {
        let mounts = "none /mnt/wsl tmpfs rw 0 0\n/dev/sdc / ext4 rw 0 0\n";
        assert_eq!(automount_root_from_mounts(mounts), None);
    }

    #[test]
    fn automount_mounts_at_filesystem_root() {
        assert_eq!(
            automount_root_from_mounts("C:\\134 /c 9p rw 0 0\n").as_deref(),
            Some("/")
        );
    }

    #[test]
    fn drive_paths_become_drive_letters() {
        assert_eq!(win("/mnt/c/Users/x/a.txt").unwrap(), r"C:\Users\x\a.txt");
        assert_eq!(win("/mnt/c").unwrap(), r"C:\");
        assert_eq!(win("/mnt/c/").unwrap(), r"C:\");
        assert_eq!(win("/mnt/i/data").unwrap(), r"I:\data");
    }

    #[test]
    fn distro_paths_become_unc() {
        assert_eq!(
            win("/home/dobachi/a b.txt").unwrap(),
            r"\\wsl.localhost\Ubuntu-22.04\home\dobachi\a b.txt"
        );
        assert_eq!(win("/").unwrap(), r"\\wsl.localhost\Ubuntu-22.04\");
        // /mnt 自体・1 文字でない配下はドライブではない
        assert_eq!(win("/mnt").unwrap(), r"\\wsl.localhost\Ubuntu-22.04\mnt");
        assert_eq!(
            win("/mnt/wsl/x").unwrap(),
            r"\\wsl.localhost\Ubuntu-22.04\mnt\wsl\x"
        );
    }

    #[test]
    fn trailing_slashes_are_trimmed() {
        assert_eq!(
            win("/home/x/dir///").unwrap(),
            r"\\wsl.localhost\Ubuntu-22.04\home\x\dir"
        );
    }

    #[test]
    fn custom_mount_root_is_honored() {
        assert_eq!(
            to_windows_path("/windrives/c/x", DISTRO, "/windrives").unwrap(),
            r"C:\x"
        );
        // 既定の /mnt 前提で見ると、同じパスはディストロ配下になる
        assert_eq!(
            to_windows_path("/windrives/c/x", DISTRO, "/mnt").unwrap(),
            r"\\wsl.localhost\Ubuntu-22.04\windrives\c\x"
        );
    }

    #[test]
    fn windows_paths_pass_through() {
        assert_eq!(win(r"C:\Users\x").unwrap(), r"C:\Users\x");
        assert_eq!(win("C:/Users/x").unwrap(), r"C:\Users\x");
        assert_eq!(win(r"\\server\share\x").unwrap(), r"\\server\share\x");
    }

    #[test]
    fn invalid_inputs_are_errors() {
        assert!(win("").is_err());
        assert!(win("   ").is_err());
        assert!(win("relative/path").is_err());
        // ディストロ名が無いと UNC を組み立てられない（ドライブ配下なら組み立て不要）
        assert!(to_windows_path("/home/x", "", "/mnt").is_err());
        assert_eq!(to_windows_path("/mnt/c/x", "", "/mnt").unwrap(), r"C:\x");
    }

    #[test]
    fn windows_to_linux_maps_drive_letters() {
        assert_eq!(
            windows_to_linux_path(r"C:\Program Files\7-Zip\7zFM.exe", "/mnt").as_deref(),
            Some("/mnt/c/Program Files/7-Zip/7zFM.exe")
        );
        assert_eq!(
            windows_to_linux_path("D:/tools/x.exe", "/mnt").as_deref(),
            Some("/mnt/d/tools/x.exe")
        );
        assert_eq!(
            windows_to_linux_path(r"C:\", "/mnt").as_deref(),
            Some("/mnt/c")
        );
    }

    #[test]
    fn windows_to_linux_ignores_non_drive_forms() {
        assert_eq!(windows_to_linux_path("notepad.exe", "/mnt"), None);
        assert_eq!(windows_to_linux_path("/usr/bin/gimp", "/mnt"), None);
        assert_eq!(
            windows_to_linux_path(r"\\wsl.localhost\Ubuntu\x", "/mnt"),
            None
        );
    }

    #[test]
    fn resolve_program_keeps_plain_commands() {
        assert_eq!(resolve_program("notepad.exe", "/mnt"), "notepad.exe");
        assert_eq!(resolve_program("  code.exe  ", "/mnt"), "code.exe");
        assert_eq!(
            resolve_program(r"C:\Windows\notepad.exe", "/mnt"),
            "/mnt/c/Windows/notepad.exe"
        );
    }

    #[test]
    fn select_needs_start_process_only_for_quoted_args() {
        // 実機確認: 空白なしは explorer.exe へ直接渡せる（選択表示される）。
        assert!(!needs_start_process(
            r"\\wsl.localhost\Ubuntu\home\me\a.txt"
        ));
        assert!(!needs_start_process(r"C:\tools\a.txt"));
        // 空白があると interop が引数全体を引用符で包み、explorer が別の場所を開く。
        assert!(needs_start_process(
            r"\\wsl.localhost\Ubuntu\home\me\a b.txt"
        ));
        assert!(needs_start_process(r"C:\Program Files\x.txt"));
        assert!(needs_start_process("C:\\a\tb.txt"));
    }

    #[test]
    fn explorer_fallback_points_into_windows_system_drive() {
        assert_eq!(explorer_fallback("/mnt"), "/mnt/c/Windows/explorer.exe");
        assert_eq!(
            explorer_fallback("/windrives/"),
            "/windrives/c/Windows/explorer.exe"
        );
    }

    #[test]
    fn valid_program_rejects_empty_and_control_chars() {
        assert!(valid_program("notepad.exe"));
        assert!(!valid_program("  "));
        assert!(!valid_program("note\npad.exe"));
    }
}
