# Tana (棚) - 開発ステータス / 引き継ぎメモ

> このドキュメントは「別マシン・別セッションで開発を継続する」ための単一の入口です。
> リポジトリの現在地・コードマップ・決定事項・次の一手をまとめています。
> 機能の追加・変更時は **このファイルも更新** してください（特に「実装ステータス」「次の一手」）。

- **スナップショット日**: 2026-07-27
- **基準コミット**: `c722d03`（`origin/main` と同期済み）。FR-10 キーボード到達性の仕上げ済み
- **現在のフェーズ**: **M1 (MVP) 完了** ✅（FR-10 点検・D&D ネイティブ実機確認とも完了）→ **M2 着手**

関連: [README](../README.md) / [要求分析](REQUIREMENTS.md) / [設計](DESIGN.md) / [プレビュー](PREVIEW.md) / [ドラッグ＆ドロップ](DRAG-AND-DROP.md) / [詳細表示＆ソート](DETAIL-VIEW-SORT.md) / [Docker動作確認](DOCKER.md) / [コントリビューション](../CONTRIBUTING.md)

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

| 項目 | 状態（2026-07-27 実測） |
|------|------|
| Vitest (JS) | ✅ 441 passed / 35 files |
| cargo test (Rust) | ✅ 21 passed（D&D は JS 側のみで Rust は無変更） |
| ESLint | ✅ クリーン |
| Prettier | ✅ クリーン |
| build:frontend | ✅ 成功（成果物に新ロジックが含まれることを確認） |

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
| `core/clipboard.js` | **ファイルクリップボードの状態（純粋）**。Ctrl+C=copy / Ctrl+X=move を登録し Ctrl+V で現在地へ貼り付け。エントリ配列＋操作種別を保持。実操作は fileOps、貼付先決定は app.js |
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
| `core/menu-nav.js` | メニュー内のキーボード移動 |
| `core/session.js` | セッション復元 (FR-14)。ディレクトリ・アクティブペイン |
| `core/sort.js` / `core/sortstate.js` | 並び替えの純粋ロジックと共有状態（Intl.Collator 自然順・フォルダ先頭） |
| `core/preview.js` / `previewkind.js` / `previewplacement.js` | プレビュー (FR-09)。種別判定・配置は純粋関数に分離。詳細: [PREVIEW.md](PREVIEW.md) |
| `core/dnd.js` | **D&D の判定（純粋）**。掴んだ対象・効果(copy/move)・不正ドロップの拒否。詳細: [DRAG-AND-DROP.md](DRAG-AND-DROP.md) |
| `core/dragdrop.js` | **D&D の追跡（DOM）**。ポインタイベントで自作。`resolveDropTarget` は将来の OS ドロップでも再利用する。安全モードは拒否ゴースト＋トーストで示す |
| `core/editmenu.js` | **メニューバー「編集」の項目（純粋）**。対象・宛先の有無で無効化を判定。app.js が状態と action を注入 |

テストは `src/js/__tests__/<name>.test.js` に対応（35ファイル）。

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
| FR-02 | ペイン間コピー/移動 | M | ✅ | F5/F6（複数選択対応）＋ D&D。既定コピー / Shift で移動。加えて Ctrl+C/Ctrl+X→Ctrl+V のファイルクリップボードで任意の現在地へ貼り付け可（core/clipboard.js） |
| FR-03 | 削除・リネーム・新規フォルダ | M | ✅ | Delete/Shift+Delete・F2・F7。安全モードゲート |
| FR-04 | 安全/操作モード切替 | M | ✅ | Ctrl+Shift+Space トグル + 視覚表示 |
| FR-05 | お気に入り（ネスト） | M | ✅ | ツリー・Ctrl+D 追加・localStorage |
| FR-06 | お気に入り検索 | M | ✅ | インクリメンタル検索 |
| FR-07 | 場所(Places)検出 | S | ⬜ | **M2**。OneDrive/Box/WSL/標準フォルダ |
| FR-08 | タブ | S | ⬜ | **M2**。ペイン単位が有力(Q3) |
| FR-09 | 多形式プレビュー | S | ✅ | 画像/テキスト/Markdown/メタ + 配置(右/下)/Ctrl+P。Markdownは markdown-it を遅延チャンク化(html:false)+CSP。詳細設計: [PREVIEW.md](PREVIEW.md) |
| FR-10 | 全機能キーボード到達 | M | ✅ | 網羅性点検を実施（2026-07-27）。コンテキストメニューを `Shift+F10`/`≣` で開いたとき先頭項目へフォーカスする（マウスと同じ即操作性）。同メニュー専用の「ファイルマネージャで表示・パス/名前コピー」の開き方をヘルプに明記。「同ペイン内フォルダへのドロップ」相当は Ctrl+C/Ctrl+X→Ctrl+V のファイルクリップボード（任意の現在地へ貼付）でキーボードからも到達可能にした。全機能キーボード到達を達成 |
| FR-11 | マウス操作（D&D/右クリック/複数選択） | M | ✅ | 右クリックメニュー・ブレッドクラム移動・複数選択・D&D。お気に入りへのドロップは段階2。D&D 実装時に「右クリックで複数選択が畳まれる」既存バグも修正 |
| FR-12 | パス入力/パンくず | S | ✅ | Ctrl+L で入力、ヘッダはブレッドクラム |
| FR-13 | コンテキストメニュー + 外部アプリ連携 | M | ✅ | 右クリック / Shift+F10。外部アプリ・ファイルマネージャ表示は opener。ファイルのダブルクリック / Enter で既定アプリを開く |
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

