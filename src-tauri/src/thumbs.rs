// thumbs.rs — 一覧の名前の左に出す小さな写真（サムネイル）
//
// 元の写真を毎回読むと重いので、1 回だけ縮めてキャッシュ（OS のキャッシュフォルダの
// tana/thumbs）に PNG で置き、その場所を返す。フロントは asset プロトコルで表示する。
// キャッシュの名前はパス・更新日時・サイズ・大きさから作るので、写真を差し替えれば作り直す。
//
// ローカルのファイルだけを扱う（リモートは丸ごと取り寄せることになるので、フロントが頼まない）。

use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// これより大きいファイルは作らない（読むだけで時間とメモリを食う）
pub const MAX_SOURCE_BYTES: u64 = 50 * 1024 * 1024;
/// 縮めた後の長い辺の上限（高精細の画面でも粗く見えない大きさ）
pub const MAX_PX: u32 = 256;
/// 展開に使うメモリの上限（巨大な画像で固まらないように）
const MAX_DECODE_ALLOC: u64 = 512 * 1024 * 1024;
/// キャッシュの合計の上限。超えたら古いものから消す
pub const CACHE_MAX_BYTES: u64 = 200 * 1024 * 1024;
/// 書きかけのファイル名を呼び出しごとに変えるための通し番号
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);
/// キャッシュを使ったとき、この時間より古ければ更新日時を今にする（消される順を後ろへ）
const TOUCH_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

/// 縮めて表示できる形式か（拡張子で判断。中身は image が改めて見分ける）
pub fn is_supported_name(name: &str) -> bool {
    let ext = match name.rsplit_once('.') {
        Some((_, e)) => e.to_ascii_lowercase(),
        None => return false,
    };
    matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "jpe" | "png" | "gif" | "webp" | "bmp"
    )
}

/// キャッシュのファイル名。同じ写真・同じ大きさなら同じ名前、変われば別の名前になる。
pub fn cache_name(path: &str, modified: Option<SystemTime>, size: u64, px: u32) -> String {
    let nanos = modified
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut h = Sha256::new();
    h.update(format!("{path}\0{nanos}\0{size}\0{px}").as_bytes());
    format!("{}.png", &hex::encode(h.finalize())[..32])
}

fn cache_dir() -> Option<PathBuf> {
    dirs::cache_dir().map(|d| d.join("tana").join("thumbs"))
}

/// 写真を読み、向き（EXIF の回転）を反映して、長い辺が px 以下になるよう縮める。
pub fn render(src: &Path, px: u32) -> Result<DynamicImage, String> {
    let mut reader = ImageReader::open(src)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    reader.limits(limits);
    let is_jpeg = reader.format() == Some(ImageFormat::Jpeg);
    let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let orientation = decoder.orientation().ok();
    // JPEG は縮めながら読める（全部を展開しない分、数倍速い）。読めない作りなら普通に読む
    let scaled = if is_jpeg {
        decode_jpeg_scaled(src, px)
    } else {
        None
    };
    let mut img = match scaled {
        Some(img) => img,
        None => DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?,
    };
    if let Some(o) = orientation {
        img.apply_orientation(o);
    }
    Ok(img.thumbnail(px, px))
}

/// JPEG を、長い辺が px 以上の範囲でいちばん小さく（最大 1/8 に）縮めながら読む。
/// CMYK や 16 ビットのグレーは None（呼び出し側が普通に読む）。
fn decode_jpeg_scaled(src: &Path, px: u32) -> Option<DynamicImage> {
    use jpeg_decoder::{Decoder, PixelFormat};
    let file = std::fs::File::open(src).ok()?;
    let mut dec = Decoder::new(std::io::BufReader::new(file));
    let want = px.min(u16::MAX as u32) as u16;
    dec.scale(want, want).ok()?;
    let pixels = dec.decode().ok()?;
    let info = dec.info()?;
    let (w, h) = (info.width as u32, info.height as u32);
    match info.pixel_format {
        PixelFormat::RGB24 => image::RgbImage::from_raw(w, h, pixels).map(DynamicImage::ImageRgb8),
        PixelFormat::L8 => image::GrayImage::from_raw(w, h, pixels).map(DynamicImage::ImageLuma8),
        // CMYK（印刷用）と 16 ビットのグレーは、色の扱いを image に任せる
        PixelFormat::CMYK32 | PixelFormat::L16 => None,
    }
}

