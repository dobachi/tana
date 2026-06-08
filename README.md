# Tana (棚)

> 超軽量・ポータブルなクロスプラットフォーム ファイラ

**Tana(棚)** は、ローカル・WSL・クラウド同期フォルダ(OneDrive / SharePoint / Box Drive 等)を横断して、軽快にファイルを扱うためのデスクトップファイラです。
書道テーマの軽量 Markdown エディタ [Fude(筆)](https://github.com/dobachi/fude) の姉妹プロジェクトであり、同じく **Tauri v2 + Vanilla JS** で構築します。

## 設計思想

- **軽量・高速起動**: Electron ではなく Tauri を採用。フレームワーク不使用の Vanilla JS で小バイナリ(~数MB)を目指す
- **ポータブル**: Windows / macOS / Linux を単一コードベースで対応
- **横断アクセス**: クラウド同期フォルダ・WSL を「場所(Places)」として自動検出し、特別な設定なしに閲覧
- **安全第一**: 起動時は**安全モード**(閲覧専用)。破壊的操作はモードを切り替えたときのみ可能
- **キーボードにもマウスにも優しい**: 全機能をキーボードから到達可能にしつつ、D&D・コンテキストメニューも提供
- **ミニマルデザイン**: 余計な装飾を排し、ファイルと操作に集中できる UI

## ステータス

🚧 **設計フェーズ** — 要求分析と設計を進行中。

- [要求分析 (docs/REQUIREMENTS.md)](docs/REQUIREMENTS.md)
- [設計ドキュメント (docs/DESIGN.md)](docs/DESIGN.md)

## 技術スタック(予定)

| 領域 | 採用技術 |
|------|----------|
| アプリ基盤 | Tauri v2 (Rust) |
| フロントエンド | Vanilla JS (フレームワーク不使用) |
| バンドラー | esbuild |
| テスト | Vitest + jsdom (JS) / cargo test (Rust) |
| Lint / Format | ESLint + Prettier / Clippy + cargo fmt |

## ライセンス

Apache-2.0
