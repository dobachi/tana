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

🚧 **M1: MVP 実装中** — M0 完了。2ペインの実ファイル一覧 + hjkl ナビ、隠しファイル切替(Ctrl+H)、ペイン間コピー/移動(F5/F6)・削除(Delete=ゴミ箱 / Shift+Delete=完全削除)を**安全モードゲート + 上書き/削除確認付き**で実装済み。次: リネーム(F2)・新規フォルダ(F7)・お気に入り。

- [要求分析 (docs/REQUIREMENTS.md)](docs/REQUIREMENTS.md)
- [設計ドキュメント (docs/DESIGN.md)](docs/DESIGN.md)
- ロードマップ: **M0 雛形** → M1 MVP(2ペイン操作 / 安全モード / お気に入り) → M2(Places / タブ / セッション復元)→ …

## 開発

```bash
make doctor   # 前提条件チェック（Node / Rust / システム依存）
make setup    # 依存関係を一括インストール
make dev      # 開発モード起動（Tauri ネイティブ）
make build    # プロダクションビルド
make test     # 全テスト（Vitest + cargo test）
make check    # format + lint + test + build:frontend（CI向け）
```

> **テスト方針**: 機能の追加・変更には必ずテストを伴う。詳細は [CONTRIBUTING.md](CONTRIBUTING.md) を参照。

### Docker での動作確認（安全・隔離）

ホストを汚さずに動作確認できる隔離環境を用意しています（ホスト非マウント + 使い捨てサンドボックス + noVNC）。

```bash
make docker-gui    # GUI を起動 → ブラウザで http://localhost:6080/vnc.html
make docker-test   # ヘッドレスで全テスト
make docker-check  # lint + format + clippy + テスト（CI相当）
```

詳細は [docs/DOCKER.md](docs/DOCKER.md) を参照。

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
