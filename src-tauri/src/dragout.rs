// dragout.rs — Tana → 外 のドラッグで OS に渡すパスを整える（docs/DRAG-AND-DROP.md §10）
//
// 外へのドラッグは tauri-plugin-drag（drag クレート）が行う。Windows 版は渡された
// パスを必ず dunce::canonicalize してからシェル（ILCreateFromPathW）に渡すが、
// 結果が `\\?\` 付きのまま残るとシェルが受け取れず、drag クレート内の unwrap() が
// panic する。panic はメインスレッドのイベントループで起きるので Tana ごと終了する。
// `\\?\` が残るのは次のとき（dunce は `\\?\C:\` 形式しか普通の形に戻さない）:
//   - WSL・ネットワーク共有のパス（`\\wsl.localhost\…` → `\\?\UNC\…`）。長さに依らず必ず
//   - パスが長い（260 文字超）、Windows が普通の名前として扱えない名前を含む
// 実機で `\\?\UNC\wsl.localhost\…` は ILCreateFromPathW が失敗し、`\\wsl.localhost\…` は
// 通ることを確認した（2026-11-20）。渡す綴りを変えてもクレート内で再び変換されるので、
//
//   - ファイルなら、短い一時フォルダ（tana-drag）へコピーしてそちらを渡す。
//     外へのドラッグは常にコピーなので、相手に届く結果は変わらない
//   - フォルダは丸ごとコピーすると重いので、理由を返して断る
//
// 判定の中身（resolve）は差し替えられるので、OS に依らずテストできる。

use std::path::{Path, PathBuf};

/// 解決したパスと、シェルにそのまま渡せるか
pub struct Resolved {
    pub path: PathBuf,
    pub usable: bool,
}

