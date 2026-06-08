#!/usr/bin/env bash
# Tana 動作確認エントリポイント
#   gui   : Xvfb + noVNC で GUI 起動（既定）。http://localhost:6080/vnc.html
#   test  : ヘッドレスで全テスト（Vitest + cargo test）
#   check : lint + format + test（CI 相当）
#   shell : bash を起動
set -euo pipefail

MODE="${1:-gui}"
SANDBOX="$HOME/sandbox"
BIN="src-tauri/target/debug/tana"

seed_sandbox() {
  # 使い捨てサンプル（コピー/移動/削除を安全に試す）
  rm -rf "$SANDBOX"
  mkdir -p "$SANDBOX/docs" "$SANDBOX/src" "$SANDBOX/work" "$SANDBOX/空フォルダ"
  echo "# サンプル README" >"$SANDBOX/README.md"
  echo "メモ" >"$SANDBOX/docs/note.txt"
  printf 'console.log("hi");\n' >"$SANDBOX/src/index.js"
  head -c 2048 /dev/zero >"$SANDBOX/work/blob.bin" 2>/dev/null || true
  echo "secret" >"$SANDBOX/.hidden"
  echo "==> サンドボックスを用意: $SANDBOX"
}

start_display() {
  Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
  sleep 1
  fluxbox >/tmp/fluxbox.log 2>&1 &
  x11vnc -display :99 -nopw -forever -shared -quiet -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
  websockify --web=/usr/share/novnc 6080 localhost:5900 >/tmp/novnc.log 2>&1 &
  sleep 1
  echo "============================================================"
  echo "  noVNC で接続: http://localhost:6080/vnc.html"
  echo "  （パスワード不要。自動接続: ?autoconnect=true&resize=remote）"
  echo "============================================================"
}

case "$MODE" in
  test)
    npm run build:frontend
    npx vitest run
    ( cd src-tauri && cargo test --lib )
    ;;
  check)
    npx prettier --check 'src/**/*.{js,css,html}'
    npx eslint src/js/
    npx vitest run
    ( cd src-tauri && cargo fmt --check && cargo clippy --lib -- -D warnings && cargo test --lib )
    ;;
  shell)
    exec bash
    ;;
  gui | *)
    seed_sandbox
    start_display
    echo "==> Tana を起動します（サンドボックスを表示）"
    exec "$BIN" "$SANDBOX"
    ;;
esac
