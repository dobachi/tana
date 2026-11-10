//! apps.rs — 「別のアプリで開く」の登録を楽にする (FR-13)
//!
//! 外部アプリはコマンドのフルパスを手で入力して登録していたが、Windows では
//! `C:\Program Files\7-Zip\7zFM.exe` のようなパスを調べないと登録できなかった。
//! そこで次の 2 つを用意する。
//!
//! 1. **インストール済みアプリの一覧** (`list_installed_apps`)
//!    - Windows: レジストリの `App Paths` と `Uninstall`（DisplayName + DisplayIcon）
//!    - WSL: 上と同じ情報を `powershell.exe` 経由で読む（Windows 側のアプリ）＋ Linux 側の `.desktop`
//!    - Linux: `.desktop`（引数なしで起動できるものだけ）
//!    - macOS: `/Applications` 等の `.app`
//! 2. **Windows 標準の「プログラムから開く」ダイアログ** (`open_with_dialog`)
//!    登録しなくても、OS のアプリ選択画面からその場で選んで開ける。
//!
//! 一覧の組み立て（パスの整形・重複除去・並べ替え）は純粋関数に分け、
//! レジストリやプロセス起動の薄い層から切り離してテストする。
//!
//! 注意（WSL interop の落とし穴。wsl.rs と同じ）:
//! - interop は空白入りの引数を全体ごと引用符で包む。`OpenAs_RunDLL` は残りの
//!   コマンドラインをそのままパスとして読むため、空白があるときは PowerShell の
//!   Start-Process にコマンドラインを組ませる。
//! - PowerShell のスクリプトは `-EncodedCommand`（UTF-16LE の base64）で渡し、
//!   引用符のエスケープに触れない。出力も UTF-8 の base64 にして、コンソールの
//!   コードページ（日本語環境は CP932）で表示名が化けないようにする。

// 純粋関数は全 OS でテストするが、使う側は OS ごとに違う（Windows はレジストリ直読み、
// WSL は PowerShell 経由、macOS は .app）。使わない OS での dead_code 警告は抑える。
#![allow(dead_code)]

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
#[cfg(not(windows))]
use std::process::Command;

use crate::wsl;

/// 一覧の 1 件。フロントの extapps.js にそのまま登録できる形。
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct InstalledApp {
    pub name: String,
    pub command: String,
    /// 'auto' | 'linux' | 'windows'（extapps.js の target と同じ意味）
    pub target: String,
}

/// この環境で使える機能（メニューの出し分け用）。
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSupport {
    /// 'windows' | 'wsl' | 'macos' | 'linux'
    pub platform: String,
    /// Windows の「プログラムから開く」ダイアログを出せるか
    pub open_with_dialog: bool,
}

/// レジストリから拾った生の記録。
/// k = "path"（App Paths: n=キー名, v=既定値）/ "uninst"（n=DisplayName, v=DisplayIcon）
#[derive(Debug, Deserialize, Clone, PartialEq, Eq)]
pub struct RegRecord {
    pub k: String,
    pub n: String,
    pub v: String,
}

// ===== Windows のレジストリ値の整形（純粋） =====

/// `C:\` / `C:/` で始まる絶対パスか。
fn is_abs_windows(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')
}

fn win_file_name(s: &str) -> &str {
    s.rsplit(['\\', '/']).next().unwrap_or(s)
}

/// 拡張子 `.exe` を除いたファイル名（表示名の代わりに使う）。
fn exe_stem(s: &str) -> String {
    let f = win_file_name(s);
    match f.len().checked_sub(4) {
        Some(i) if f.is_char_boundary(i) && f[i..].eq_ignore_ascii_case(".exe") => {
            f[..i].to_string()
        }
        _ => f.to_string(),
    }
}

/// アンインストーラやインストーラに見える実行ファイルか（一覧に出しても使い道が無い）。
fn is_installer_like(file: &str) -> bool {
    let l = file.to_ascii_lowercase();
    ["unins", "uninst", "setup", "installer", "update", "redist"]
        .iter()
        .any(|w| l.contains(w))
}