/// 縮めた写真を cache に作り（あればそれを使い）、その場所を返す。
/// 扱えない・大きすぎる・読めないものは None（フロントは枠を空けたままにする）。
pub fn thumbnail_in(cache: &Path, src: &Path, px: u32) -> Option<PathBuf> {
    let name = src.file_name()?.to_string_lossy().to_string();
    if !is_supported_name(&name) {
        return None;
    }
    let meta = std::fs::metadata(src).ok()?;
    if !meta.is_file() || meta.len() > MAX_SOURCE_BYTES {
        return None;
    }
    let px = px.clamp(16, MAX_PX);
    let out = cache.join(cache_name(
        &src.to_string_lossy(),
        meta.modified().ok(),
        meta.len(),
        px,
    ));
    if let Ok(m) = std::fs::metadata(&out) {
        touch_if_old(&out, m.modified().ok());
        return Some(out);
    }
    let img = render(src, px).ok()?;
    std::fs::create_dir_all(cache).ok()?;
    // 書きかけを読ませないよう、別名で書いてから置き換える
    // 同じ写真を同時に頼まれる（左右のペインが同じフォルダ）ことがあるので、書きかけの名前は呼び出しごとに変える
    let tmp = out.with_extension(format!(
        "tmp{}-{}",
        std::process::id(),
        TMP_SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    if img.save_with_format(&tmp, ImageFormat::Png).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return None;
    }
    if std::fs::rename(&tmp, &out).is_err() {
        let _ = std::fs::remove_file(&tmp);
        // 先に別の呼び出しが置いていれば、それを使う
        return out.is_file().then_some(out);
    }
    Some(out)
}

fn touch_if_old(path: &Path, modified: Option<SystemTime>) {
    let old = modified
        .and_then(|m| SystemTime::now().duration_since(m).ok())
        .is_some_and(|age| age > TOUCH_AFTER);
    if old {
        if let Ok(f) = std::fs::File::options().write(true).open(path) {
            let _ = f.set_modified(SystemTime::now());
        }
    }
}

/// キャッシュの合計が max_bytes を超えていたら、更新日時の古いものから消す。
/// 消した数を返す。
pub fn prune(cache: &Path, max_bytes: u64) -> usize {
    let Ok(rd) = std::fs::read_dir(cache) else {
        return 0;
    };
    let mut files: Vec<(SystemTime, u64, PathBuf)> = rd
        .flatten()
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            m.is_file()
                .then(|| (m.modified().unwrap_or(UNIX_EPOCH), m.len(), e.path()))
        })
        .collect();
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    if total <= max_bytes {
        return 0;
    }
    files.sort_by_key(|f| f.0);
    let mut removed = 0;
    for (_, len, path) in files {
        if total <= max_bytes {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(len);
            removed += 1;
        }
    }
    removed
}

/// 起動時に一度、キャッシュを上限まで減らす（裏で）。
pub fn prune_in_background() {
    std::thread::spawn(|| {
        if let Some(dir) = cache_dir() {
            prune(&dir, CACHE_MAX_BYTES);
        }
    });
}

