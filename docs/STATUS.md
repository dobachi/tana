# Tana (棚) - 開発ステータス / 引き継ぎメモ

> このドキュメントは「別マシン・別セッションで開発を継続する」ための単一の入口です。
> リポジトリの現在地・コードマップ・決定事項・次の一手をまとめています。
> 機能の追加・変更時は **このファイルも更新** してください（特に「実装ステータス」「次の一手」）。

- **スナップショット日**: 2026-06-13
- **基準コミット**: `053475b feat: お気に入りサイドバーのキーボードフォーカス (Ctrl+B)`（`origin/main` と同期済み）
- **現在のフェーズ**: **M1 (MVP) ほぼ完了** → 仕上げ → M2 着手前

関連: [README](../README.md) / [要求分析](REQUIREMENTS.md) / [設計](DESIGN.md) / [Docker動作確認](DOCKER.md) / [コントリビューション](../CONTRIBUTING.md)

---

## 1. 別マシンで継続するには（クイックスタート）

```bash
# 1. クローン
git clone git@github.com:dobachi/tana.git
cd tana

# 2. 前提条件チェック（Node / npm / cargo / Linuxはaptパッケージ）
make doctor
#   Rust 未導入なら: make install-rust  → source "$HOME/.cargo/env"
#   Linux で apt パッケージ不足の場合は doctor が sudo apt-get コマンドを提示する

# 3. 依存インストール（npm install + cargo build）
make setup

# 4. 起動 / テスト
make dev      # Tauri ネイティブで開発起動
make test     # Vitest + cargo test
make check    # format-check + lint + test + build:frontend（コミット前ゲート）
```

WSL / GUI が無い環境では、ホストを汚さない Docker 隔離環境で動作確認できる（[docs/DOCKER.md](DOCKER.md)）。

```bash
make docker-gui    # noVNC GUI → http://localhost:6080/vnc.html
make docker-test   # ヘッドレス全テスト
make docker-check  # CI相当チェック
```

> **Docker 注意**: イメージはソースを COPY する自己完結型。コード変更は `make docker-build`（または `docker-gui`/`docker-test` が依存で再ビルド）しないと反映されない。ライブリロード無し。

### 最初に読むべきもの
1. このファイル（現在地と次の一手）
2. [REQUIREMENTS.md](REQUIREMENTS.md)（何を作るか・FR/NFR・未決事項）
3. [DESIGN.md](DESIGN.md)（どう作るか・レイヤ・キーバインド）。ただし §2.2 のファイル一覧は**目標形**で、現状は下記「3. コードマップ」が真実源。
4. [CONTRIBUTING.md](../CONTRIBUTING.md)（テスト必須方針）

---

## 2. 品質ゲートの状態

| 項目 | 状態（2026-07-18 実測） |
|------|------|
| Vitest (JS) | ✅ 213 passed / 19 files |
| cargo test (Rust) | ✅ 13 passed |
| ESLint / Clippy | ✅ クリーン |
| Prettier / cargo fmt | ✅ クリーン |

**方針（[CONTRIBUTING.md](../CONTRIBUTING.md)）**: テストの無い変更は未完成。ロジックは純粋関数に切り出し、DOM/Tauri 非依存で単体テストする。コミット/プッシュ前に `make check` が green であること。

---

## 3. コードマップ（現状の実体）

> DESIGN.md §2.2 は将来の理想構成（`pane.js`/`places.rs`/`features/` 等）を記述しているが、**現状は以下が実体**。新規モジュールを切るときに DESIGN.md 側へ寄せていく。

