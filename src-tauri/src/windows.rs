//! 追加のウィンドウ（ファイル → 新しいウィンドウ / フォルダを新しいウィンドウで開く）。
//!
//! 最初のウィンドウは "main"、追加分は "win-1", "win-2" … 。追加ウィンドウは同じ
//! index.html を読み、開く場所は起動後に `take_open_request` で受け取る
//! （URL に載せるとエスケープや長さを気にすることになるため）。
//!
//! Tana は 1 つだけ起動する（single-instance）。起動中にもう一度起動されたら（スタート
//! メニュー・`tana DIR`・「プログラムから開く」）、場所の指定が無ければ新しいウィンドウを開き、
//! 指定があれば最初のウィンドウの新しいタブで開く（Fude と同じ規則）。

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

/// 追加ウィンドウのラベルの通し番号。
static WINDOW_SEQ: AtomicUsize = AtomicUsize::new(1);

/// 追加ウィンドウのラベル（capabilities の "win-*" と合わせる）。
pub fn window_label(seq: usize) -> String {
    format!("win-{seq}")
}

/// ウィンドウごとの「開く場所」。新しいウィンドウが起動時に 1 回だけ取り出す。
#[derive(Default)]
pub struct PendingOpens(Mutex<HashMap<String, String>>);

impl PendingOpens {
    pub fn put(&self, label: &str, path: String) {
        if let Ok(mut m) = self.0.lock() {
            m.insert(label.to_string(), path);
        }
    }

    pub fn take(&self, label: &str) -> Option<String> {
        self.0.lock().ok()?.remove(label)
    }
}

/// 新しいウィンドウを開く。path があればそこを開く（無ければホーム）。
///
/// `build()` を呼び出し元のスレッドでやると Windows で固まる（同期コマンドや single-instance
/// の処理はイベントループのスレッドで動き、build() もそのスレッドを要るため）。開く場所だけ
/// 先に預け、作るのは別スレッドに任せる（Fude と同じ）。
pub fn spawn_window(app: &tauri::AppHandle, path: Option<String>) {
    let label = window_label(WINDOW_SEQ.fetch_add(1, Ordering::SeqCst));
    if let Some(p) = path.filter(|p| !p.is_empty()) {
        app.state::<PendingOpens>().put(&label, p);
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let built = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
            .title("Tana")
            .inner_size(1200.0, 800.0)
            .resizable(true)
            .build();
        if let Err(e) = built {
            // 作れなかった分の預かりは捨てる
            app.state::<PendingOpens>().take(&label);
            eprintln!("ウィンドウ {label} を開けません: {e}");
        }
    });
}

#[tauri::command]
pub fn new_window(app: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    spawn_window(&app, path);
    Ok(())
}

/// 起動引数から開く場所を取り出す（argv[0] は実行ファイル。`-` で始まるものは飛ばす）。
pub fn path_arg(argv: &[String]) -> Option<String> {
    argv.iter()
        .skip(1)
        .find(|a| !a.starts_with('-') && !a.is_empty())
        .cloned()
}

/// 相対パスを、もう一度起動されたときのカレントディレクトリで絶対にする（リモートはそのまま）。
pub fn resolve_open_path(arg: &str, cwd: &str) -> String {
    if arg.starts_with("sftp://") || Path::new(arg).is_absolute() || cwd.is_empty() {
        return arg.to_string();
    }
    Path::new(cwd).join(arg).to_string_lossy().to_string()
}

/// もう一度起動されたときにすること。
#[derive(Debug, PartialEq)]
pub enum SecondLaunch {
    /// 新しいウィンドウを開く（場所の指定があればそこ）
    NewWindow(Option<String>),
    /// 最初のウィンドウを前に出し、その場所を新しいタブで開く
    OpenInMain(String),
}

/// 場所の指定が無ければ新しいウィンドウ、あれば最初のウィンドウで開く
/// （最初のウィンドウが閉じられていれば、その場所で新しいウィンドウ）。
pub fn second_launch(argv: &[String], cwd: &str, has_main: bool) -> SecondLaunch {
    match path_arg(argv).map(|p| resolve_open_path(&p, cwd)) {
        Some(p) if has_main => SecondLaunch::OpenInMain(p),
        other => SecondLaunch::NewWindow(other),
    }
}

/// single-instance から呼ばれる。
pub fn on_second_launch(app: &tauri::AppHandle, argv: Vec<String>, cwd: String) {
    let main = app.get_webview_window("main");
    match second_launch(&argv, &cwd, main.is_some()) {
        SecondLaunch::NewWindow(path) => spawn_window(app, path),
        SecondLaunch::OpenInMain(path) => {
            if let Some(w) = main {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
                // 最初のウィンドウだけに送る（他のウィンドウは今の表示のまま）
                let _ = app.emit_to("main", "open-path", path);
            }
        }
    }
}

/// 呼び出したウィンドウに預けられた「開く場所」を取り出す（無ければ None）。
#[tauri::command]
pub fn take_open_request(
    window: tauri::Window,
    pending: State<'_, PendingOpens>,
) -> Option<String> {
    pending.take(window.label())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_match_the_capability_pattern() {
        assert_eq!(window_label(1), "win-1");
        assert_eq!(window_label(12), "win-12");
        // capabilities/default.json の "win-*" に掛かる形
        let caps = include_str!("../capabilities/default.json");
        assert!(caps.contains("\"win-*\""));
    }

    fn argv(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn launch_without_path_opens_a_new_window() {
        // スタートメニューからの起動（引数なし）
        assert_eq!(
            second_launch(&argv(&["tana.exe"]), "C:\\Users\\me", true),
            SecondLaunch::NewWindow(None)
        );
        // フラグだけでも同じ
        assert_eq!(
            second_launch(&argv(&["tana", "--verbose"]), "/home/me", true),
            SecondLaunch::NewWindow(None)
        );
    }

    #[test]
    fn launch_with_path_opens_it_in_the_main_window() {
        assert_eq!(
            second_launch(&argv(&["tana", "/srv/data"]), "/home/me", true),
            SecondLaunch::OpenInMain("/srv/data".into())
        );
        assert_eq!(
            second_launch(&argv(&["tana", "sftp://k16/tmp"]), "/home/me", true),
            SecondLaunch::OpenInMain("sftp://k16/tmp".into())
        );
        // 最初のウィンドウが閉じられていれば、その場所で新しいウィンドウ
        assert_eq!(
            second_launch(&argv(&["tana", "/srv"]), "/home/me", false),
            SecondLaunch::NewWindow(Some("/srv".into()))
        );
    }

    #[test]
    fn relative_path_is_resolved_against_the_launch_cwd() {
        let got = resolve_open_path("work", "/home/me");
        assert_eq!(Path::new(&got), Path::new("/home/me").join("work"));
        assert_eq!(resolve_open_path("sftp://h/x", "/home/me"), "sftp://h/x");
        assert_eq!(resolve_open_path("x", ""), "x");
    }

    #[test]
    fn open_request_is_taken_once_per_window() {
        let p = PendingOpens::default();
        p.put("win-1", "/a".into());
        p.put("win-2", "sftp://h/b".into());
        assert_eq!(p.take("win-1").as_deref(), Some("/a"));
        assert_eq!(p.take("win-1"), None);
        assert_eq!(p.take("main"), None);
        assert_eq!(p.take("win-2").as_deref(), Some("sftp://h/b"));
    }
}
