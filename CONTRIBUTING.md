# コントリビューションガイド

## テスト方針(必須)

**テストの類は必ず充実させる。** これは Tana の開発における最優先の品質方針である。

### 原則

- **機能の追加・変更には、必ず対応するテストを追加/更新する。** テストの無い変更は未完成とみなす。
- **ロジックは純粋関数に切り出してテスト可能にする。** DOM や Tauri/OS に依存する部分と、判定・変換・計算のロジックを分離し、後者を単体テストする。
  - 例: `core/filepane.js` の `formatSize` / `clampCursor` / `isHidden` / `filterEntries`、Rust の `read_dir_entries` / `is_hidden_entry` / `parent_dir`。
- **バグ修正は再発防止テストを先に書く。** 失敗するテストで不具合を再現してから直す。
- **境界・異常系を必ず含める。** 空・最小・最大・不正値・存在しないパス等。
- **コミット/プッシュ前に `make test`(JS + Rust)と `make check` が green であること。**

### テスト基盤

| 対象 | ツール | 置き場所 |
|------|--------|----------|
| フロントエンド | Vitest + jsdom | `src/js/__tests__/` |
| バックエンド | cargo test | `src-tauri/src/lib.rs` の `#[cfg(test)]` |

### 新規モジュールのルール

- `src/js/core/` に新しいモジュールを追加したら、`src/js/__tests__/<name>.test.js` を必ず用意する。
- 新しい Tauri コマンドは、ロジックを純粋関数に分離して `#[cfg(test)]` でテストする(コマンド関数は薄いラッパーに保つ)。

## 開発フロー

```bash
make doctor   # 前提条件チェック
make setup    # 依存インストール
make dev      # 開発モード起動
make test     # 全テスト（Vitest + cargo test）
make check    # format + lint + test + build:frontend（コミット前に実行）
```

## コーディング規約

- フロントエンド: Vanilla JS、ESLint + Prettier 準拠。
- バックエンド: Rust、Clippy + cargo fmt 準拠。
- コミットに AI 署名を付けない。