/// インストーラの置き場（`C:\ProgramData\Package Cache\{…}\vcredist_x64.exe` 等）か。
/// DisplayIcon がインストーラ本体を指しているだけで、開くアプリとしては使えない。
fn is_installer_cache(exe: &str) -> bool {
    let l = exe.to_ascii_lowercase();
    l.contains(r"\package cache\") || l.contains(r"\installer\")
}

/// 表示名がアンインストール用の項目か（プリンタドライバ等が登録する）。
fn is_uninstall_name(name: &str) -> bool {
    name.contains("アンインストール") || name.to_ascii_lowercase().contains("uninstall")
}

/// レジストリ値から実行ファイルのパスを取り出す。
/// `"C:\x\a.exe",0` / `C:\x\a.exe,0` / `"C:\x\a.exe"` / `C:\x\a.exe` を受け付け、
/// `.exe` 以外（`.ico` 等）や相対パスは捨てる。
fn clean_exe(value: &str) -> Option<String> {
    let s = value.trim();
    let s = if let Some(rest) = s.strip_prefix('"') {
        rest.split('"').next()?
    } else {
        // 末尾のアイコン番号 `,0` / `,-101` を落とす
        match s.rfind(',') {
            Some(i) => {
                let idx = s[i + 1..].trim();
                let idx = idx.strip_prefix('-').unwrap_or(idx);
                if !idx.is_empty() && idx.chars().all(|c| c.is_ascii_digit()) {
                    &s[..i]
                } else {
                    s
                }
            }
            None => s,
        }
    };
    let s = s.trim();
    if !is_abs_windows(s) || !s.to_ascii_lowercase().ends_with(".exe") {
        return None;
    }
    // " は extapps.js が拒否する（cmd /c start の境界を壊せるため）。ここでも落とす。
    if s.contains('"') || s.chars().any(|c| c.is_control()) {
        return None;
    }
    Some(s.to_string())
}

/// `%ProgramFiles%` などの環境変数を展開する（REG_EXPAND_SZ 用）。
/// 見つからない変数はそのまま残す（後段の is_abs_windows で落ちる）。
pub fn expand_env(s: &str, lookup: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => {
                let name = &after[..end];
                match lookup(name) {
                    Some(v) => out.push_str(&v),
                    None => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// レジストリの記録を一覧にまとめる。
/// 同じ実行ファイルは 1 件にし、表示名は Uninstall の DisplayName を App Paths のキー名より優先する。
pub fn merge_windows(records: &[RegRecord], target: &str) -> Vec<InstalledApp> {
    // key = 小文字化したパス → (優先度, 表示名, パス)
    let mut map: BTreeMap<String, (u8, String, String)> = BTreeMap::new();
    for r in records {
        let (prio, exe, name) = match r.k.as_str() {
            "uninst" => match clean_exe(&r.v) {
                Some(exe) => (2, exe, r.n.trim().to_string()),
                None => continue,
            },
            "path" => match clean_exe(&r.v) {
                Some(exe) => (1, exe, exe_stem(r.n.trim())),
                None => continue,
            },
            _ => continue,
        };
        if is_installer_like(win_file_name(&exe))
            || is_installer_cache(&exe)
            || is_uninstall_name(&name)
        {
            continue;
        }
        let name = if name.is_empty() {
            exe_stem(&exe)
        } else {
            name
        };
        let key = exe.to_ascii_lowercase();
        match map.get(&key) {
            Some((p, _, _)) if *p >= prio => {}
            _ => {
                map.insert(key, (prio, name, exe));
            }
        }
    }
    let list = map
        .into_values()
        .map(|(_, name, command)| InstalledApp {
            name,
            command,
            target: target.to_string(),
        })
        .collect();
    sort_apps(list)
}

/// 表示名順（大文字小文字を区別しない）。同名はコマンドで安定させる。
fn sort_apps(mut list: Vec<InstalledApp>) -> Vec<InstalledApp> {
    list.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.command.cmp(&b.command))
    });
    list
}

// ===== Linux の .desktop（純粋） =====

/// Exec 行から「引数なしで起動できるプログラム」を取り出す。
/// opener は `Command::new(program).arg(path)` で起動するので、`%U` 等のフィールド
/// コード以外の引数が要るもの（`flatpak run …` など）は表せない → None。
/// `env VAR=… prog %U`（snap が使う形）は prog を取り出す。
pub fn exec_program(exec: &str) -> Option<String> {
    let exec = exec.trim();
    let (prog, rest) = if let Some(r) = exec.strip_prefix('"') {
        let end = r.find('"')?;
        (r[..end].to_string(), r[end + 1..].to_string())
    } else {
        let mut it = exec.splitn(2, char::is_whitespace);
        let p = it.next()?.to_string();
        (p, it.next().unwrap_or("").to_string())
    };
    let mut tokens: Vec<&str> = rest.split_whitespace().collect();
    let mut prog = prog;
    if prog == "env" || prog.ends_with("/env") {
        // VAR=VALUE を読み飛ばし、最初の非代入をプログラムとする
        let i = tokens.iter().position(|t| !t.contains('='))?;
        prog = tokens[i].to_string();
        tokens = tokens[i + 1..].to_vec();
    }
    if prog.is_empty() || !tokens.iter().all(|t| t.starts_with('%')) {
        return None;
    }
    Some(prog)
}

/// `.desktop` ファイルの本文から (表示名, プログラム) を取り出す。
/// 非表示（NoDisplay/Hidden）・アプリ以外・引数が必要なものは None。
pub fn parse_desktop_entry(text: &str) -> Option<(String, String)> {
    let mut in_entry = false;
    let (mut name, mut exec, mut typ) = (None, None, None);
    let mut hidden = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry || line.starts_with('#') {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let v = v.trim();
        match k.trim() {
            "Name" => name = Some(v.to_string()),
            "Exec" => exec = Some(v.to_string()),
            "Type" => typ = Some(v.to_string()),
            "NoDisplay" | "Hidden" if v.eq_ignore_ascii_case("true") => hidden = true,
            _ => {}
        }
    }
    if hidden || typ.as_deref() != Some("Application") {
        return None;
    }
    let program = exec_program(exec.as_deref()?)?;
    let name = name
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| program.clone());
    Some((name, program))
}