### フロントエンド `src/js/`
| ファイル | 役割 |
|----------|------|
| `app.js` | メインオーケストレーター。初期化・キーバインド（`onKeydown`）・各モジュールの結線 |
| `backend.js` | Tauri `invoke` の抽象化 |
| `core/safemode.js` | 安全/操作モードの状態・切替・操作可否判定（破壊操作のゲート、真実源） |
| `core/panes.js` | 2ペイン管理・アクティブペイン・ペイン間操作（`PANE`定数） |
| `core/filepane.js` | 1ペインの一覧・選択・カーソル。純粋関数 `formatSize`/`clampCursor`/`isHidden`/`filterEntries` |
| `core/fileops.js` | コピー/移動/削除/リネーム/新規（安全モードでゲート） |
| `core/conflictdialog.js` | 同名衝突時の3択（名前変更=任意入力/上書き/キャンセル） |
| `core/inputdialog.js` | 汎用入力ダイアログ（リネーム・新規フォルダ名） |
| `core/favorites.js` | ネスト可能お気に入りツリー + 検索 + 永続化（localStorage） |
| `core/favoritesview.js` | お気に入りサイドバーUI（ツリー/追加/削除/ナビ/検索/Ctrl+B フォーカス） |
| `core/theme.js` | テーマ（ダーク/ライト等）切替と永続化 |
| `core/fontscale.js` | 文字サイズ（Ctrl + / - / 0） |
| `core/help.js` | ショートカット一覧ヘルプ（`?` / `F1`） |
| `core/toast.js` | トースト通知 |
| `core/selection.js` | 複数選択のロジック（選択はパスの Set）。純粋関数のみ |
| `core/updater.js` | 起動時の更新検知 + 手動チェック。純粋関数 `describeManualCheck` で判定だけを切り出し |
| `core/menu.js` | 汎用ドロップダウン/コンテキストメニュー（Fude から移植） |
| `core/menubar.js` | メニューバー（Ctrl+Shift+B で開閉・既定は非表示・永続化） |
| `core/settings.js` | 設定画面（テーマ/文字サイズ/隠しファイル）。即時反映・即時保存で Save ボタンは無し |
| `core/pathnav.js` | パス直接入力/ブレッドクラムの純粋ロジック（`resolveInputPath` / `pathSegments`）|
| `core/menu.js` / `core/menubar.js` | メニューバーと右クリックメニュー（Fude から移植）|

テストは `src/js/__tests__/<name>.test.js` に対応（17ファイル）。

### バックエンド `src-tauri/src/`
`lib.rs` に集約（まだ `fs.rs`/`places.rs` 等に分割していない）。`main.rs` は薄いエントリ。

- Tauri コマンド: `list_dir` / `home_dir` / `parent_dir` / `unique_name` / `copy_path` / `move_path` / `delete_to_trash` / `delete_permanent` / `rename_path` / `make_dir`
- テスト対象の純粋関数: `is_hidden_entry` / `read_dir_entries` / `target_path` / `unique_target_name` / `copy_recursive` / `remove_any`
- 依存は最小（tauri / tauri-cli / plugin-dialog / opener / updater / process / serde / dirs）

---

## 4. 実装ステータス（要求別）

凡例: ✅ 実装済 / 🟡 部分 / ⬜ 未着手

### 機能要求 (FR)
| ID | 要求 | 優先 | 状態 | 備考 |
|----|------|:----:|:----:|------|
| FR-01 | 2ペイン表示 | M | ✅ | 実ファイル一覧・hjkl ナビ |
| FR-02 | ペイン間コピー/移動 | M | 🟡 | F5/F6 実装済（複数選択に対応）。D&D は未 |
| FR-03 | 削除・リネーム・新規フォルダ | M | ✅ | Delete/Shift+Delete・F2・F7。安全モードゲート |
| FR-04 | 安全/操作モード切替 | M | ✅ | Ctrl+Shift+Space トグル + 視覚表示 |
| FR-05 | お気に入り（ネスト） | M | ✅ | ツリー・Ctrl+D 追加・localStorage |
| FR-06 | お気に入り検索 | M | ✅ | インクリメンタル検索 |
| FR-07 | 場所(Places)検出 | S | ⬜ | **M2**。OneDrive/Box/WSL/標準フォルダ |
| FR-08 | タブ | S | ⬜ | **M2**。ペイン単位が有力(Q3) |
| FR-09 | 多形式プレビュー | S | ✅ | 画像/テキスト/Markdown/メタ + 配置(右/下)/Ctrl+P。Markdownは markdown-it を遅延チャンク化(html:false)+CSP。詳細設計: [PREVIEW.md](PREVIEW.md) |
| FR-10 | 全機能キーボード到達 | M | 🟡 | 主要操作は到達可。網羅性は要点検 |
| FR-11 | マウス操作（D&D/右クリック/複数選択） | M | 🟡 | 右クリックメニュー・ブレッドクラム移動・複数選択は実装済み。D&D は未 |
| FR-12 | パス入力/パンくず | S | ✅ | Ctrl+L で入力、ヘッダはブレッドクラム |
| FR-13 | コンテキストメニュー + 外部アプリ連携 | M | ✅ | 右クリック / Shift+F10。外部アプリ・ファイルマネージャ表示は opener |
| FR-14 | セッション復元 | M/S | 🟡 | ディレクトリ・アクティブペインを localStorage で復元(core/session.js)。タブ込みは FR-08 と同時に M2 |
| FR-15 | 隠しファイル表示トグル | M | ✅ | Ctrl+H、両ペイン共通 |

