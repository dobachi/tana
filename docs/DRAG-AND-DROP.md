# Tana (棚) - ドラッグ＆ドロップ 設計メモ (FR-02 / FR-11)

> ペイン間・フォルダへのドラッグ＆ドロップによるコピー/移動の設計。
> 関連: [要求分析](REQUIREMENTS.md) / [設計](DESIGN.md) / [開発ステータス](STATUS.md)

- **対象要求**: FR-02（ペイン間コピー/移動, 優先度 **M**）/ FR-11（マウス操作, 優先度 **M**）
- **位置づけ**: M1 で唯一まとまって欠けている機能。これが埋まると M1 完了判定に入れる。

---

## 1. 現状

- 複数選択（`core/selection.js`）・右クリックメニュー（`core/menu.js`）は実装済み。
- コピー/移動は **F5 / F6** のキーボード操作のみ。対象は「選択があればそれ、無ければカーソル位置の1件」（`selection.targetEntries`）、宛先は常に**非アクティブペインの現在地**。
- 破壊的操作は `core/safemode.js` を真実源に `core/fileops.js` でゲート済み（NFR-R1）。衝突解決（名前変更/上書き/キャンセル）も `fileops.withConflict` に一元化されている。

つまり **操作の実体はすべて `fileops` に揃っている**。D&D は「対象と宛先を決める新しい入力経路」を足すだけでよく、ファイル操作のロジックを二重に書く必要はない。

---

## 2. 方式選定: なぜ HTML5 D&D を使わないか ★重要

Tauri には**内部D&D機構**があり、`dragDropEnabled`（既定 `true`）で制御される。この名前は紛らわしいが、実体は次のとおり:

> `dragDropEnabled: true` = **Tauri の内部D&Dが有効 / DOM の D&D が無効**

