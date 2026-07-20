# Tana (棚) - プレビュー機能 設計ドキュメント (FR-09)

> 最終更新: 2026-07-20
> ステータス: ドラフト(未実装)
> 親ドキュメント: [DESIGN.md §3.6](DESIGN.md) / 要求: [REQUIREMENTS.md](REQUIREMENTS.md) FR-09, Q2

---

## 1. 位置づけとスコープ

FR-09「多形式プレビュー」は **Should**。ゴール G4「お気に入り・プレビューで『探す・確認する』コストを下げる」に紐づき、主にペルソナ P2(ナレッジワーカー)が対象。

本書は DESIGN.md §3.6 の3行を実装可能な粒度まで具体化したもの。**段階拡張が前提**であり、本書は v1 で何を入れ、何を意図的に外すかまでを含む。

### 現状(2026-07-20)

- `src/` / `src-tauri/src/` にプレビュー関連コードは**0件**。完全な新規実装
- `tauri.conf.json` の `assetProtocol` は `enable: true` / `scope: ["**"]` → 画像は `convertFileSrc()` で**設定変更なしに表示可能**
- 一方 `tauri.conf.json` に **`csp` キーが無く CSP 未設定**。§9 の通り、これはプレビュー実装の前提工事として塞ぐ
- バックエンドにファイル内容を読むコマンドは無い(`list_dir` 系10コマンドのみ) → §6 で新設

---

## 2. 設計原則

| # | 原則 | 理由 |
|---|---|---|
| PV-1 | 判定・整形ロジックは純粋関数に切り出す | 既存の `selection.js` / `pathnav.js` と同じ流儀。テスト容易性(プロジェクト方針) |
| PV-2 | レンダラは動的 `import()` で遅延ロード | NFR-P2(数MBバイナリ)。markdown-it を常時バンドルすると軽量性が即座に削れる |
| PV-3 | ファイル内容は**必ず上限付き**で読む | ファイラは 4GB のログにカーソルを合わせる。上限なしの読み取り口を作らない |
| PV-4 | 既定はオフ、開いている間だけ追従 | 起動時間(NFR-P1)と、使わないユーザーへのコストゼロ |
| PV-5 | 未対応形式でも「必ず何か出す」 | ペインが空白になる瞬間を消す。体感品質に直結 |
| PV-6 | プレビューは読み取り専用。安全モードで常に許可 | REQUIREMENTS.md §5(安全モードで許可する操作にプレビューを明記) |

---

## 3. アーキテクチャ

### 3.1 モジュール構成

```
src/js/
  core/
    previewkind.js      種別判定・上限判断(純粋関数のみ。常時ロード, 軽量)
    previewplacement.js 配置(right/bottom)の真実源 + 永続化
    preview.js          プレビュー コントローラ(createPreview(deps))
  features/preview/     ← 動的 import される。ここに重量物を置く
    image.js            画像レンダラ(asset protocol)
    text.js             プレーンテキスト レンダラ
    markdown.js         Markdown レンダラ(markdown-it + サニタイズ)
    meta.js             メタ情報カード(未対応形式・ディレクトリ・エラー時)

src-tauri/src/
    lib.rs              read_preview コマンド + 純粋ヘルパ(将来 preview.rs へ分離)
```

`core/preview.js` は既存の DI 流儀に合わせる(`createFileOps(deps)` と同型):

```js
createPreview({
  backend,        // { readPreview(path, maxBytes) }
  convertSrc,     // (path) => string   asset protocol 変換(テストではスタブ)
  doc,            // document(既定は globalThis.document)
  getPlacement,   // () => 'right' | 'bottom'
  now,            // () => number   デバウンス制御をテストから操作するため注入
})
// → { setTarget(entry|null), open(), close(), isOpen(), toggle(), destroy() }
```

Tauri にも DOM 実体にも直接依存しない。`app.js` が実物を注入する。

### 3.2 データフロー