/// .desktop 群から一覧を作る（同じプログラムは先に見つかったほうを残す）。
pub fn merge_desktop(entries: &[(String, String)], target: &str) -> Vec<InstalledApp> {
    let mut seen = std::collections::HashSet::new();
    let list = entries
        .iter()
        .filter(|(_, prog)| seen.insert(prog.clone()))
        .map(|(name, prog)| InstalledApp {
            name: name.clone(),
            command: prog.clone(),
            target: target.to_string(),
        })
        .collect();
    sort_apps(list)
}

// ===== PowerShell 経由（WSL）の入出力（純粋） =====

/// `-EncodedCommand` に渡す形（UTF-16LE の base64）。
pub fn encode_ps_command(script: &str) -> String {
    let bytes: Vec<u8> = script
        .encode_utf16()
        .flat_map(|u| u.to_le_bytes())
        .collect();
    B64.encode(bytes)
}

/// スクリプトの出力（UTF-8 JSON の base64）を記録の配列に戻す。
pub fn decode_ps_output(stdout: &str) -> Result<Vec<RegRecord>, String> {
    let compact: String = stdout.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.is_empty() {
        return Ok(Vec::new());
    }
    let bytes = B64
        .decode(compact.as_bytes())
        .map_err(|e| format!("アプリ一覧を読めませんでした: {e}"))?;
    let v: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("アプリ一覧を読めませんでした: {e}"))?;
    // PowerShell 5.1 は要素 1 個の配列をオブジェクトにしてしまうことがあるので両方受ける
    let arr = match v {
        serde_json::Value::Array(a) => a,
        serde_json::Value::Null => Vec::new(),
        other => vec![other],
    };
    Ok(arr
        .into_iter()
        .filter_map(|x| serde_json::from_value::<RegRecord>(x).ok())
        .collect())
}

/// レジストリを読む PowerShell スクリプト。引用符は単引用符だけを使う。
/// `GetValue` は REG_EXPAND_SZ を展開して返す。
#[cfg(all(unix, not(target_os = "macos")))]
const PS_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
$r = New-Object System.Collections.ArrayList
foreach ($b in @('HKLM:', 'HKCU:')) {
  Get-ChildItem ($b + '\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths') | ForEach-Object {
    $v = $_.GetValue('')
    if ($v) { [void]$r.Add([pscustomobject]@{ k = 'path'; n = [string]$_.PSChildName; v = [string]$v }) }
  }
}
foreach ($p in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
                 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
                 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')) {
  Get-ChildItem $p | ForEach-Object {
    $n = $_.GetValue('DisplayName'); $i = $_.GetValue('DisplayIcon')
    if ($n -and $i) { [void]$r.Add([pscustomobject]@{ k = 'uninst'; n = [string]$n; v = [string]$i }) }
  }
}
$json = ConvertTo-Json -InputObject @($r.ToArray()) -Compress
[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))
"#;

