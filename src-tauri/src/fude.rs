// fude.rs — リモートのファイルを Fude にリモートのまま渡す
//
// Tana はリモートのファイルを開くとき、手元の一時フォルダへ写してから既定のアプリで
// 開いている。Fude で開くとその写しを編集・保存することになり、ホストのファイルは
// 変わらない（保存したつもりで戻っていない）。Fude は ssh 越しにそのまま編集できるので、
// 入っていれば `fude ssh://host/path` で起動して渡す。
//
// 起動する実行ファイルはここで探す。フロントから任意のパスを受け取って起動はしない。

use std::path::PathBuf;
use std::process::{Command, Stdio};

/// Fude の実行ファイルの候補（見つかる見込みの高い順）。存在の確認はしない。
/// `os` は std::env::consts::OS の値、`env` は環境変数の読み出し（テストで差し替える）。
pub fn candidates(os: &str, env: &dyn Fn(&str) -> Option<String>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    match os {
        "windows" => {
            // NSIS のユーザー単位インストール先 / 全ユーザー向け
            for var in ["LOCALAPPDATA", "ProgramFiles"] {
                if let Some(base) = env(var) {
                    out.push(PathBuf::from(&base).join("Fude").join("Fude.exe"));
                    out.push(PathBuf::from(&base).join("Fude").join("fude.exe"));
                }
            }
            out.extend(in_path(env, "fude.exe", ';'));
        }
        "macos" => {
            let mut apps = vec![PathBuf::from("/Applications")];
            if let Some(home) = env("HOME") {
                apps.push(PathBuf::from(home).join("Applications"));
            }
            for a in apps {
                let dir = a.join("Fude.app").join("Contents").join("MacOS");
                out.push(dir.join("Fude"));
                out.push(dir.join("fude"));
            }
            out.extend(in_path(env, "fude", ':'));
        }
        _ => {
            out.extend(in_path(env, "fude", ':'));
            out.push(PathBuf::from("/usr/bin/fude"));
        }
    }
    out
}

fn in_path(env: &dyn Fn(&str) -> Option<String>, exe: &str, sep: char) -> Vec<PathBuf> {
    env("PATH")
        .map(|p| {
            p.split(sep)
                .filter(|d| !d.is_empty())
                .map(|d| PathBuf::from(d).join(exe))
                .collect()
        })
        .unwrap_or_default()
}

/// 入っている Fude の実行ファイル。無ければ None。
pub fn find() -> Option<PathBuf> {
    let env = |k: &str| std::env::var(k).ok();
    candidates(std::env::consts::OS, &env)
        .into_iter()
        .find(|p| p.is_file())
}

/// Fude に渡してよい場所か: `ssh://` で始まり、制御文字を含まない。
pub fn valid_uri(uri: &str) -> bool {
    uri.starts_with("ssh://") && uri.len() > "ssh://".len() && !uri.chars().any(|c| c.is_control())
}

/// Fude が入っているか（フロントは入っていれば Fude へ渡し、無ければ従来の一時コピー）。
#[tauri::command]
pub fn fude_available() -> bool {
    find().is_some()
}

/// `fude ssh://host/path` で Fude を起動する。起動中の Fude があればそちらで開く
/// （Fude の single-instance が引き取る）。
#[tauri::command]
pub fn open_remote_in_fude(uri: String) -> Result<(), String> {
    if !valid_uri(&uri) {
        return Err("Fude に渡せない場所です".into());
    }
    let exe = find().ok_or("Fude が見つかりません")?;
    let mut child = Command::new(&exe)
        .arg(&uri)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Fude を起動できません: {e}"))?;
    // 起動中の Fude へ引き渡した側はすぐ終わる。待たないとゾンビが残るので別スレッドで回収する
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let m: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k: &str| m.get(k).cloned()
    }

    #[test]
    fn windows_looks_in_install_dirs_then_path() {
        let env = env_of(&[
            ("LOCALAPPDATA", r"C:\Users\u\AppData\Local"),
            ("ProgramFiles", r"C:\Program Files"),
            ("PATH", r"C:\bin;;C:\tools"),
        ]);
        let c = candidates("windows", &env);
        assert_eq!(
            c[0],
            PathBuf::from(r"C:\Users\u\AppData\Local")
                .join("Fude")
                .join("Fude.exe")
        );
        assert!(c.contains(
            &PathBuf::from(r"C:\Program Files")
                .join("Fude")
                .join("Fude.exe")
        ));
        assert!(c.contains(&PathBuf::from(r"C:\tools").join("fude.exe")));
        assert_eq!(c.len(), 6); // 2 dirs × 2 names + 2 PATH entries (empty skipped)
    }

    #[test]
    fn macos_looks_in_applications() {
        let env = env_of(&[("HOME", "/Users/u"), ("PATH", "/usr/local/bin")]);
        let c = candidates("macos", &env);
        assert_eq!(
            c[0],
            PathBuf::from("/Applications/Fude.app/Contents/MacOS/Fude")
        );
        assert!(c.contains(&PathBuf::from(
            "/Users/u/Applications/Fude.app/Contents/MacOS/fude"
        )));
        assert!(c.contains(&PathBuf::from("/usr/local/bin/fude")));
    }

    #[test]
    fn linux_looks_in_path_then_usr_bin() {
        let env = env_of(&[("PATH", "/home/u/.local/bin:/usr/bin")]);
        let c = candidates("linux", &env);
        assert_eq!(c[0], PathBuf::from("/home/u/.local/bin/fude"));
        assert_eq!(c.last().unwrap(), &PathBuf::from("/usr/bin/fude"));
    }

    #[test]
    fn no_env_still_has_fallbacks_where_they_exist() {
        let env = env_of(&[]);
        assert!(candidates("windows", &env).is_empty());
        assert_eq!(
            candidates("linux", &env),
            vec![PathBuf::from("/usr/bin/fude")]
        );
    }

    #[test]
    fn valid_uri_accepts_only_ssh_without_control_chars() {
        assert!(valid_uri("ssh://k16/home/u/a.md"));
        assert!(valid_uri("ssh://u@k16/a b.md"));
        assert!(!valid_uri("ssh://"));
        assert!(!valid_uri("sftp://k16/a.md"));
        assert!(!valid_uri("/etc/passwd"));
        assert!(!valid_uri("--help"));
        assert!(!valid_uri("ssh://k16/a\nb"));
    }

    #[test]
    fn open_remote_in_fude_rejects_invalid_uri_before_looking() {
        assert!(open_remote_in_fude("--new-window".into()).is_err());
    }
}