### 非機能 (NFR) 抜粋
| 項目 | 状態 | 備考 |
|------|:----:|------|
| NFR-U3 安全モード視覚表示 | ✅ | バッジ表示 |
| NFR-U4 テーマ | ✅ | theme.js |
| NFR-U5 文字サイズ | ✅ | fontscale.js (Ctrl ± 0) |
| NFR-U6 ヘルプ | ✅ | help.js (? / F1) |
| NFR-R1 破壊操作のゲート | ✅ | safemode.js を真実源にロジック層でゲート |

> **注意**: M1 を「完了」と宣言する前に FR-02/FR-11 の D&D、FR-14(セッション復元) の扱いを確定すること（下記「次の一手」参照）。

---

## 5. 決定事項と未決事項

### 解決済み
- **Q1 安全モードキー**: `Ctrl+Shift+Space`（トグル + 視覚表示）。`hjkl` 移動も v1 採用。
- **Q6 フォーカス移動**: `Tab`=ペイン往復 / `Ctrl+B`=サイドバー / `Ctrl+Alt+h,l`=空間移動。

### 未決（次に潰すもの）
- **Q4 お気に入り保存形式・場所**: 暫定 localStorage で動作中。Fude に倣い JSON をアプリ設定ディレクトリに移すか要決定（永続化方式の確定が M2 のセッション復元(FR-14)と関わる）。
- Q2 プレビュー初期形式 / Q3 タブ単位 / Q5 配布形態 / Q7 外部アプリ連携の設定UI — いずれも M2 以降。

---

## 6. 既知の課題 / 進行中

- **D&D 未実装**（FR-02/FR-11）。複数選択は実装済みだが、ドラッグでのコピー/移動は未対応。
- **セッション復元**（FR-14）: ディレクトリ・アクティブペインは復元対応済み（core/session.js）。タブ構成の復元はタブ(FR-08)実装時に対応。
- WSLg 等での日本語入力・GUI は Fude 同様に注意が必要 → Docker GUI で確認するのが安全。

---

## 7. 次の一手（着手順の推奨）

1. **M1 完了判定の確定**: FR-02(D&D) / FR-11(マウス) / FR-13(コンテキストメニュー) / FR-14(セッション復元・ディレクトリ/ペイン) のうち、どこまでを M1 に含めるかを REQUIREMENTS/README と突き合わせて決める。
2. **FR-14 基本**（ディレクトリ・ペイン状態のセッション復元）の実装。Fude の `session.js` を踏襲。Q4 の永続化方式（localStorage → 設定ディレクトリJSON）も合わせて決める。
3. **FR-13 コンテキストメニュー + 外部アプリ連携**（`opener` 利用、キーボードからも起動可）。
4. M2 着手: **FR-07 Places 検出**（OS別、`places` モジュール新設 + Rust 側 `places.rs` 切り出し）→ **FR-08 タブ** → **FR-12 パス入力/パンくず**。
5. モジュールを増やすたびに `__tests__` と Rust `#[cfg(test)]` を追加し、`make check` を green に保つ。コードを増やすにつれ DESIGN.md §2.2 の目標構成へ寄せる。

### バックログ（設計検討済み・未着手）
- **詳細表示＆ソート**（列表示: 名前/サイズ/更新日時、列ヘッダクリック＆キーボードでソート）: 設計・ベストプラクティス調査は [DETAIL-VIEW-SORT.md](DETAIL-VIEW-SORT.md)。要点は `core/sort.js`(純粋・Intl.Collator 自然順・フォルダ先頭・安定ソート) + 列ヘッダ▲▼ + `s` プレフィックスのキーボードソート + 表示メニュー。

---

## 8. 更新ルール

- 機能をマージしたら本ファイルの **§2 品質ゲート**・**§4 実装ステータス**・**§7 次の一手** を更新する。
- 大きな設計判断をしたら **§5 決定事項** に反映し、必要なら DESIGN.md / REQUIREMENTS.md と同期する。
- 「スナップショット日」「基準コミット」も更新する。
