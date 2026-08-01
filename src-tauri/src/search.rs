//! search.rs — 現在ディレクトリ配下の検索 (FR-18)。
//!
//! ファイル名の一致と、テキストファイルの内容一致（grep 相当）を再帰的に探す。
//! バイナリ・大きすぎるファイル・（既定で）隠しファイルは内容走査から除外する。
//! マッチ判定・スニペット整形は純粋関数に切り出してテスト可能にし、実際の
//! ディレクトリ走査(FS)は search_dir_impl が担う。結果は件数上限で頭打ちにし、
//! さらに世代(SearchState.epoch)ベースのキャンセルで、新しい検索やクローズが
//! 来たら実行中の走査を早期終了して応答性を確保する。

use crate::is_binary_head;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::State;

/// 検索のキャンセル用に「世代(エポック)」を持つ共有状態。新しい検索やクローズで
/// エポックを進め、実行中の検索は自分のエポックが最新でなくなったら早期終了する。
#[derive(Default)]
pub struct SearchState {
    pub epoch: AtomicU64,
}

/// 検索ヒット1件（ファイル名一致 or 内容一致）。
#[derive(Debug, Serialize, PartialEq, Clone)]
pub struct SearchHit {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    /// "name" | "content"
    pub kind: String,
    /// content のときのマッチ行番号（1始まり）
    pub line_no: Option<u32>,
    /// content のときのマッチ行（トリム＋最大長）
    pub line: Option<String>,
}

pub struct SearchOpts {
    pub case_insensitive: bool,
    pub regex: bool,
    pub include_hidden: bool,
    /// テキストファイルの内容も検索するか（false なら名前のみ＝高速）。
    pub search_content: bool,
    pub max_results: usize,
    pub max_file_bytes: u64,
    pub max_hits_per_file: usize,
    pub max_visited: usize,
}

impl Default for SearchOpts {
    fn default() -> Self {
        SearchOpts {
            case_insensitive: true,
            regex: false,
            include_hidden: false,
            search_content: true,
            max_results: 500,
            max_file_bytes: 1_000_000,
            max_hits_per_file: 20,
            max_visited: 50_000,
        }
    }
}

/// 走査から除外する重いディレクトリ（依存/ビルド生成物など）。名前ヒットは残すが
/// 中には降りない（大量ファイルで検索が重くなる主因を避ける）。
fn is_excluded_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | "target"
            | ".git"
            | ".venv"
            | "venv"
            | "__pycache__"
            | ".cache"
            | ".mypy_cache"
            | ".pytest_cache"
    )
}

/// needle が haystack に含まれるか（ci=大小無視）。空の needle は常に false。
pub fn contains_match(haystack: &str, needle: &str, ci: bool) -> bool {
    if needle.is_empty() {
        return false;
    }
    if ci {
        haystack.to_lowercase().contains(&needle.to_lowercase())
    } else {
        haystack.contains(needle)
    }
}

/// マッチ方式（部分一致 or 正規表現）。行/名前の両方に使い回す。
pub enum Matcher {
    Substring { needle: String, ci: bool },
    Regex(regex_lite::Regex),
}

impl Matcher {
    pub fn is_match(&self, hay: &str) -> bool {
        match self {
            Matcher::Substring { needle, ci } => contains_match(hay, needle, *ci),
            Matcher::Regex(re) => re.is_match(hay),
        }
    }
}

/// クエリからマッチャを作る。空クエリ・正規表現の構文エラーは None（＝検索しない）。
pub fn build_matcher(query: &str, ci: bool, regex: bool) -> Option<Matcher> {
    if query.is_empty() {
        return None;
    }
    if regex {
        // 大小無視は (?i) フラグで表現する
        let pat = if ci {
            format!("(?i){query}")
        } else {
            query.to_string()
        };
        regex_lite::Regex::new(&pat).ok().map(Matcher::Regex)
    } else {
        Some(Matcher::Substring {
            needle: query.to_string(),
            ci,
        })
    }
}

/// 表示用に行を trim し、max 文字を超えたら省略記号を付けて切る（純粋）。
pub fn snippet(line: &str, max: usize) -> String {
    let t = line.trim();
    if t.chars().count() <= max {
        t.to_string()
    } else {
        let s: String = t.chars().take(max).collect();
        format!("{s}…")
    }
}

/// 先頭ドットの隠し判定（走査の枝刈り用。Unix 慣習のみ）。
fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.')
}