```
filepane カーソル移動 / 選択変更
        │  onChange(entry)
        ▼
app.js ──► preview.setTarget(entry)
        │
        ├─ 閉じていれば即 return(何も読まない)          … PV-4
        │
        ├─ デバウンス(既定 150ms) + 世代トークン採番     … §7
        ▼
   previewkind.detectKind(entry)          … 拡張子による一次判定(純粋)
        │
        ├─ dir / 上限超過 / 明らかな非対応 → meta.js だけで完結(I/O なし)
        │
        ├─ image / pdf → convertFileSrc(path) を <img>/<embed> へ   (バイト列を JS に持ち込まない)
        │
        └─ text / markdown / 不明
                ▼
           backend.readPreview(path, maxBytes)      … Rust, 上限付き
                ▼
           detectKind(entry, data.sniff) で二次判定  … マジックナンバー併用(純粋)
                ▼
           世代トークン照合 ──不一致──► 破棄(描画しない)     … §7
                ▼
           await import('../features/preview/<kind>.js')   … PV-2
                ▼
           renderer.render(container, data)
```

---

## 4. 種別判定 (`core/previewkind.js`)

拡張子だけで判定しない。ファイラは**拡張子が嘘をつくファイル**(`.txt` の実体が巨大バイナリ、拡張子なしのスクリプト、`.log` という名の 2GB)に日常的に出会うため、拡張子で一次判定 → 先頭バイトのマジックナンバーで二次判定という二段構えにする。

```js
export const KIND = {
  DIR: 'dir', IMAGE: 'image', TEXT: 'text', MARKDOWN: 'markdown',
  PDF: 'pdf', BINARY: 'binary', TOO_LARGE: 'too-large', EMPTY: 'empty',
};

/** 一次判定(拡張子 + is_dir + size)。sniff があれば二次判定まで行う。 */
export function detectKind(entry, sniff /* Uint8Array | null */, limits = LIMITS): string

/** 種別ごとの読み取り上限。0 は「本文を読まない」を意味する。 */
export function maxBytesFor(kind, limits = LIMITS): number

/** 先頭バイト列からの判定。テキスト性は NUL バイトと制御文字比率で判断。 */
export function sniffKind(bytes /* Uint8Array */): string | null
```

**判定規則**

| 条件 | 結果 |
|---|---|
| `entry.is_dir` | `DIR` — 中身の件数だけ出す(I/O は `list_dir` 1回、任意) |
| `entry.size === 0` | `EMPTY` |
| `entry.size > limits.maxPreviewBytes`(既定 32MB) かつ 画像/PDF でない | `TOO_LARGE` |
| 拡張子が `png/jpg/jpeg/gif/webp/bmp/ico/avif` | `IMAGE` |
| 拡張子が `svg` | `IMAGE`(ただし **sandbox iframe 経由**。§9) |
| 拡張子が `md/markdown/mdx` | `MARKDOWN` |
| 拡張子が `pdf` | `PDF`(v2 以降。v1 は `BINARY` 扱い) |
| sniff で NUL バイトを含む / 非テキスト率が閾値超 | `BINARY`(拡張子が `.txt` でもこちらを優先) |
| それ以外で sniff がテキスト | `TEXT` |
| 判定不能 | `BINARY` |

`BINARY` / `TOO_LARGE` / `EMPTY` / `DIR` はすべて `meta.js` が受け持つ(PV-5)。

**上限の既定値**

| 定数 | 既定 | 意図 |
|---|---|---|
| `sniffBytes` | 4 KB | 種別判定用の先頭読み |
| `maxTextBytes` | 256 KB | テキスト/Markdown 本文の読み取り上限。超過分は切り詰めて明示 |
| `maxPreviewBytes` | 32 MB | これを超えたら本文を読まずメタ表示 |
| `debounceMs` | 150 | §7 |

---

## 5. 配置とレイアウト

DESIGN.md §3.6 の通り「2ペインの右」/「2ペインの下」を切替。CSS Grid のテンプレート差し替えで実現する。