/// 「プログラムから開く」ダイアログを出す rundll32 の引数（パスは引用符で包まない）。
pub fn openas_arg(win_path: &str) -> String {
    format!("shell32.dll,OpenAs_RunDLL {win_path}")
}

// ===== OS 層（薄く保つ） =====

#[cfg(windows)]
fn read_registry() -> Vec<RegRecord> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    let env = |n: &str| std::env::var(n).ok();
    let mut out = Vec::new();
    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        let root = RegKey::predef(hive);
        if let Ok(k) = root.open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths") {
            for name in k.enum_keys().flatten() {
                if let Ok(v) = k
                    .open_subkey(&name)
                    .and_then(|s| s.get_value::<String, _>(""))
                {
                    out.push(RegRecord {
                        k: "path".into(),
                        n: name,
                        v: expand_env(&v, env),
                    });
                }
            }
        }
    }
    let uninstall = [
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_CURRENT_USER,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
    ];
    for (hive, path) in uninstall {
        let Ok(k) = RegKey::predef(hive).open_subkey(path) else {
            continue;
        };
        for name in k.enum_keys().flatten() {
            let Ok(sub) = k.open_subkey(&name) else {
                continue;
            };
            let dn = sub.get_value::<String, _>("DisplayName");
            let icon = sub.get_value::<String, _>("DisplayIcon");
            if let (Ok(n), Ok(i)) = (dn, icon) {
                out.push(RegRecord {
                    k: "uninst".into(),
                    n,
                    v: expand_env(&i, env),
                });
            }
        }
    }
    out
}

/// WSL から Windows のプログラムを探す。PATH に無ければ自動マウント先の絶対パスで。
#[cfg(not(windows))]
fn windows_program(name: &str, rel: &str) -> String {
    let fallback = format!(
        "{}/c/{}",
        wsl::trim_trailing_slashes(wsl::automount_root()),
        rel
    );
    let in_path = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join(name).exists()))
        .unwrap_or(false);
    if !in_path && Path::new(&fallback).exists() {
        fallback
    } else {
        name.to_string()
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn read_registry_via_powershell() -> Result<Vec<RegRecord>, String> {
    let ps = windows_program(
        "powershell.exe",
        "Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    );
    let mut cmd = Command::new(ps);
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        &encode_ps_command(PS_SCRIPT),
    ]);
    // cwd が Linux 側だと Windows プロセスが警告を出すことがあるので C: に寄せる
    let c_drive = format!("{}/c", wsl::trim_trailing_slashes(wsl::automount_root()));
    if Path::new(&c_drive).is_dir() {
        cmd.current_dir(c_drive);
    }
    let out = cmd
        .output()
        .map_err(|e| format!("powershell.exe を起動できませんでした: {e}"))?;
    decode_ps_output(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn desktop_entries() -> Vec<(String, String)> {
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    if let Some(d) = dirs::data_local_dir() {
        dirs.push(d.join("applications"));
    }
    for d in [
        "/usr/local/share/applications",
        "/usr/share/applications",
        "/var/lib/snapd/desktop/applications",
        "/var/lib/flatpak/exports/share/applications",
    ] {
        dirs.push(d.into());
    }
    let mut out = Vec::new();
    for dir in dirs {
        let Ok(rd) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut files: Vec<_> = rd
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "desktop"))
            .collect();
        files.sort();
        for f in files {
            if let Some(e) = std::fs::read_to_string(&f)
                .ok()
                .and_then(|t| parse_desktop_entry(&t))
            {
                out.push(e);
            }
        }
    }
    out
}

