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

# X サーバが実際に接続を受け付けるまで待つ。固定の sleep では、Xvfb が
# ソケットを開く前に GTK が接続を試みて "Failed to initialize GTK" で
# 落ちることがある（実際にこの競合で起動しなかった）。
wait_for_x() {
  for _ in $(seq 1 50); do
    [ -S /tmp/.X11-unix/X99 ] && return 0
    sleep 0.2
  done
  echo "X サーバの起動を待てませんでした（/tmp/xvfb.log を確認してください）" >&2
  cat /tmp/xvfb.log >&2 || true
  return 1
}

start_display() {
  Xvfb :99 -screen 0 1440x1000x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
  wait_for_x
  # キーボードレイアウトを設定（未設定だと入力が届かない）
  setxkbmap -display :99 us >/tmp/xkb.log 2>&1 || true
  fluxbox >/tmp/fluxbox.log 2>&1 &
  # -xkb: キーシンボルを正しく送る
  x11vnc -display :99 -nopw -forever -shared -xkb -quiet -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
  websockify --web=/usr/share/novnc 6080 localhost:5900 >/tmp/novnc.log 2>&1 &
  sleep 1
  echo "============================================================"
  echo "  noVNC で接続: http://localhost:6080/vnc.html"
  echo "  （パスワード不要。自動接続: ?autoconnect=true&resize=remote）"
  echo "  入力できない時は一度ウィンドウ内をクリックしてください。"
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
    # 起動後、ウィンドウへフォーカスを当てる（入力対策）
    (
      sleep 3
      # ウィンドウマネージャが負のY座標に置くことがあり、上端（メニューバー）が
      # 画面外に出て見えなくなる。明示的に左上へ寄せてから前面に出す。
      W=$(xdotool search --sync --name 'Tana' | tail -1)
      xdotool windowmove "$W" 0 24 windowactivate "$W" windowfocus "$W" >/tmp/focus.log 2>&1 || true
    ) &
    # dbus セッション下で起動（WebKitGTK の安定化）
    exec dbus-run-session -- "$BIN" "$SANDBOX"
    ;;
esac