/// `\\?\` で始まる（シェルが受け取れない）綴りか
#[cfg_attr(not(windows), allow(dead_code))]
pub fn is_verbatim(p: &str) -> bool {
    p.starts_with(r"\\?\")
}

/// 置き直し先の短いフォルダ（一時フォルダ直下の tana-drag）
pub fn short_root() -> PathBuf {
    std::env::temp_dir().join("tana-drag")
}

/// 短い場所の古い置き直しを消す（1 時間より前のもの）。失敗しても続ける。
fn prune_short_root(root: &Path) {
    let Ok(rd) = std::fs::read_dir(root) else {
        return;
    };
    let limit = std::time::Duration::from_secs(60 * 60);
    for e in rd.flatten() {
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > limit);
        if old {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

fn display_name(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| p.to_string_lossy().to_string())
}

/// OS に渡すパスを決める。
///
/// * `short_root` — コピーの置き場
/// * `resolve` — パスを解決し、シェルに渡せるかを返す
pub fn prepare_paths(
    paths: &[String],
    short_root: &Path,
    resolve: &dyn Fn(&Path) -> std::io::Result<Resolved>,
) -> Result<Vec<String>, String> {
    let mut out = Vec::with_capacity(paths.len());
    let mut pruned = false;
    for (i, raw) in paths.iter().enumerate() {
        let p = Path::new(raw);
        let r = resolve(p).map_err(|e| format!("{}: {e}", display_name(p)))?;
        if r.usable {
            out.push(r.path.to_string_lossy().to_string());
            continue;
        }
        if !p.is_file() {
            return Err(format!(
                "WSL・ネットワーク上や長いパスのフォルダは外へドラッグできません（ファイルなら出せます）: {}",
                display_name(p)
            ));
        }
        if !pruned {
            prune_short_root(short_root);
            pruned = true;
        }
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = short_root.join(format!("{nanos:x}{i}"));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let dest = dir.join(p.file_name().ok_or("ファイル名がありません")?);
        if let Err(e) = std::fs::copy(p, &dest) {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(format!("{}: {e}", display_name(p)));
        }
        let r2 = resolve(&dest).map_err(|e| e.to_string())?;
        if !r2.usable {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(format!(
                "ファイル名が長すぎるか、Windows で扱えない名前のため外へ渡せません: {}",
                display_name(p)
            ));
        }
        out.push(r2.path.to_string_lossy().to_string());
    }
    Ok(out)
}

/// drag クレート（Windows）と同じ解決をする
#[cfg(windows)]
fn resolve_for_shell(p: &Path) -> std::io::Result<Resolved> {
    let path = dunce::canonicalize(p)?;
    let usable = !is_verbatim(&path.to_string_lossy());
    Ok(Resolved { path, usable })
}

/// Windows 以外（GTK / macOS）はパスをそのまま渡せる
#[cfg(not(windows))]
fn resolve_for_shell(p: &Path) -> std::io::Result<Resolved> {
    std::fs::metadata(p)?;
    Ok(Resolved {
        path: p.to_path_buf(),
        usable: true,
    })
}

/// 外へのドラッグの直前に呼ぶ。OS に渡すパス（コピーした場合はコピー先）を返す。
/// 大きなファイルのコピーで画面を止めないよう、ワーカースレッドで行う。
#[tauri::command]
pub async fn prepare_drag_out(paths: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        prepare_paths(&paths, &short_root(), &resolve_for_shell)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn GetAsyncKeyState(vkey: i32) -> i16;
    fn GetSystemMetrics(index: i32) -> i32;
}

/// マウスの主ボタンが今押されているか（OS に直接尋ねる）。分からない OS では None。
///
/// Alt+Tab で Tana が前面を外れると、ボタンを離しても webview に mouseup が届かない。
/// 取り寄せを待つ間に離されたかを、webview のイベントでは判定できないため。
#[tauri::command]
pub fn primary_button_down() -> Option<bool> {
    #[cfg(windows)]
    {
        const VK_LBUTTON: i32 = 0x01;
        const VK_RBUTTON: i32 = 0x02;
        const SM_SWAPBUTTON: i32 = 23;
        // SAFETY: 引数は定数のみ。どちらも状態を読むだけの Win32 API。
        unsafe {
            let vk = if GetSystemMetrics(SM_SWAPBUTTON) != 0 {
                VK_RBUTTON
            } else {
                VK_LBUTTON
            };
            Some((GetAsyncKeyState(vk) as u16 & 0x8000) != 0)
        }
    }
    #[cfg(not(windows))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 綴りが limit 文字以上なら「渡せない」とみなす偽の解決
    fn fake(limit: usize) -> impl Fn(&Path) -> std::io::Result<Resolved> {
        move |p: &Path| {
            std::fs::metadata(p)?;
            Ok(Resolved {
                path: p.to_path_buf(),
                usable: p.to_string_lossy().len() < limit,
            })
        }
    }

    #[test]
    fn verbatim_prefix() {
        assert!(is_verbatim(r"\\?\C:\a\b.txt"));
        assert!(!is_verbatim(r"C:\a\b.txt"));
        assert!(!is_verbatim(r"\\server\share\b.txt"));
        assert!(!is_verbatim("/home/a.txt"));
    }

    #[test]
    fn usable_paths_pass_through() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a.txt");
        std::fs::write(&a, b"x").unwrap();
        let paths = vec![a.to_string_lossy().to_string()];
        let out = prepare_paths(&paths, &tmp.path().join("s"), &fake(10_000)).unwrap();
        assert_eq!(out, paths);
        assert!(!tmp.path().join("s").exists(), "渡せるならコピーしない");
    }

    #[test]
    fn unusable_file_is_copied_to_short_root() {
        // WSL（\\?\UNC\…）・長いリモートの写し・長い手元のパス、どれも同じ扱い
        let tmp = tempfile::tempdir().unwrap();
        let deep = tmp.path().join("x".repeat(80)).join("y".repeat(80));
        std::fs::create_dir_all(&deep).unwrap();
        let f = deep.join("sponsor-email-summary.md");
        std::fs::write(&f, b"data").unwrap();
        let short = tmp.path().join("s");
        let limit = f.to_string_lossy().len(); // 元のパスはちょうど渡せない長さ
        let out = prepare_paths(&[f.to_string_lossy().to_string()], &short, &fake(limit)).unwrap();
        let moved = Path::new(&out[0]);
        assert!(moved.starts_with(&short));
        assert_eq!(moved.file_name().unwrap(), "sponsor-email-summary.md");
        assert_eq!(std::fs::read(moved).unwrap(), b"data");
        assert!(f.exists(), "元のファイルはそのまま");
    }

    #[test]
    fn mixed_items_keep_order_and_copy_only_unusable() {
        let tmp = tempfile::tempdir().unwrap();
        let ok = tmp.path().join("a.txt");
        std::fs::write(&ok, b"1").unwrap();
        let deep = tmp.path().join("z".repeat(60));
        std::fs::create_dir_all(&deep).unwrap();
        let bad = deep.join("b.txt");
        std::fs::write(&bad, b"2").unwrap();
        let short = tmp.path().join("s");
        // "zzz" を含むパスだけ渡せない（WSL 上のファイルの見立て）
        let wsl_like = |p: &Path| -> std::io::Result<Resolved> {
            std::fs::metadata(p)?;
            Ok(Resolved {
                path: p.to_path_buf(),
                usable: !p.to_string_lossy().contains("zzz"),
            })
        };
        let out = prepare_paths(
            &[
                ok.to_string_lossy().to_string(),
                bad.to_string_lossy().to_string(),
            ],
            &short,
            &wsl_like,
        )
        .unwrap();
        assert_eq!(out[0], ok.to_string_lossy());
        assert!(Path::new(&out[1]).starts_with(&short));
        assert!(out[1].ends_with("b.txt"));
    }

    #[test]
    fn unusable_folder_is_refused_with_reason() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path().join("docs");
        std::fs::create_dir_all(&d).unwrap();
        let err = prepare_paths(
            &[d.to_string_lossy().to_string()],
            &tmp.path().join("s"),
            &fake(1),
        )
        .unwrap_err();
        assert!(err.contains("フォルダ") && err.contains("docs"), "{err}");
        assert!(!tmp.path().join("s").exists(), "フォルダはコピーしない");
    }

    #[test]
    fn refuses_when_even_the_short_copy_is_unusable() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("n".repeat(100));
        std::fs::write(&f, b"x").unwrap();
        let short = tmp.path().join("s");
        let err = prepare_paths(&[f.to_string_lossy().to_string()], &short, &fake(1)).unwrap_err();
        assert!(err.contains("ファイル名"), "{err}");
        // 使えないコピーは片付ける
        assert_eq!(std::fs::read_dir(&short).unwrap().count(), 0);
    }

    #[test]
    fn missing_file_is_an_error_not_a_panic() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("gone.txt");
        let err = prepare_paths(
            &[p.to_string_lossy().to_string()],
            &tmp.path().join("s"),
            &fake(10_000),
        )
        .unwrap_err();
        assert!(err.contains("gone.txt"), "{err}");
    }

    #[test]
    fn prune_removes_only_old_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let fresh = tmp.path().join("fresh");
        std::fs::create_dir_all(&fresh).unwrap();
        prune_short_root(tmp.path());
        assert!(fresh.exists());
        prune_short_root(&tmp.path().join("none")); // 無くても落ちない
    }

    #[test]
    fn button_state_is_unknown_off_windows() {
        #[cfg(not(windows))]
        assert_eq!(primary_button_down(), None);
    }
}
