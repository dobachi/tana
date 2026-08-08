# WSL から Windows 側のアプリで開く (FR-13 の WSL 拡張)

WSL(Linux) 上で動く Tana から、Windows 側のアプリでファイルを開けるようにする機能の説明。
「Windows 上の Tana から `\\wsl$` を見る」（FR-07 の Places）とは**逆方向**の話。

関連: [STATUS.md](STATUS.md) / [REQUIREMENTS.md](REQUIREMENTS.md)

---

## 1. なぜ要るか

WSL では Linux 側に GUI アプリや関連付けが無いことが多く、`xdg-open` 経由の
「既定のアプリで開く」はそのままだと何も起きない・失敗する。実際に開きたいのは
Windows 側の関連付け（エディタ・ビューア・Office 等）であることがほとんど。

そのため Tana は、**WSL と判定できたときの既定オープン先を Windows 側**にする。
Linux 側で開きたい場合は設定で戻せるし、メニューとキーからは常に両方へ到達できる。

## 2. 使い方

### 既定オープン（Enter / ダブルクリック）

| 状況 | 行き先 |
|------|--------|
| WSL（interop 有効） | **Windows 側**（エクスプローラーの関連付け）※既定 |
| WSL で設定を変更した場合 | Linux 側（`xdg-open`） |
| WSL でない（Win/mac/Linux ネイティブ） | 従来どおり OS 既定の opener |

設定は **設定画面（`Ctrl+,`）→「既定のアプリで開く先」** で切り替える。
この項目は WSL のときだけ表示される。

### キーバインド（WSL のときだけ意味を持つ）

| キー | 動作 |
|------|------|
| `o → w` | Windows の既定アプリで開く |
| `o → e` | エクスプローラーで表示（`/select,` で選択状態） |
| `o → o` / `o → r` | 既定の行き先で 開く / ファイルマネージャ表示（設定に従う） |
| `o → 1`…`9` / `o → a` | 登録した外部アプリ / 都度入力（起動先は下記の判定に従う） |

右クリックメニューでも、WSL のときは Linux 側と Windows 側の両方が並ぶ。
どちらが Enter と同じ動きかはラベル（「（Windows）」「（Linux）」）で分かる。
「Windows パスをコピー」も WSL のときだけ出る（`\\wsl.localhost\…` / `C:\…` 形式）。

### 外部アプリの登録（設定 → 外部アプリ）

各エントリに **起動先** を持たせられる。

| 起動先 | 意味 |
|--------|------|
| 自動（既定） | コマンドが `.exe`/`.bat`/`.cmd`/`.com` か `C:\…` なら Windows 側、それ以外は Linux 側 |
| Linux 側 | 常に `xdg-open` 系（`tauri-plugin-opener`）で起動 |
| Windows 側 | 常に interop 経由で起動（パスは Windows 形式に変換して渡す） |

コマンドの書き方（Windows 側）:

- `notepad.exe` のような実行ファイル名（WSL の `PATH` は Windows の `PATH` を含む）
- `C:\Program Files\7-Zip\7zFM.exe` のような Windows パス（内部で `/mnt/c/...` に変換して exec）
- `/mnt/c/Windows/System32/notepad.exe` のような Linux 側から見たパス

いずれも **引数は渡せない**（プログラム 1 つ + パス 1 つ）。これは既存の FR-13 と同じ制約。

## 3. 仕組み

Rust 側 `src-tauri/src/wsl.rs` が 2 つの仕事をする。

**パス変換**（純粋関数 `to_windows_path`）

| Linux パス | Windows パス |
|-----------|--------------|
| `/mnt/c/Users/x/a.txt` | `C:\Users\x\a.txt` |
| `/home/me/a b.txt` | `\\wsl.localhost\<distro>\home\me\a b.txt` |
| `C:\already\win` | そのまま |

自動マウント先は `/proc/mounts` のドライブ行から推定するので、`/etc/wsl.conf` の
`[automount] root=` を変えた環境でも効く（推定できなければ `/mnt`）。

**起動経路**（WSL interop = binfmt_misc による `.exe` の直接実行）

| 操作 | 実行するもの |
|------|--------------|
| Windows の既定アプリで開く | `explorer.exe <winpath>` |
| エクスプローラーで表示（パスに空白なし） | `explorer.exe /select,<winpath>` |
| エクスプローラーで表示（パスに空白あり） | `powershell.exe -Command Start-Process explorer.exe -ArgumentList $env:TANA_REVEAL_ARG` |
| アプリ指定 | `<app> <winpath>` |