#[cfg(target_os = "macos")]
fn mac_apps() -> Vec<InstalledApp> {
    let mut dirs: Vec<std::path::PathBuf> =
        vec!["/Applications".into(), "/System/Applications".into()];
    if let Some(h) = dirs::home_dir() {
        dirs.push(h.join("Applications"));
    }
    let mut seen = std::collections::HashSet::new();
    let mut list = Vec::new();
    for dir in dirs {
        let Ok(rd) = std::fs::read_dir(&dir) else {
            continue;
        };
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().is_some_and(|x| x == "app") {
                if let Some(stem) = p.file_stem().map(|s| s.to_string_lossy().to_string()) {
                    // `open -a <名前>` で起動できるので、コマンドはアプリ名にする
                    if seen.insert(stem.clone()) {
                        list.push(InstalledApp {
                            name: stem.clone(),
                            command: stem,
                            target: "auto".into(),
                        });
                    }
                }
            }
        }
    }
    sort_apps(list)
}

fn collect_installed() -> Result<Vec<InstalledApp>, String> {
    #[cfg(windows)]
    {
        Ok(merge_windows(&read_registry(), "auto"))
    }
    #[cfg(target_os = "macos")]
    {
        Ok(mac_apps())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut out = Vec::new();
        let mut err = None;
        let in_wsl = wsl::detect().available;
        if in_wsl {
            match read_registry_via_powershell() {
                Ok(r) => out.extend(merge_windows(&r, "windows")),
                Err(e) => err = Some(e),
            }
        }
        // WSL では Linux 側を明示（auto だと .exe 判定に頼ることになる）
        let target = if in_wsl { "linux" } else { "auto" };
        out.extend(merge_desktop(&desktop_entries(), target));
        match (out.is_empty(), err) {
            (true, Some(e)) => Err(e),
            _ => Ok(out),
        }
    }
}

// ===== Tauri コマンド =====

#[tauri::command]
pub fn app_support() -> AppSupport {
    let (platform, dialog) = if cfg!(windows) {
        ("windows", true)
    } else if cfg!(target_os = "macos") {
        ("macos", false)
    } else if wsl::detect().available {
        ("wsl", true)
    } else {
        ("linux", false)
    };
    AppSupport {
        platform: platform.into(),
        open_with_dialog: dialog,
    }
}

/// インストール済みアプリの一覧。PowerShell の起動に 1〜2 秒かかるので別スレッドで。
#[tauri::command]
pub async fn list_installed_apps() -> Result<Vec<InstalledApp>, String> {
    tauri::async_runtime::spawn_blocking(collect_installed)
        .await
        .map_err(|e| e.to_string())?
}