現状 `src/style.css:384-388`:

```css
#workspace { display: grid; grid-template-columns: 1fr 1px 1fr; }
```

プレビューは `#workspace` の外、`#app` 側に領域を追加する(ペイン分割の入れ子を増やさないため):

```css
/* 既定(プレビュー閉) */
#app { grid-template-areas: 'menubar menubar' 'sidebar workspace' 'statusbar statusbar'; }

/* 右配置 */
#app[data-preview='right'] {
  grid-template-columns: 220px 1fr 6px minmax(240px, 32%);
  grid-template-areas:
    'menubar   menubar   menubar   menubar'
    'sidebar   workspace pvdivider preview'
    'statusbar statusbar statusbar statusbar';
}

/* 下配置 */
#app[data-preview='bottom'] {
  grid-template-rows: auto 1fr 6px minmax(160px, 32%) 26px;
  grid-template-areas:
    'menubar   menubar'
    'sidebar   workspace'
    'sidebar   pvdivider'
    'sidebar   preview'
    'statusbar statusbar';
}
```

- `#app` の `data-preview` 属性が状態表現(既存の `data-theme` / `data-mode` と同じ流儀)。閉時は属性なし
- 分割サイズはドラッグで可変。比率を永続化(§10)
- 配置の真実源は `core/previewplacement.js`。`theme.js` / `fontscale.js` と同型の `{get, set, toggle, subscribe}` + localStorage

---

## 6. バックエンド API (`read_preview`)

汎用の `read_file` は**作らない**。上限なしの読み取り口を一度開けると以後どこからでも巨大ファイルを引けてしまうため、用途を限定した1コマンドに閉じる(PV-3)。

```rust
#[derive(serde::Serialize)]
pub struct PreviewData {
    pub kind: String,        // "text" | "binary" | "empty"  (Rust 側の粗い判定)
    pub size: u64,           // ファイル全体のバイト数
    pub read_bytes: usize,   // 実際に読んだバイト数
    pub truncated: bool,     // size > read_bytes
    pub encoding: String,    // "utf-8" | "utf-8-lossy" | "binary"
    pub text: Option<String>,// テキストと判定できた場合のみ。常に valid UTF-8
    pub sniff: Vec<u8>,      // 先頭最大 16 バイト(フロントの二次判定用)
}

#[tauri::command]
fn read_preview(path: String, max_bytes: usize) -> Result<PreviewData, String>
```

**設計上のポイント**

- **バイト列を JS に渡さない**。UTF-8 判定・不正バイト処理・行数切り詰めは Rust 側で済ませ、JS には安全な文字列だけ渡す。`sniff` の 16 バイトのみ例外
- `max_bytes` はフロント指定値を Rust 側でも**再クランプ**する(`clamp_max_bytes`)。フロントの値を信用しない
- 画像・PDF はこのコマンドを通さない。`convertFileSrc()` で asset protocol に任せる
- シンボリックリンク・特殊ファイル(FIFO 等)は読まずにエラーを返す。FIFO を読むとブロックする
- 巨大ファイルでも `File::take(max_bytes)` で先頭のみ読む。`fs::read` は使わない

**純粋関数として切り出しテストする単位**(既存 `target_path` / `unique_target_name` と同じ流儀):

| 関数 | 内容 |
|---|---|
| `clamp_max_bytes(n) -> usize` | 上限クランプ |
| `classify_head(&[u8]) -> HeadKind` | NUL/制御文字比率によるテキスト判定 |
| `decode_text(&[u8]) -> (String, &'static str)` | UTF-8 / lossy デコードと BOM 除去 |
| `truncate_at_char_boundary(&[u8], n)` | マルチバイト文字の途中で切らない |

`truncate_at_char_boundary` は特に重要で、256KB 境界が UTF-8 の 3 バイト文字の途中に落ちるケースは日本語テキストで日常的に起きる。