選択表示だけ経路が 2 つあるのは、interop の引数引用符付けのため（次節）。

利用可否は `wsl_info` コマンドがフロントへ返す（`WSL_DISTRO_NAME` / `osrelease` +
binfmt_misc の `WSLInterop` が `enabled`）。使えない環境では WSL 用の UI は一切出ない。

## 4. 実装上の注意（ハマりどころ）

- **`explorer.exe` は成功しても終了コード 1 を返す**。終了コードで成否を判定してはいけない。
  Tana は「起動できたか（spawn 失敗＝コマンド不在）」だけを見る。
- **`cmd.exe /c start` は使わない**。cwd が Linux パスだと `UNC パスはサポートされません` と
  警告して Windows ディレクトリに落ちるため、既定アプリの起動は `explorer.exe` に委ねている。
- **`/select,` に空白入りパスを直接渡せない**（WSL 実機で確認）。WSL interop は空白を含む引数を
  **全体ごと**引用符で囲むため、explorer.exe には `"/select,\\wsl.localhost\…\a b.txt"` という
  形で届き、解釈に失敗してまったく別の場所（ドキュメント等）が開く。引用符を自分で足しても
  interop に `\"` へエスケープされるので、argv をどう並べても正規形
  `explorer.exe /select,"…\a b.txt"` は作れない。
  → 空白があるときだけ PowerShell の `Start-Process` にコマンドラインを組ませる。
  引数はスクリプト本文に埋めず環境変数（`TANA_REVEAL_ARG` + `WSLENV`）で渡すことで、
  スクリプト側にも引用符を出さずに済ませている。
  なお `/select,` を伴わない「開く」（パス 1 個）は引用符付きでも正しく動く。

  | 形 | 結果 |
  |----|------|
  | `explorer.exe /select,<空白なしパス>` | ✅ 選択される |
  | `explorer.exe "/select,<空白ありパス>"` | ❌ 別の場所が開く |
  | PowerShell `Start-Process` 経由 | ✅ 選択される |
  | `explorer.exe "<空白ありパス>"`（開く） | ✅ 既定アプリで開く |

- **`/select,` はカンマの直後に空白を入れない**。1 引数として渡す。
- PowerShell 経路は起動に 1 秒前後かかる。だから空白なしパスでは使わない。
- 起動したアプリは Tana より長生きしうるので `wait` しない（ゾンビ回収だけ別スレッドに任せる）。
- **UNC (`\\wsl.localhost\…`) を扱えない Windows アプリがまれにある**（古いアプリ、Office の一部動作）。
  その場合は Windows 側へコピーしてから開くか、`net use` でドライブに割り当てる。
  `/mnt/c` 配下のファイルは `C:\…` に変換されるのでこの問題は起きない。
- `.exe` の起動には 100〜300ms 程度かかる（interop のオーバーヘッド）。

## 5. うまく動かないとき

| 症状 | 確認すること |
|------|--------------|
| WSL 用のメニュー・設定が出ない | `cat /proc/sys/fs/binfmt_misc/WSLInterop` が `enabled` か。`/etc/wsl.conf` の `[interop] enabled=false` になっていないか |
| 「〜 が見つかりません」 | 登録コマンド名。`which notepad.exe` で WSL から見えるか確認 |
| 変なパスで開かれる | 右クリック →「Windows パスをコピー」で、実際に渡している Windows パスを確認 |
| Linux 側で開きたいのに Windows で開く | 設定 →「既定のアプリで開く先」を Linux 側へ。外部アプリは各行の起動先を「Linux 側」に |

## 6. 実装とテスト

| 場所 | 役割 |
|------|------|
| `src-tauri/src/wsl.rs` | パス変換・WSL 判定（純粋関数）＋ `wsl_info`/`windows_path`/`open_in_windows`/`reveal_in_windows` |
| `src/js/core/wsl.js` | 起動先の決定（設定・auto 判定）・ラベル・永続化。DOM/Tauri 非依存 |
| `src/js/core/extapps.js` | 外部アプリの `target` を保持（旧い保存値は `auto` として読める） |
| `src/js/app.js` | `openWith()` の分岐・メニュー項目・二打鍵 `o → w`/`o → e` |
| `src/js/__tests__/wsl.test.js` | 起動先決定・ラベル・永続化 |
| `src/js/__tests__/commands.test.js` | `backend.js` が呼ぶコマンドが Rust に登録されているか（結線ミス防止） |