/// root 配下を再帰的に検索する。名前一致と内容一致を集める。
pub fn search_dir_impl(
    root: &Path,
    query: &str,
    opts: &SearchOpts,
    cancelled: &dyn Fn() -> bool,
) -> Vec<SearchHit> {
    let mut hits = Vec::new();
    let matcher = match build_matcher(query, opts.case_insensitive, opts.regex) {
        Some(m) => m,
        None => return hits, // 空クエリ or 不正な正規表現
    };
    let mut visited = 0usize;
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let read = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue, // 権限なし等は黙って飛ばす
        };
        for entry in read.flatten() {
            if hits.len() >= opts.max_results || visited >= opts.max_visited || cancelled() {
                return hits;
            }
            visited += 1;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let hidden = is_hidden_name(&name);
            if hidden && !opts.include_hidden {
                continue;
            }
            let is_dir = path.is_dir();
            let path_s = path.to_string_lossy().replace('\\', "/");

            // ファイル名一致
            if matcher.is_match(&name) {
                hits.push(SearchHit {
                    path: path_s.clone(),
                    name: name.clone(),
                    is_dir,
                    kind: "name".into(),
                    line_no: None,
                    line: None,
                });
            }

            if is_dir {
                // 重いディレクトリ（node_modules 等）には降りない
                if !is_excluded_dir(&name) {
                    stack.push(path);
                }
                continue;
            }

            // 本文検索が無効なら以降（ファイル読取）はスキップ＝高速
            if !opts.search_content {
                continue;
            }

            // 内容一致（テキスト・サイズ上限内のみ）
            let too_big =
                entry.metadata().map(|m| m.len()).unwrap_or(u64::MAX) > opts.max_file_bytes;
            if too_big {
                continue;
            }
            let Ok(bytes) = std::fs::read(&path) else {
                continue;
            };
            if is_binary_head(&bytes[..bytes.len().min(4096)]) {
                continue;
            }
            let text = String::from_utf8_lossy(&bytes);
            let mut per_file = 0usize;
            for (i, raw) in text.lines().enumerate() {
                if per_file >= opts.max_hits_per_file || hits.len() >= opts.max_results {
                    break;
                }
                if matcher.is_match(raw) {
                    per_file += 1;
                    hits.push(SearchHit {
                        path: path_s.clone(),
                        name: name.clone(),
                        is_dir: false,
                        kind: "content".into(),
                        line_no: Some((i + 1) as u32),
                        line: Some(snippet(raw, 200)),
                    });
                }
            }
        }
    }
    hits
}

/// 「現在ディレクトリ配下を検索」する Tauri コマンド。
#[tauri::command]
pub fn search_dir(
    state: State<'_, SearchState>,
    dir: String,
    query: String,
    case_insensitive: bool,
    include_hidden: bool,
    regex: bool,
    search_content: bool,
) -> Vec<SearchHit> {
    // 自分の世代を確定。以降より新しい検索/キャンセルが来たら中断する。
    let my = state.epoch.fetch_add(1, Ordering::SeqCst) + 1;
    let epoch = &state.epoch;
    let opts = SearchOpts {
        case_insensitive,
        regex,
        include_hidden,
        search_content,
        ..Default::default()
    };
    search_dir_impl(Path::new(&dir), &query, &opts, &|| {
        epoch.load(Ordering::SeqCst) != my
    })
}