/// Windows 標準の「プログラムから開く」ダイアログを出す。
#[tauri::command]
pub fn open_with_dialog(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(format!("{path} が見つかりません"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("rundll32.exe");
        // 既定の引用符付けをさせない（OpenAs_RunDLL は残り全体をパスとして読む）
        cmd.raw_arg(openas_arg(&path));
        wsl::spawn_detached(cmd, "rundll32.exe")
    }
    #[cfg(not(windows))]
    {
        let win = wsl::win_path_for(&path)?;
        let rundll = windows_program("rundll32.exe", "Windows/System32/rundll32.exe");
        if !wsl::needs_start_process(&win) {
            let mut cmd = Command::new(rundll);
            cmd.args(["shell32.dll,OpenAs_RunDLL", &win]);
            return wsl::spawn_detached(cmd, "rundll32.exe");
        }
        // 空白入り: Start-Process に 1 本の文字列で渡すと、そのままコマンドラインになる
        let ps = windows_program(
            "powershell.exe",
            "Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
        );
        let mut cmd = Command::new(ps);
        cmd.env("TANA_OPENAS_ARG", openas_arg(&win))
            .env("WSLENV", "TANA_OPENAS_ARG")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Process rundll32.exe -ArgumentList $env:TANA_OPENAS_ARG",
            ]);
        wsl::spawn_detached(cmd, "powershell.exe")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(k: &str, n: &str, v: &str) -> RegRecord {
        RegRecord {
            k: k.into(),
            n: n.into(),
            v: v.into(),
        }
    }

    #[test]
    fn clean_exe_accepts_common_registry_shapes() {
        let want = Some(r"C:\Program Files\7-Zip\7zFM.exe".to_string());
        assert_eq!(clean_exe(r"C:\Program Files\7-Zip\7zFM.exe"), want);
        assert_eq!(clean_exe(r#""C:\Program Files\7-Zip\7zFM.exe""#), want);
        assert_eq!(clean_exe(r#""C:\Program Files\7-Zip\7zFM.exe",0"#), want);
        assert_eq!(clean_exe(r"C:\Program Files\7-Zip\7zFM.exe,0"), want);
        assert_eq!(clean_exe(r"C:\Program Files\7-Zip\7zFM.exe,-101"), want);
        assert_eq!(clean_exe(r"  C:\Program Files\7-Zip\7zFM.exe  "), want);
    }

    #[test]
    fn clean_exe_rejects_non_executables_and_relative_paths() {
        assert_eq!(clean_exe(r"C:\x\app.ico"), None);
        assert_eq!(clean_exe(r"C:\x\app.dll,1"), None);
        assert_eq!(clean_exe("notepad.exe"), None);
        assert_eq!(clean_exe(r"%ProgramFiles%\x\a.exe"), None); // 未展開
        assert_eq!(clean_exe(""), None);
        assert_eq!(clean_exe(r#"""#), None);
    }

    #[test]
    fn exe_stem_drops_extension_case_insensitively() {
        assert_eq!(exe_stem(r"C:\a\7zFM.exe"), "7zFM");
        assert_eq!(exe_stem("NOTEPAD.EXE"), "NOTEPAD");
        assert_eq!(exe_stem("ab"), "ab");
        assert_eq!(exe_stem("日本.exe"), "日本");
    }

    #[test]
    fn expand_env_replaces_known_vars_only() {
        let env = |n: &str| (n == "ProgramFiles").then(|| r"C:\Program Files".to_string());
        assert_eq!(
            expand_env(r"%ProgramFiles%\7-Zip\7zFM.exe", env),
            r"C:\Program Files\7-Zip\7zFM.exe"
        );
        assert_eq!(expand_env(r"%NOPE%\a.exe", env), r"%NOPE%\a.exe");
        assert_eq!(expand_env("100% done", env), "100% done");
        assert_eq!(expand_env("%%", env), "%%");
    }

    #[test]
    fn merge_prefers_display_name_and_dedupes_by_path() {
        let recs = vec![
            rec("path", "7zFM.exe", r"C:\Program Files\7-Zip\7zFM.exe"),
            rec(
                "uninst",
                "7-Zip 23.01 (x64)",
                r"c:\program files\7-zip\7zFM.exe",
            ),
            rec(
                "path",
                "notepad++.exe",
                r#""C:\Program Files\Notepad++\notepad++.exe""#,
            ),
        ];
        let got = merge_windows(&recs, "windows");
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].name, "7-Zip 23.01 (x64)");
        assert_eq!(got[0].target, "windows");
        assert_eq!(got[1].name, "notepad++");
        assert_eq!(got[1].command, r"C:\Program Files\Notepad++\notepad++.exe");
    }

    #[test]
    fn merge_skips_uninstallers_and_unknown_kinds() {
        let recs = vec![
            rec("uninst", "Foo", r"C:\Foo\unins000.exe"),
            rec("uninst", "Bar", r"C:\Bar\Uninstall.exe,0"),
            rec("uninst", "Baz", r"C:\Baz\baz.ico"),
            rec("other", "x", r"C:\x\x.exe"),
            rec("uninst", "Qux", r"C:\Qux\qux.exe"),
            rec(
                "uninst",
                "Microsoft Visual C++ 2013 Redistributable (x64)",
                r"C:\ProgramData\Package Cache\{050d4fc8}\vcredist_x64.exe",
            ),
            rec(
                "uninst",
                "Python 3.13 (64-bit)",
                r"C:\Users\me\AppData\Local\Package Cache\{c49e}\python-3.13-amd64.exe",
            ),
            rec(
                "uninst",
                "EPSON プリンター アンインストール",
                r"C:\WINDOWS\x\E1Y.EXE",
            ),
        ];
        let got = merge_windows(&recs, "auto");
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "Qux");
    }

    #[test]
    fn merge_sorts_case_insensitively_and_falls_back_to_stem() {
        let recs = vec![
            rec("uninst", "zeta", r"C:\z\z.exe"),
            rec("uninst", "  ", r"C:\a\Alpha.exe"),
            rec("uninst", "Beta", r"C:\b\b.exe"),
        ];
        let names: Vec<_> = merge_windows(&recs, "auto")
            .into_iter()
            .map(|a| a.name)
            .collect();
        assert_eq!(names, vec!["Alpha", "Beta", "zeta"]);
    }

    #[test]
    fn exec_program_accepts_field_codes_only() {
        assert_eq!(exec_program("gimp %U").as_deref(), Some("gimp"));
        assert_eq!(
            exec_program("/usr/bin/gedit").as_deref(),
            Some("/usr/bin/gedit")
        );
        assert_eq!(
            exec_program(r#""/opt/My App/app" %f"#).as_deref(),
            Some("/opt/My App/app")
        );
        assert_eq!(
            exec_program("env BAMF_DESKTOP_FILE_HINT=/x.desktop /snap/bin/vlc %U").as_deref(),
            Some("/snap/bin/vlc")
        );
        // 引数が必要なものは表せない
        assert_eq!(exec_program("flatpak run org.gimp.GIMP %U"), None);
        assert_eq!(exec_program("code --new-window %F"), None);
        assert_eq!(exec_program(""), None);
        assert_eq!(exec_program("env A=1"), None);
    }

    #[test]
    fn parse_desktop_entry_reads_main_section_only() {
        let text = "\
[Desktop Entry]
Type=Application
Name=Text Editor
Name[ja]=テキストエディタ
Exec=gedit %U

[Desktop Action new-window]
Name=New Window
Exec=gedit --new-window
";
        assert_eq!(
            parse_desktop_entry(text),
            Some(("Text Editor".into(), "gedit".into()))
        );
    }

    #[test]
    fn parse_desktop_entry_skips_hidden_and_non_apps() {
        let hidden = "[Desktop Entry]\nType=Application\nName=X\nExec=x\nNoDisplay=true\n";
        assert_eq!(parse_desktop_entry(hidden), None);
        let link = "[Desktop Entry]\nType=Link\nName=X\nURL=https://example.com\n";
        assert_eq!(parse_desktop_entry(link), None);
        let no_exec = "[Desktop Entry]\nType=Application\nName=X\n";
        assert_eq!(parse_desktop_entry(no_exec), None);
        let no_name = "[Desktop Entry]\nType=Application\nExec=xterm\n";
        assert_eq!(
            parse_desktop_entry(no_name),
            Some(("xterm".into(), "xterm".into()))
        );
    }

    #[test]
    fn merge_desktop_dedupes_by_program() {
        let got = merge_desktop(
            &[
                ("b".into(), "gedit".into()),
                ("A".into(), "gimp".into()),
                ("dup".into(), "gedit".into()),
            ],
            "linux",
        );
        let names: Vec<_> = got.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, vec!["A", "b"]);
        assert!(got.iter().all(|a| a.target == "linux"));
    }

    #[test]
    fn encode_ps_command_is_utf16le_base64() {
        // "ab" → 61 00 62 00
        assert_eq!(encode_ps_command("ab"), "YQBiAA==");
    }

    #[test]
    fn decode_ps_output_roundtrips_json_with_non_ascii() {
        let json = r#"[{"k":"uninst","n":"秀丸エディタ","v":"C:\\h\\hidemaru.exe"},{"k":"path","n":"a.exe","v":"C:\\a.exe"}]"#;
        let out = format!("{}\r\n", B64.encode(json.as_bytes()));
        let recs = decode_ps_output(&out).unwrap();
        assert_eq!(recs.len(), 2);
        assert_eq!(recs[0].n, "秀丸エディタ");
    }

    #[test]
    fn decode_ps_output_handles_single_object_empty_and_garbage() {
        let one = B64.encode(br#"{"k":"path","n":"a.exe","v":"C:\\a.exe"}"#);
        assert_eq!(decode_ps_output(&one).unwrap().len(), 1);
        assert_eq!(decode_ps_output("  \n").unwrap(), vec![]);
        assert_eq!(decode_ps_output(&B64.encode(b"null")).unwrap(), vec![]);
        assert!(decode_ps_output("!!!not base64").is_err());
        // 型の合わない要素は捨てる
        let mixed = B64.encode(br#"[{"k":"path"},{"k":"path","n":"a","v":"b"}]"#);
        assert_eq!(decode_ps_output(&mixed).unwrap().len(), 1);
    }

    #[test]
    fn openas_arg_keeps_path_unquoted() {
        assert_eq!(
            openas_arg(r"C:\Program Files\a b.zip"),
            r"shell32.dll,OpenAs_RunDLL C:\Program Files\a b.zip"
        );
    }
}