**`DirEntry` の小拡張**: メタ情報カード(§8)で更新日時を出すため `modified: Option<u64>`(epoch 秒)を追加する。既存フィールドは変更しない。

---

## 7. カーソル追従の制御 ★核心

プレビュー機能で**最も壊れやすいのはここ**。Tana は `j`/`k` でカーソルが高速に動くため、素朴に「カーソル変化 → 読み込み」を繋ぐと:

1. 100 件を走査する間に 100 回の I/O が走る
2. 完了順が前後し、**古いプレビューが最新の選択を上書きする**(遅い巨大ファイルが後から届く)

対策を最初から設計に入れる。

### 7.1 デバウンス

`setTarget()` は即座に読まず、`debounceMs`(既定 150ms)後に発火。カーソルが止まってから読む。連打中は保留中タイマをキャンセルし続ける。

ただし**プレースホルダの更新は即時**に行う(ファイル名とサイズだけ先に出す)。ここを遅らせると「反応がない」体感になる。

### 7.2 世代トークン

```js
let generation = 0;
async function load(entry) {
  const gen = ++generation;
  const data = await backend.readPreview(entry.path, maxBytes);
  if (gen !== generation) return;   // 追い越された。破棄する
  render(data);
}
```

`await` を挟むすべての境界(`readPreview` の後、動的 `import()` の後)で照合する。動的 import は初回のみ遅いので、ここの照合を忘れると初回だけ古い内容が出る、という再現しにくいバグになる。

### 7.3 その他

- **プレビューを閉じている間は `setTarget` を記録するだけで I/O しない**(PV-4)。開いた瞬間に最後の対象を読む
- 同一パスへの再 `setTarget` は無視(同じディレクトリ内での選択トグル等で無駄に再読しない)
- 直近 N 件(既定 8)の描画結果を LRU でキャッシュし、`j` → `k` の往復で再読しない。キャッシュキーは `path + size`(内容変化の簡易検出)
- レンダラのモジュール自体は一度 import したら保持する

---

## 8. レンダラ

| レンダラ | 対象 | 実装 |
|---|---|---|
| `image.js` | 画像 | `<img src={convertFileSrc(path)}>`。等倍 / フィット切替、寸法をステータス表示。SVG は §9 の通り sandbox iframe |
| `text.js` | プレーンテキスト | `textContent` に流すだけ(`innerHTML` は使わない)。行番号なし。切り詰め時は末尾に「先頭 256KB のみ表示」バナー |
| `markdown.js` | Markdown | markdown-it。**HTML 無効 + サニタイズ**(§9)。相対パス画像は `convertFileSrc` で解決 |
| `meta.js` | ディレクトリ / 未対応 / 上限超過 / エラー | 名前・種別・サイズ・更新日時・パスのカード表示 |

`meta.js` は最軽量なので `features/preview/` 内でも最初に import される。これが PV-5(必ず何か出す)を担保する。

### Fude からの流用方針

Fude の Markdown パイプライン(markdown-it 周り)は流用価値があるが、**PlantUML / Mermaid 等の図式レンダリングは v1 では持ち込まない**。あちらは iframe の実サイズ計測(`getBBox`)や base href の扱いに相当な複雑さを抱えており、ファイラの「ちら見」用途に対して重すぎる(NFR-P2 にも反する)。

---

## 9. セキュリティ ★前提工事

**CSP 未設定のまま Markdown プレビューを入れるのは危険。** 以下が成立してしまう:

- `tauri.conf.json` に `csp` キーが無い → CSP による実行制限なし
- `withGlobalTauri: true` → WebView 上に `window.__TAURI__` が露出
- Markdown 中の生 HTML、`<img onerror=...>`、悪意ある SVG はこの WebView 上で実行される

つまり **他人から受け取ったファイルにカーソルを合わせるだけで、`delete_permanent` を含む invoke を叩ける**。ファイラは「素性の分からないファイルを見る」ための道具であり、エディタより攻撃面が広い。プレビューはこの攻撃を「開く」操作なしに成立させてしまう点が本質的に危険。