/// 実行中の検索を中断する（世代を進めるだけ）。オーバーレイを閉じたとき等に呼ぶ。
#[tauri::command]
pub fn cancel_search(state: State<'_, SearchState>) {
    state.epoch.fetch_add(1, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn contains_match_respects_case_flag() {
        assert!(contains_match("Hello World", "hello", true));
        assert!(!contains_match("Hello World", "hello", false));
        assert!(contains_match("Hello World", "World", false));
        assert!(!contains_match("abc", "", true)); // 空は常に false
    }

    #[test]
    fn build_matcher_substring_and_regex() {
        // 部分一致
        let m = build_matcher("cat", true, false).unwrap();
        assert!(m.is_match("concatenate"));
        assert!(m.is_match("CAT")); // ci
                                    // 正規表現
        let re = build_matcher(r"ab\d+", false, true).unwrap();
        assert!(re.is_match("ab123"));
        assert!(!re.is_match("abc"));
        // 正規表現 + 大小無視
        let rei = build_matcher("foo", true, true).unwrap();
        assert!(rei.is_match("FOO bar"));
        // 空クエリ・不正な正規表現は None
        assert!(build_matcher("", true, false).is_none());
        assert!(build_matcher("a(", true, true).is_none());
    }

    #[test]
    fn search_with_regex_matches_pattern() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(
            tmp.path().join("log.txt"),
            b"error 404\nok 200\nerror 500\n",
        )
        .unwrap();
        let opts = SearchOpts {
            regex: true,
            ..Default::default()
        };
        let hits = search_dir_impl(tmp.path(), r"error \d+", &opts, &|| false);
        let lines: Vec<_> = hits
            .iter()
            .filter(|h| h.kind == "content")
            .map(|h| h.line_no.unwrap())
            .collect();
        assert_eq!(lines, vec![1, 3]);
    }

    #[test]
    fn invalid_regex_returns_empty() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), b"anything").unwrap();
        let opts = SearchOpts {
            regex: true,
            ..Default::default()
        };
        assert!(search_dir_impl(tmp.path(), "a(", &opts, &|| false).is_empty());
    }

    #[test]
    fn snippet_trims_and_truncates() {
        assert_eq!(snippet("  hi there  ", 100), "hi there");
        assert_eq!(snippet("abcdef", 3), "abc…");
        assert_eq!(snippet("あいうえお", 2), "あい…"); // マルチバイトも文字数で
    }

    #[test]
    fn finds_name_and_content_matches_recursively() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("needle_file.txt"), b"nothing here\n").unwrap();
        fs::write(
            root.join("sub/data.txt"),
            b"line one\nhas NEEDLE inside\nlast\n",
        )
        .unwrap();
        fs::write(root.join("sub/bin.dat"), [0u8, 1, 2, 3, 0, 255]).unwrap();

        let hits = search_dir_impl(root, "needle", &SearchOpts::default(), &|| false);
        // 名前一致（needle_file.txt）と内容一致（data.txt の 2 行目）
        let names: Vec<_> = hits
            .iter()
            .filter(|h| h.kind == "name")
            .map(|h| &h.name)
            .collect();
        assert!(names.iter().any(|n| n.contains("needle_file.txt")));
        let content: Vec<_> = hits.iter().filter(|h| h.kind == "content").collect();
        assert_eq!(content.len(), 1);
        assert_eq!(content[0].line_no, Some(2));
        assert_eq!(content[0].line.as_deref(), Some("has NEEDLE inside"));
        // バイナリは内容走査されない
        assert!(!hits
            .iter()
            .any(|h| h.name == "bin.dat" && h.kind == "content"));
    }

    #[test]
    fn name_only_skips_content_scan() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("plain.txt"), b"needle inside body\n").unwrap();
        let opts = SearchOpts {
            search_content: false,
            ..Default::default()
        };
        // 本文一致は拾わない（ファイル名に needle が無いので 0 件）
        assert!(search_dir_impl(tmp.path(), "needle", &opts, &|| false).is_empty());
        // ファイル名一致は拾う
        assert!(!search_dir_impl(tmp.path(), "plain", &opts, &|| false).is_empty());
    }

    #[test]
    fn excluded_dirs_are_not_descended() {
        let tmp = tempfile::tempdir().unwrap();
        let nm = tmp.path().join("node_modules");
        fs::create_dir(&nm).unwrap();
        fs::write(nm.join("dep.txt"), b"needle in dep\n").unwrap();
        // node_modules の中身は内容検索されない
        let hits = search_dir_impl(tmp.path(), "needle", &SearchOpts::default(), &|| false);
        assert!(!hits.iter().any(|h| h.name == "dep.txt"));
        // ただし node_modules 自体は名前一致では見つかる
        let by_name = search_dir_impl(tmp.path(), "node_modules", &SearchOpts::default(), &|| {
            false
        });
        assert!(by_name.iter().any(|h| h.name == "node_modules"));
    }

    #[test]
    fn hidden_excluded_by_default_included_on_request() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        fs::write(root.join(".secret.txt"), b"needle\n").unwrap();

        let d = search_dir_impl(root, "needle", &SearchOpts::default(), &|| false);
        assert!(d.is_empty()); // 既定では隠しを除外

        let opts = SearchOpts {
            include_hidden: true,
            ..Default::default()
        };
        let h = search_dir_impl(root, "needle", &opts, &|| false);
        assert!(!h.is_empty());
    }

    #[test]
    fn empty_query_returns_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), b"x").unwrap();
        assert!(search_dir_impl(tmp.path(), "", &SearchOpts::default(), &|| false).is_empty());
    }

    #[test]
    fn cancelled_returns_early() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..10 {
            fs::write(tmp.path().join(format!("needle_{i}.txt")), b"x").unwrap();
        }
        // 常にキャンセル判定 → 1件も集めずに抜ける
        let got = search_dir_impl(tmp.path(), "needle", &SearchOpts::default(), &|| true);
        assert!(got.is_empty());
    }

    #[test]
    fn respects_max_results() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..10 {
            fs::write(tmp.path().join(format!("needle_{i}.txt")), b"x").unwrap();
        }
        let opts = SearchOpts {
            max_results: 3,
            ..Default::default()
        };
        assert_eq!(
            search_dir_impl(tmp.path(), "needle", &opts, &|| false).len(),
            3
        );
    }
}