両者は**排他**で、webview 生成時に決まる。実行時トグルは未実装（[tauri#13189](https://github.com/tauri-apps/tauri/issues/13189) が feature request 段階）。公式ドキュメントは「Windows で HTML5 D&D を使うには無効化が必要」と書くが、macOS でも同じ制約だと報告されている（[tauri#14373](https://github.com/tauri-apps/tauri/issues/14373)）。

参考: [tauri#4168](https://github.com/tauri-apps/tauri/issues/4168) / [tauri#13761](https://github.com/tauri-apps/tauri/issues/13761)

### 選択肢

| | 案A: ポインタイベントで自作 | 案B: HTML5 D&D |
|---|---|---|
| `dragDropEnabled` | `true`（既定のまま） | `false` |
| OS（Explorer 等）→ Tana のドロップ | **受けられる** | 受けられない |
| 実装コスト | ドラッグゴースト・座標ヒットテスト・Escape を自前 | ブラウザ任せで楽 |
| 後からの方針転換 | — | 入力層の作り直しが必要 |

### **採用: 案A（ポインタイベントで自作、`dragDropEnabled` は既定 `true` のまま）**

決め手は、**座標ヒットテストのコードが内部D&Dと OS ドロップで共通になる**こと。

Tauri のネイティブD&Dイベント `onDragDropEvent` は、`'over'` でカーソル座標（`payload.position`）、`'drop'` で実ファイルパス（`payload.paths`）を渡してくる。つまり OS からのドロップを扱うには、いずれにせよ「座標 → どのペインのどのフォルダか」を解決する仕組みが要る。

内部D&Dもポインタイベントで自作すれば、**同じ解決器を両方から呼べる**。HTML5 D&D を選ぶと、この解決器を持ちながら OS ドロップだけ永久に諦めることになり、割に合わない。

判定ロジック（何を掴んだか・どこへ落とすか・不正ドロップの拒否）は `core/dnd.js` に純粋関数として切り出すので、方式に依存しない。

> **注意**: `onDragDropEvent` の座標は、デバッガパネルを開いていると不正確になる既知の制限がある。動作確認時はデバッガを閉じること。

---

## 3. スコープ

### v1 に入れる（内部D&D）

| ドロップ先 | 宛先ディレクトリ |
|---|---|
| 相手ペインの一覧の余白 | そのペインの現在地 |
| フォルダ行（どちらのペインでも / 同一ペイン内も可） | そのフォルダ |
| ペインのヘッダ（ブレッドクラム） | その階層のパス |

### v1 に入れない

- **OS → Tana のネイティブドロップ**。方式選定（§2）により**道は開いたままだが**、実装は別タスクとする。`onDragDropEvent` を購読して §6 の解決器に流すだけで済む見込み。
- **Tana → OS のドラッグ出し**（別プラグインが要る）。
- **お気に入りサイドバーへのドロップ**。有用だが `favoritesview.js` 側の当たり判定が別物になるため段階2。
- **並べ替えのためのD&D**（ファイラに並べ替えの概念が無い）。

---

## 4. コピーか移動か ★要決定

一般的なファイラの慣習は「同一ボリューム内なら移動 / 別ボリュームならコピー」で、修飾キーで上書きする（Windows: Ctrl=コピー, Shift=移動 / GNOME Files も同様）。

しかし Tana でこれを踏襲するのは筋が悪いと考える:

1. **ボリューム判定が難しい**。2ペインファイラのドラッグは「ローカル ⇄ OneDrive ⇄ WSL」を跨ぐことが多く（そもそもそれが Tana の狙い, FR-07）、判定を誤ると**ユーザーの意図に反して元ファイルが消える**。復元手段は無い。
2. **Tana の既存操作は「賢い既定」を持たない**。コピーは F5、移動は F6 と、常に明示的に指定させる設計になっている。D&D だけ暗黙の判断を持ち込むのは一貫しない。
3. Tana は安全側に倒す方針（安全モード既定・削除はゴミ箱経由・完全削除は確認必須）。

**採用案: 既定＝コピー（非破壊）、`Shift` 押下中＝移動。**

- 誤操作の最悪ケースが「余計なコピーができる」に留まり、元データを失わない。
- ドラッグ中は**どちらになるかを常に画面に出す**（§5）ので、暗黙にはならない。
- `Shift`=移動 は Windows/GNOME の修飾キーとも矛盾しない（あちらでも Shift は移動を強制する）。

安全モード中は D&D を**成立させないが、無反応にはしない**。ドラッグ自体は始めてゴーストを取り消し線付き（ドロップ不可）で見せ、落とせる場所に落としたときに `fileOps` と同じ文言のトーストで理由を伝える（「安全モードです（切替: Ctrl+Shift+Space）」）。ドロップの実行は `dropEffect` が `'none'` を返すので `validateDrop` で確実に弾かれる。

> 当初は「ドラッグを開始させず、ゴーストも出さない」設計だったが、実機確認で**完全な無反応が「D&D が壊れている」と受け取られた**ため変更した。F5/F6 を安全モードで押したときにトーストが出るのと挙動を揃える。ペイン外へ落としたとき（＝やめた操作）は黙る。

---

## 5. UI フィードバック

自作方式では、HTML5 D&D が無料でくれていた表現を自分で用意する。

- **ドラッグ開始のしきい値**: `mousedown` から **5px** 動いたら開始。これが無いと、ただのクリック（選択）が毎回ドラッグになって操作不能になる。
- **ドラッグ元**: 対象行に `.dragging` を付けて半透明化。
- **ゴースト**: カーソル追従の小さな要素。`「<名前>」` または `「N 件」` と、効果（コピー/移動）を文字で出す。**HTML5 と違い効果を OS カーソルに出せないので、文字で示すのが唯一の手段**。
- **ドロップ先**:
  - フォルダ行 → `.drop-into`（行を枠線で強調）
  - 一覧の余白 → ペイン全体に `.drop-here`
  - 不許可 → ゴーストに `.denied`（拒否表示）、ドロップしても何も起きない
- **キャンセル**: `Escape` / 右クリック / ウィンドウ外での `mouseup`。
- **`Shift` の押し引き**: ドラッグ中に `Shift` を押したり離したりしたら、ゴーストの表示を即座に切り替える（`keydown`/`keyup` を購読）。

---

## 6. モジュール構成

判定はすべて純粋関数に切り出し、DOM/Tauri 非依存で単体テストする（CONTRIBUTING.md の方針）。

### `src/js/core/dnd.js`（新規・純粋関数のみ）

| 関数 | 役割 |
|---|---|
| `dragPayload(targets, draggedPath)` | ドラッグ対象の確定。掴んだ行が選択に含まれていれば選択全体、含まれなければその1件 |
| `dropEffect(mods, canMutate)` | `'copy'` / `'move'` / `'none'` を返す。安全モードなら常に `'none'` |
| `validateDrop(sources, destDir, effect)` | 不正なドロップを弾く。理由コードを返す |
| `isSameOrDescendant(ancestor, path)` | パス包含判定（`pathnav.normalizeSeparators` を再利用） |
| `parentDirOf(path)` | 親ディレクトリ。`same-dir` 判定に使う |
| `exceededThreshold(start, current, px)` | ドラッグ開始しきい値（§5） |
| `describeDrag(sources, effect)` | ゴーストの表示文字列 |

### `validateDrop` が弾くもの ★重要

これを漏らすとデータが壊れる。

| 条件 | 理由コード | なぜ |
|---|---|---|
| 対象が空 / 宛先が無い | `empty` | — |
| 効果が `none` | `denied` | 安全モード |
| 宛先が対象自身 | `into-self` | フォルダを自分自身に入れられない |
| 宛先が対象の子孫 | `into-descendant` | **無限再帰。`copy_recursive` が暴走してディスクを埋める** |
| 移動で、宛先が対象の親と同じ | `same-dir` | 何も起きない操作。無駄な衝突ダイアログを避ける |

> コピーで親が同じ場合は弾かない。「同じフォルダ内に複製を作る」は正当な操作で、衝突解決の「名前変更」で `foo (1)` を作れる。

### `src/js/core/dragdrop.js`（新規・DOM 層）

ドラッグセッションを管理する。**内部D&Dと OS ドロップの両方から使う座標解決器をここに置く**（§2 の決め手）。

- `resolveDropTarget(x, y)` — `document.elementFromPoint` で要素を引き、`.entry` / `.pane-list` / `.crumb` のどれに当たったかを見て `{pane, destDir}` を返す。**この関数が OS ドロップ対応時にそのまま再利用される。**
- `createDragSession({getTargets, getPaneInfo, canMutate, onDrop})` — `mousedown` から `mouseup` までを追跡し、しきい値・ゴースト・ハイライト・`Escape` を面倒みる。

### 既存モジュールへの追加

- `core/filepane.js`: 行の `mousedown` で `onDragStart({entry, x, y})` を上げる（選択処理は既存のまま）。ペイン自身はファイル操作もドラッグ管理も知らない。
- `src/js/app.js`: ドラッグセッションを生成し、`onDrop` で `fileOps.copy` / `fileOps.move` を呼ぶ。両ペインの refresh は `fileOps` 側の `refresh` が担当済み。
- `src/style.css`: `.entry.dragging` / `.entry.drop-into` / `.pane.drop-here` / `.drag-ghost`。

---

## 7. テスト方針

`src/js/__tests__/dnd.test.js`（純粋関数）:

- `dragPayload`: 選択内の行を掴む → 選択全体 / 選択外の行を掴む → その1件 / 選択が空 → その1件
- `dropEffect`: 修飾なし→`copy` / Shift→`move` / 安全モード→`none`（修飾によらず）
- `validateDrop`: 正常系 / `into-self` / `into-descendant`（`/a` → `/a/b/c`）/ 移動の `same-dir` / コピーの同一親は許可 / Windows 区切り `C:\a` と `C:/a/b` の混在
- `isSameOrDescendant`: 前方一致の落とし穴（`/foo` と `/foobar` を子孫と誤判定しないこと）
- `exceededThreshold`: 境界（4px は開始しない / 5px で開始）

`src/js/__tests__/dragdrop.test.js`（jsdom）:

- しきい値未満の `mousedown`→`mouseup` ではドラッグが始まらない（＝ただのクリックを壊さない）
- フォルダ行での `mouseup` で `onDrop` が正しい宛先で呼ばれる
- 一覧の余白での `mouseup` でそのペインの現在地が宛先になる
- 安全モード中はドラッグが始まらない
- `Escape` でキャンセルされ `onDrop` が呼ばれない
- ドラッグ中の `Shift` 押下でゴーストの表示が移動に変わる

### 検証環境の制約 ★注意

**`make docker-gui`（Docker + Xvfb + noVNC）では `Shift` 押下中のドラッグを確認できない。**

RFB プロトコル（[RFC 6143](https://www.rfc-editor.org/rfc/rfc6143.html)）の PointerEvent は message-type / button-mask / 座標しか運ばず、修飾キーの欄が無い。ブラウザ自動化から Shift+ドラッグを送っても、アプリには**修飾キーなしのドラッグ**として届く。noVNC の不具合ではなく構造上そうなる。

したがって検証は次のように分ける。**確認済みと未確認を曖昧にしないこと。**

| 経路 | 確認方法 |
|---|---|
| 効果の判定（Shift→移動 / 無修飾→コピー） | **単体テスト**（`dropEffect`） |
| しきい値・ゴースト表示・ドロップ先ハイライト | Docker GUI で目視可 |
| フォルダ行へのドロップ（無修飾＝コピー） | Docker GUI で目視可 |
| **Shift+ドロップ（移動）の実挙動** | **ネイティブ起動でのみ確認可** |

> ただし「VNC で動かない＝環境の制約」と反射的に決めつけないこと。修飾キーのように**原理的に説明がつくもの**と、単に動いていないものは区別する。過去に、ダブルクリックが効かないのを環境のせいと誤断し、実際は本体のバグ（クリックのたびに DOM を作り直して2回目が別ノードに当たる）だった事例がある（→ `filepane.js` の `syncRowStates` のコメント）。

---

## 8. Open Issues

- **Q-DND1**: 既定をコピーにする案（§4）でよいか。OS 慣習（同一ボリュームなら移動）に寄せる選択肢もある。→ **要確認**
- **Q-DND2**: お気に入りサイドバーへのドロップを段階2でやるか、M2 の FR-07 Places と一緒にやるか。
- **Q-DND3**: OS → Tana のネイティブドロップをいつ入れるか（§3）。`resolveDropTarget` が出来た時点で小さく足せる。

---

## 9. 実装順序

1. `core/dnd.js` + `__tests__/dnd.test.js`（純粋ロジック・テストファースト）
2. `core/dragdrop.js` + `__tests__/dragdrop.test.js`（セッション管理と座標解決）
3. `filepane.js` の結線（`onDragStart` を上げるだけ）
4. `app.js` で `fileOps` へ接続、`style.css` のドラッグ表示
5. `make check` green を確認 → STATUS.md の §4 / §7 を更新

> `tauri.conf.json` は**変更不要**（`dragDropEnabled` は既定 `true` のまま）。