/// 小さな写真の場所を返す（作れなければ None）。読み込みと縮小は重いので別スレッドで行う。
#[tauri::command]
pub async fn thumbnail(path: String, px: u32) -> Result<Option<String>, String> {
    let cache = cache_dir().ok_or("キャッシュフォルダが見つかりません")?;
    tauri::async_runtime::spawn_blocking(move || {
        thumbnail_in(&cache, Path::new(&path), px).map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    fn write_jpeg(path: &Path, w: u32, h: u32) {
        let img = RgbImage::from_fn(w, h, |x, _| Rgb([(x % 256) as u8, 100, 50]));
        img.save_with_format(path, ImageFormat::Jpeg).unwrap();
    }

    #[test]
    fn supported_names_are_by_extension_case_insensitive() {
        for n in [
            "a.jpg", "b.JPEG", "c.png", "d.gif", "e.WebP", "f.bmp", "g.jpe",
        ] {
            assert!(is_supported_name(n), "{n}");
        }
        for n in ["a.heic", "b.mp4", "c.txt", "jpg", "d.", "e.svg", "f.tiff"] {
            assert!(!is_supported_name(n), "{n}");
        }
    }

    #[test]
    fn cache_name_changes_with_any_input() {
        let t = Some(UNIX_EPOCH + Duration::from_secs(1000));
        let base = cache_name("/a.jpg", t, 10, 64);
        assert!(base.ends_with(".png"));
        assert_eq!(base, cache_name("/a.jpg", t, 10, 64));
        assert_ne!(base, cache_name("/b.jpg", t, 10, 64));
        assert_ne!(base, cache_name("/a.jpg", Some(UNIX_EPOCH), 10, 64));
        assert_ne!(base, cache_name("/a.jpg", t, 11, 64));
        assert_ne!(base, cache_name("/a.jpg", t, 10, 32));
    }

    #[test]
    fn makes_a_small_png_and_reuses_it() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("photo.jpg");
        write_jpeg(&src, 800, 400);
        let cache = dir.path().join("cache");

        let out = thumbnail_in(&cache, &src, 64).expect("thumbnail");
        let img = image::open(&out).unwrap();
        assert_eq!((img.width(), img.height()), (64, 32)); // 縦横比を保つ
        let first = std::fs::metadata(&out).unwrap().modified().unwrap();

        // 2 回目はキャッシュをそのまま返す
        let again = thumbnail_in(&cache, &src, 64).unwrap();
        assert_eq!(again, out);
        assert_eq!(
            std::fs::metadata(&again).unwrap().modified().unwrap(),
            first
        );
        assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 1);
    }

    #[test]
    fn a_changed_photo_gets_a_new_thumbnail() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("p.jpg");
        let cache = dir.path().join("cache");
        write_jpeg(&src, 100, 100);
        let a = thumbnail_in(&cache, &src, 32).unwrap();
        write_jpeg(&src, 300, 100); // 大きさが変わる
        let b = thumbnail_in(&cache, &src, 32).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn small_images_are_not_enlarged_and_px_is_clamped() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("tiny.png");
        RgbImage::new(10, 5)
            .save_with_format(&src, ImageFormat::Png)
            .unwrap();
        let out = thumbnail_in(&dir.path().join("c"), &src, 9999).unwrap();
        let img = image::open(out).unwrap();
        assert!(img.width() <= MAX_PX && img.height() <= MAX_PX);
    }

    #[test]
    fn unsupported_missing_or_broken_files_give_none() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache");
        let txt = dir.path().join("a.txt");
        std::fs::write(&txt, "hello").unwrap();
        assert!(thumbnail_in(&cache, &txt, 64).is_none());
        assert!(thumbnail_in(&cache, &dir.path().join("none.jpg"), 64).is_none());
        let broken = dir.path().join("broken.jpg");
        std::fs::write(&broken, b"not really a jpeg").unwrap();
        assert!(thumbnail_in(&cache, &broken, 64).is_none());
        let folder = dir.path().join("folder.jpg");
        std::fs::create_dir(&folder).unwrap();
        assert!(thumbnail_in(&cache, &folder, 64).is_none());
        // 失敗では何も残さない
        assert!(!cache.exists() || std::fs::read_dir(&cache).unwrap().count() == 0);
    }

    #[test]
    fn prune_removes_oldest_until_under_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        let now = SystemTime::now();
        for (i, name) in ["old.png", "mid.png", "new.png"].iter().enumerate() {
            let p = dir.path().join(name);
            std::fs::write(&p, vec![0u8; 100]).unwrap();
            let f = std::fs::File::options().write(true).open(&p).unwrap();
            f.set_modified(now - Duration::from_secs(1000 * (3 - i as u64)))
                .unwrap();
        }
        assert_eq!(prune(dir.path(), 300), 0); // 上限内なら何もしない
        assert_eq!(prune(dir.path(), 150), 2);
        assert!(dir.path().join("new.png").exists());
        assert!(!dir.path().join("old.png").exists());
        assert!(!dir.path().join("mid.png").exists());
        assert_eq!(prune(&dir.path().join("none"), 0), 0);
    }

    #[test]
    fn the_same_photo_requested_at_once_succeeds_for_everyone() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("same.jpg");
        write_jpeg(&src, 1200, 800);
        let cache = dir.path().join("cache");
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let (c, s) = (cache.clone(), src.clone());
                std::thread::spawn(move || thumbnail_in(&c, &s, 64))
            })
            .collect();
        let outs: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        assert!(outs.iter().all(|o| o.is_some()), "{outs:?}");
        // 書きかけは残らない
        let names: Vec<_> = std::fs::read_dir(&cache)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(names.len(), 1, "{names:?}");
    }
}
