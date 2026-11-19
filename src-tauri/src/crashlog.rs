// crashlog.rs — panic を記録し、次の起動で知らせる
//
// リリース版の Windows はコンソールが無く、Rust の panic は誰にも見えないまま
// Tana が終わる（イベントループで起きた panic は tao が受け止めてから終了するので、
// Windows のエラー報告にも残らない）。原因を追えるよう、panic の内容を
// <ローカルのアプリデータ>/com.dobachi.tana/crash.log に追記し、目印ファイルを置く。
// 次の起動で目印があれば画面で知らせる（take_crash_notice）。

use std::io::Write;
use std::path::{Path, PathBuf};

const LOG_NAME: &str = "crash.log";
const PENDING_NAME: &str = "crash-pending";
/// これより大きくなったら古い記録を crash.old.log へ退ける
const MAX_LOG_BYTES: u64 = 512 * 1024;

/// 記録を置くフォルダ
pub fn crash_dir() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("com.dobachi.tana"))
}

/// 1970-01-01 からの日数を (年, 月, 日) にする（グレゴリオ暦）
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

/// UNIX 秒を `2026-11-19 14:05:09 UTC` の形にする
pub fn format_utc(secs: u64) -> String {
    let secs = secs as i64;
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    let rem = secs.rem_euclid(86_400);
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02} UTC",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// 記録 1 件ぶんの文字列
pub fn format_report(
    secs: u64,
    version: &str,
    thread: &str,
    message: &str,
    location: &str,
    backtrace: &str,
) -> String {
    format!(
        "==== {} / Tana {version} ====\nthread: {thread}\nat: {location}\nmessage: {message}\nbacktrace:\n{backtrace}\n\n",
        format_utc(secs)
    )
}

/// panic の payload から文言を取り出す
fn payload_text(info: &std::panic::PanicHookInfo<'_>) -> String {
    let p = info.payload();
    if let Some(s) = p.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = p.downcast_ref::<String>() {
        s.clone()
    } else {
        "(文字列ではない panic)".to_string()
    }
}

/// 記録を追記し、目印を置く
pub fn write_report(dir: &Path, report: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let log = dir.join(LOG_NAME);
    if std::fs::metadata(&log).is_ok_and(|m| m.len() > MAX_LOG_BYTES) {
        let _ = std::fs::rename(&log, dir.join("crash.old.log"));
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log)?;
    f.write_all(report.as_bytes())?;
    std::fs::write(dir.join(PENDING_NAME), b"")?;
    Ok(())
}

/// 目印があれば消して、記録のパスを返す
pub fn take_notice(dir: &Path) -> Option<String> {
    let pending = dir.join(PENDING_NAME);
    if !pending.exists() {
        return None;
    }
    let _ = std::fs::remove_file(&pending);
    Some(dir.join(LOG_NAME).to_string_lossy().to_string())
}

/// panic フックを入れる。既定のフック（stderr への出力）も残す。
pub fn install() {
    let Some(dir) = crash_dir() else {
        return;
    };
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_default();
        let thread = std::thread::current()
            .name()
            .unwrap_or("(名前なし)")
            .to_string();
        let backtrace = std::backtrace::Backtrace::force_capture().to_string();
        let report = format_report(
            secs,
            env!("CARGO_PKG_VERSION"),
            &thread,
            &payload_text(info),
            &location,
            &backtrace,
        );
        let _ = write_report(&dir, &report);
        prev(info);
    }));
}

/// 記録の場所を開くときの行き先。記録があればそのファイル、無ければフォルダ
/// （無ければ作る。開いた先が「見つかりません」にならないように）。
pub fn log_location(dir: &Path) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let log = dir.join(LOG_NAME);
    Ok(if log.is_file() {
        log
    } else {
        dir.to_path_buf()
    })
}

/// 記録の場所（ヘルプメニューの「異常終了の記録を開く」）
#[tauri::command]
pub fn crash_log_location() -> Result<String, String> {
    let dir = crash_dir().ok_or("記録の場所が分かりません")?;
    log_location(&dir)
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

/// 前回 panic で終わっていたら、記録のパスを返す（1 回だけ）
#[tauri::command]
pub fn take_crash_notice() -> Option<String> {
    take_notice(&crash_dir()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_utc_dates() {
        assert_eq!(format_utc(0), "1970-01-01 00:00:00 UTC");
        // 2000-02-29（うるう日）
        assert_eq!(format_utc(951_782_400), "2000-02-29 00:00:00 UTC");
        // 2026-11-19 14:05:09
        assert_eq!(format_utc(1_795_097_109), "2026-11-19 14:05:09 UTC");
        // 年末の 23:59:59
        assert_eq!(format_utc(1_798_761_599), "2026-12-31 23:59:59 UTC");
    }

    #[test]
    fn report_contains_every_field() {
        let r = format_report(0, "1.2.3", "main", "boom", "src/x.rs:9", "frame0");
        for s in [
            "1970-01-01",
            "Tana 1.2.3",
            "main",
            "boom",
            "src/x.rs:9",
            "frame0",
        ] {
            assert!(r.contains(s), "{s} がない: {r}");
        }
    }

    #[test]
    fn write_then_take_notice_once() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("app");
        assert_eq!(take_notice(&dir), None);
        write_report(&dir, "first\n").unwrap();
        write_report(&dir, "second\n").unwrap();
        let log = std::fs::read_to_string(dir.join(LOG_NAME)).unwrap();
        assert_eq!(log, "first\nsecond\n", "追記する");
        let got = take_notice(&dir).unwrap();
        assert!(got.ends_with(LOG_NAME));
        assert_eq!(take_notice(&dir), None, "知らせるのは 1 回だけ");
    }

    #[test]
    fn log_location_points_at_log_or_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("app");
        // 記録がまだ無い: フォルダを作ってフォルダを返す
        assert_eq!(log_location(&dir).unwrap(), dir);
        assert!(dir.is_dir());
        // 記録がある: そのファイルを返す（開くとカーソルが合う）
        write_report(&dir, "x\n").unwrap();
        assert_eq!(log_location(&dir).unwrap(), dir.join(LOG_NAME));
    }

    #[test]
    fn large_log_is_rotated() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        std::fs::write(dir.join(LOG_NAME), vec![b'x'; (MAX_LOG_BYTES + 1) as usize]).unwrap();
        write_report(dir, "new\n").unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join(LOG_NAME)).unwrap(),
            "new\n"
        );
        assert!(dir.join("crash.old.log").exists());
    }
}