### 実装順序(この順を守る)

1. **CSP を設定する**(プレビュー実装より先)
   ```json
   "security": {
     "csp": "default-src 'self'; img-src 'self' asset: http://asset.localhost data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'self' asset: http://asset.localhost; frame-src 'self' asset: http://asset.localhost",
     "assetProtocol": { "enable": true, "scope": ["**"] }
   }
   ```
2. **Markdown は HTML 無効**(`markdown-it({ html: false })`)。加えて生成後の DOM をサニタイズ(許可タグ/属性のホワイトリスト)。`javascript:` / `data:` スキームのリンクを除去
3. **SVG は `<iframe sandbox>` 経由**でのみ表示。`<img src>` での SVG 表示はスクリプトが走らないが、外部参照とレンダリング爆弾のリスクが残るため sandbox に寄せる。sandbox 属性は空(= 全制限)
4. **asset protocol の scope 見直し**(将来課題)。現状 `["**"]` は事実上全ファイル読み取り可。プレビュー導入により実際に使われる経路になるため、閲覧中ディレクトリへの動的スコープ制限を検討する → Open Issue PV-Q3

### その他

- レンダリング爆弾対策として、テキストの行数上限(既定 5,000 行)と DOM ノード数上限を設ける
- 外部ネットワーク参照は CSP で遮断される(Markdown 中の `http://` 画像は表示されない)。これは意図した挙動で、トラッキングピクセルによる閲覧の外部通知を防ぐ

---

## 10. 状態と永続化

セッション(FR-14 / DESIGN.md §3.10)の保存対象に以下を追加する:

| キー | 内容 | 既定 |
|---|---|---|
| `preview.open` | プレビューの開閉 | `false`(PV-4) |
| `preview.placement` | `'right'` / `'bottom'` | `'bottom'`（2ペインは横幅を使うため下を既定に） |
| `preview.ratio` | 分割比率 | `0.32` |
| `preview.imageFit` | 画像の等倍/フィット | `'fit'` |

DESIGN.md §3.10 の保存対象に「プレビュー配置」は既に記載済み。上記はその具体化。

---

## 11. 安全モード・キーバインド・UI 統合

### 安全モード

プレビューは読み取り専用操作であり、REQUIREMENTS.md §5 で安全モードでも許可されると明記されている。**`safemode` のゲートは一切通さない**。`fileops.js` のような `canMutate()` チェックは不要。

### キーバインド

`app.js:429-580` の単一 `onKeydown` に追加する(現状 `keymap.js` は未実装なので既存の if 連鎖に載せる)。既存バインドとの衝突に注意 —— `Space` は選択トグル、`Ctrl+P` は未使用。

| キー | 動作 | 備考 |
|---|---|---|
| `Ctrl+P` | プレビュー ペインの開閉 | 未使用キーを確認済み |
| `Ctrl+Shift+P` | 配置切替(右 ⇄ 下) | |
| `Shift+Space` | クイックルック(全面オーバーレイで表示) | `Space` の選択トグルとは別。v2 |

修飾キー付きなので、既存の「無修飾 switch」より手前の早期 return ブロックに置く。ヘルプ(`help.js` の `SHORTCUTS`)とメニューバー(`menubar.js`)にも同時に追加する —— NFR-U2(キーボード/マウス等価)より、メニューからも到達できる必要がある。

### ステータスバー

プレビュー表示中は、対象ファイルの種別・寸法(画像)・切り詰めの有無をステータスバー右に出す。

---

## 12. エラー・異常系

