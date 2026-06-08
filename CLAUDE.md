# Tana 開発ガイド（AI向け）

Tana(棚) は超軽量・ポータブルなクロスプラットフォーム ファイラ。Tauri v2 + Vanilla JS。

## 最重要方針: テストを必ず充実させる

- **機能の追加・変更には必ず対応するテストを追加/更新する。テストの無い変更は未完成。**
- ロジックは純粋関数に切り出してテスト可能にする（DOM/Tauri 依存と分離）。
- バグ修正は再発防止テストを先に書く。境界・異常系を含める。
- コミット/プッシュ前に `make test`(Vitest + cargo test)と `make check` を green にする。
- 詳細は [CONTRIBUTING.md](CONTRIBUTING.md)。

## ドキュメント

- 要求分析: `docs/REQUIREMENTS.md`（FR-xx / NFR-xx）
- 設計: `docs/DESIGN.md`
- 機能変更時はこれらも同期更新する。

## ビルド/テスト

```bash
make doctor / setup / dev / build / test / lint / format / check
```

## 規約

- フロント: Vanilla JS（ESLint + Prettier）。バックエンド: Rust（Clippy + cargo fmt）。
- コミットに AI 署名を付けない。
