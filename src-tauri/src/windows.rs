//! 追加のウィンドウ（ファイル → 新しいウィンドウ / フォルダを新しいウィンドウで開く）。
//!
//! 最初のウィンドウは "main"、追加分は "win-1", "win-2" … 。追加ウィンドウは同じ
//! index.html を読み、開く場所は起動後に `take_open_request` で受け取る
//! （URL に載せるとエスケープや長さを気にすることになるため）。

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

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
/// `build()` を呼び出し元のスレッドでやると Windows で固まる（同期コマンドはイベント
/// ループのスレッドで動き、build() もそのスレッドを要るため）。開く場所だけ先に預け、
/// 作るのは別スレッドに任せる（Fude と同じ）。
#[tauri::command]
pub fn new_window(
    app: tauri::AppHandle,
    pending: State<'_, PendingOpens>,
    path: Option<String>,
) -> Result<(), String> {
    let label = window_label(WINDOW_SEQ.fetch_add(1, Ordering::SeqCst));
    if let Some(p) = path.filter(|p| !p.is_empty()) {
        pending.put(&label, p);
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
    Ok(())
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