> **M1 完了（2026-07-27）**: 優先度 **M** の FR はすべて達成。FR-10 の点検も、D&D の `Shift`+ドロップ（移動）のネイティブ実機確認も完了した。以降は M2（FR-07 Places / FR-08 タブ）へ。

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

- ~~**D&D の `Shift`+ドロップ（移動）が実機未確認**~~ ✅ **ネイティブ実機で確認済み（2026-07-27）**。noVNC 越しでは修飾キーが届かず検証できなかったが、`make dev` 起動での目視で `Shift`+ドロップが移動になること・フォルダ行への吸い込み・複数選択のドラッグを確認した（判定ロジックは単体テスト済み）。
- **ファイルクリップボード Ctrl+C / Ctrl+X → Ctrl+V を実装（2026-07-27）**。F5/F6 が「反対ペイン固定」なのに対し、任意の現在地（同ペイン内サブフォルダ・お気に入り先を含む）へ貼り付けられる汎用経路。これにより「同ペイン内フォルダへのドロップ」相当をキーボードでも汎用的にカバー。登録（コピー/切り取り）は非破壊なので安全モードでも可、貼り付けの実操作のみ fileOps 側で安全モードにゲートされる。状態は純粋モジュール `core/clipboard.js`。
- **お気に入りサイドバーへのドロップは未対応**（D&D 段階2）。当たり判定が `favoritesview.js` 側で別物になるため分離した。
- **OS → Tana のネイティブドロップは未実装**。`dragDropEnabled` を既定 `true` のままにしたので道は開いている。`core/dragdrop.js` の `resolveDropTarget` に `onDragDropEvent` を繋ぐだけで足せる見込み。
- **セッション復元**（FR-14）: ディレクトリ・アクティブペインは復元対応済み（core/session.js）。タブ構成の復元はタブ(FR-08)実装時に対応。
- WSLg 等での日本語入力・GUI は Fude 同様に注意が必要 → Docker GUI で確認するのが安全。

---

## 7. 次の一手（着手順の推奨）

1. ~~**FR-10 キーボード到達性の点検**~~ ✅ 完了（2026-07-27）。全操作を棚卸しし、(a) キーボードで開いたコンテキストメニューの先頭フォーカス、(b) メニュー専用操作のヘルプ明記、(c) ファイルクリップボード Ctrl+C/Ctrl+X→Ctrl+V（任意の現在地へ貼付）の追加で抜けを埋めた。「同ペイン内フォルダへのドロップ」相当もキーボードから到達可能になった。
2. ~~**D&D のネイティブ実機確認**~~ ✅ 完了（2026-07-27）。`make dev` 起動で `Shift`+ドロップ＝移動・フォルダ行への吸い込み・複数選択ドラッグを目視確認。
3. ~~**M1 完了の宣言**~~ ✅ **M1 完了（2026-07-27）**。優先度 M の FR/NFR は達成。
4. **M2 着手（次の主軸）**: **FR-07 Places 検出**（OS別、`places` モジュール新設 + Rust 側 `places.rs` 切り出し）→ **FR-08 タブ**。Q4（お気に入りの永続化を localStorage から設定ディレクトリJSONへ移すか）はタブのセッション復元と絡むのでここで決める。
5. モジュールを増やすたびに `__tests__` と Rust `#[cfg(test)]` を追加し、`make check` を green に保つ。コードを増やすにつれ DESIGN.md §2.2 の目標構成へ寄せる。

### バックログ（設計検討済み・未着手）
- **お気に入りサイドバーへのドロップ**（D&D 段階2）: [DRAG-AND-DROP.md](DRAG-AND-DROP.md) §3。`resolveDropTarget` に `.fav-item` の当たり判定を足す。
- **OS → Tana のネイティブドロップ**: 同 §2/§3。`onDragDropEvent` を購読して `resolveDropTarget` に流す。座標はデバッガを開いていると不正確になる既知の制限あり。

---

## 8. 更新ルール

- 機能をマージしたら本ファイルの **§2 品質ゲート**・**§4 実装ステータス**・**§7 次の一手** を更新する。
- 大きな設計判断をしたら **§5 決定事項** に反映し、必要なら DESIGN.md / REQUIREMENTS.md と同期する。
- 「スナップショット日」「基準コミット」も更新する。
