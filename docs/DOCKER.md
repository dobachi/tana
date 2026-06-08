# Docker での動作確認（安全・隔離）

ホストを汚さずに Tana の動作確認を行うための隔離環境です。

## 方針（安全性）

- **ホストのファイルシステムをマウントしない**自己完結イメージ（ソースはビルド時に COPY）。
- 非root ユーザで実行。
- コピー/移動/削除などの操作は、コンテナ内の**使い捨てサンドボックス**(`~/sandbox`)上だけで行う。
- GUI はコンテナ内の仮想ディスプレイ(Xvfb)で描画し、**noVNC(ブラウザ)** で確認する。ホストの X サーバや GPU には触れない。

## 前提

- Docker（WSL の場合は Docker Desktop の WSL 統合を有効化）。
- 初回の `build` は Tauri 依存のコンパイルを含むため時間がかかります（数分〜十数分）。以降はキャッシュされます。

## 使い方

### GUI で動作確認（noVNC）

```bash
make docker-gui          # = docker compose up --build
# 起動ログに従い、ブラウザで以下を開く:
#   http://localhost:6080/vnc.html
```

ブラウザに Tana のウィンドウが表示され、サンドボックスのサンプルが見えます。

- `Tab` でペイン往復、`j/k` 上下、`h/l` 親/入る
- `Ctrl+Shift+Space` 安全⇄操作モード、`Ctrl+Shift+T` テーマ、`Ctrl+H` 隠しファイル
- `F5` コピー / `F6` 移動 / `Delete` ゴミ箱 / `Shift+Delete` 完全削除
  （安全モードでは抑止され、トーストで通知されます）

停止: `Ctrl+C`、または別端末で `docker compose down`。

### ヘッドレスでテスト（GUIなし）

```bash
make docker-test         # Vitest + cargo test
make docker-check        # prettier + eslint + fmt + clippy + 全テスト（CI相当）
```

### コンテナ内シェル

```bash
make docker-shell
```

## モード（entrypoint 引数）

`docker compose run --rm tana <mode>` の `<mode>`:

| mode | 内容 |
|------|------|
| `gui`（既定） | Xvfb + noVNC で GUI 起動、サンドボックスを開く |
| `test` | Vitest + cargo test |
| `check` | lint + format + clippy + 全テスト |
| `shell` | bash |

## トラブルシュート

- **ウィンドウが出ない/真っ黒**: WebKitGTK のヘッドレス描画の問題のことがあります。イメージでは
  `WEBKIT_DISABLE_COMPOSITING_MODE=1` / `WEBKIT_DISABLE_DMABUF_RENDERER=1` / `LIBGL_ALWAYS_SOFTWARE=1` を設定済みです。
  それでも出ない場合は `docker compose run --rm tana shell` で入り `cat /tmp/xvfb.log /tmp/x11vnc.log` を確認してください。
- **ポート競合**: `6080` が使用中なら `docker-compose.yml` の ports を変更してください。
- **コード変更を反映**: イメージはソースを COPY するため、変更後は `make docker-build`（再ビルド）が必要です。