| 状況 | 挙動 |
|---|---|
| 読み取り権限なし | `meta.js` で「読み取れません(権限)」。トーストは出さない(カーソル移動のたびに鳴るため) |
| ファイルが消えた | `meta.js` で「見つかりません」。ペインの再読込は促さない |
| ネットワークドライブが遅い | デバウンス + 世代トークンで吸収。読み込み中はスピナーではなくメタ情報を出しておく |
| FIFO / デバイスファイル | Rust 側で読まずにエラー。ブロック回避 |
| 不正な UTF-8 | lossy デコードし、`encoding: "utf-8-lossy"` を表示に反映 |
| 巨大な1行 | 折り返し + 行数上限で防御 |

原則として **プレビューの失敗はファイラの操作を妨げない**。例外はプレビュー領域内に閉じ込め、ペインのカーソル操作は常に生きている。

---

## 13. テスト方針

プロジェクト方針(テストの無い変更は未完成)に従い、以下を必須とする。

### JS (Vitest, `src/js/__tests__/`)

| ファイル | 対象 |
|---|---|
| `previewkind.test.js` | `detectKind` / `sniffKind` / `maxBytesFor`。**境界・異常系必須**: size 0 / 上限ちょうど / 上限+1 / 拡張子詐称(`.txt` に NUL) / 拡張子なし / 大文字拡張子 / ディレクトリ |
| `previewplacement.test.js` | 状態遷移・永続化・不正な保存値からの復帰 |
| `preview.test.js` | `createPreview` を全 deps スタブで駆動。**世代トークンの検証を最重要ケースにする**: 遅い A → 速い B の順で解決させ、B が描画され A が破棄されることを確認。デバウンスは注入した `now` と fake timer で検証 |

### Rust (`src-tauri/src/lib.rs` の `#[cfg(test)] mod tests`, `tempfile`)

- `clamp_max_bytes`: 0 / 負相当 / 上限超過
- `classify_head`: 空 / 純テキスト / NUL 含み / UTF-8 日本語 / BOM 付き
- `truncate_at_char_boundary`: マルチバイト文字の途中で切らないこと(3バイト文字の1/2/3バイト目に境界が来る全ケース)
- `read_preview`: 存在しないパス / ディレクトリ / 空ファイル / 上限より大きいファイルが `truncated: true` で返ること

---

## 14. 段階導入

| 版 | 内容 |
|---|---|
| **前提工事** | CSP 設定、`DirEntry` に `modified` 追加。プレビュー実装より**先** |
| **v1 (M2 想定)** | 画像 / プレーンテキスト / Markdown / メタ情報カード。右・下の配置切替。`Ctrl+P` 開閉。デバウンス+世代トークン。REQUIREMENTS.md Q2 の「最小セット」に一致 |
| **v2 (M3)** | PDF、シンタックスハイライト(遅延ロード)、クイックルック(`Shift+Space`)、画像の等倍/フィット |
| **v3 以降** | アーカイブのインライン展開(REQUIREMENTS.md で Could として保留中)、Fude 由来の図式レンダリング |

v1 で意図的に外すもの: シンタックスハイライト、Mermaid/PlantUML、動画・音声、EXIF 表示。いずれも NFR-P2 に対してコストが見合わない。

---

## 15. Open Issues

| ID | 内容 | 暫定 |
|---|---|---|
| PV-Q1 | `Ctrl+P` で確定してよいか(将来の印刷機能と衝突しないか) | 印刷は Tana のスコープ外のため `Ctrl+P` を採用 |
| PV-Q2 | プレビュー対象は「カーソル位置」か「選択中の1件目」か | カーソル位置。複数選択時は先頭 + 「他 N 件」表示 |
| PV-Q3 | asset protocol の scope `["**"]` を閲覧中ディレクトリに動的制限すべきか | v1 は現状維持。CSP で実行を止めた上で、v2 で再検討 |
| PV-Q4 | テキスト上限 256KB は妥当か | 実測後に調整。設定画面(§3.8)で可変にする案あり |
| PV-Q5 | プレビュー ペインにフォーカスを移せるようにするか(スクロール操作のため) | v1 は非フォーカス(`j`/`k` はファイル一覧のまま)。スクロールは `Ctrl+j`/`Ctrl+k` に割当 |
