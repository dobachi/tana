# ローカルビルド（各OSのバイナリを手元で作る）

CI（GitHub Actions）が全プラットフォームのバイナリを作るが、**手元でも各OS上でネイティブに
ビルドできる**。フロントのバンドルは `tauri.conf.json` の `beforeBuildCommand`
（`npm run build:frontend`）で自動実行されるので、実行するコマンドは1つで済む。

## 共通（Linux / macOS / Windows）

```bash
npm install          # 初回のみ（依存インストール）
npm run build        # = tauri build。frontend ビルド込みでインストーラ/実行ファイルを生成
```

- `make` がある環境なら `make build` でも同じ（内部で `tauri build` を呼ぶ）。
- 特定の形式だけ作るなら bundles を絞る（速い）:
  ```bash
  npx tauri build --bundles nsis      # Windows: NSIS インストーラ(.exe)のみ
  npx tauri build --bundles msi       # Windows: MSI のみ
  npx tauri build --bundles app,dmg   # macOS
  npx tauri build --bundles deb       # Linux
  ```
- 成果物は `src-tauri/target/release/bundle/<形式>/` に出る。素の実行ファイルは
  `src-tauri/target/release/`（Windows は `tana.exe`）。

## Windows で Windows バイナリを作る

**`make` や bash は不要**。PowerShell / コマンドプロンプトで `npm run build` を実行すればよい。

### 前提

- **Node.js**（LTS 推奨）
- **Rust（MSVC ツールチェーン）**: `rustup`（<https://rustup.rs>）を入れると既定で
  `stable-x86_64-pc-windows-msvc` になる
- **Microsoft C++ Build Tools**（Visual Studio 2022 の「C++ によるデスクトップ開発」、
  または Build Tools 単体）— Rust の MSVC リンクに必要
- **WebView2 ランタイム** — Windows 10/11 には通常プリインストール済み

### 手順

```powershell
cd path\to\tana
npm install
npm run build
# 生成物:
#   src-tauri\target\release\tana.exe                     （素の実行ファイル）
#   src-tauri\target\release\bundle\nsis\*-setup.exe      （NSIS インストーラ）
#   src-tauri\target\release\bundle\msi\*.msi             （MSI。WiX は tauri が自動取得）
```

> `bundle.targets` は `all` なので、Windows では NSIS と MSI の両方を作ろうとする。
> どちらかだけで良ければ `npx tauri build --bundles nsis` のように絞ると速い。

### うまくいかないとき

- `link.exe not found` / MSVC 関連エラー → C++ Build Tools が未導入。上記を入れる。
- Rust が GNU ツールチェーンになっている → `rustup default stable-msvc` で MSVC に切替。
- WebView2 が無い（古い Windows）→ Microsoft の WebView2 Runtime を入れる。

## リリース（メンテナ向け）

バージョンは `package.json` / `Cargo.toml` / `tauri.conf.json` の3箇所に散るため、
必ず `make release` 経由で上げる（手動 sed は禁止）。

```bash
make release VERSION=0.4.13   # 非対話（CI/自動化向け）
make release                  # 対話（プロンプトでバージョン入力）
```

`make release` は check → 3ファイルのバージョン更新 → lockfile 同期 → コミット →
タグ push まで行い、CI が全プラットフォームのバイナリをビルドする。
