.PHONY: setup doctor install-rust dev build test test-js test-rust lint lint-js lint-rust format format-js format-rust format-check check clean help \
        docker-build docker-gui docker-test docker-check docker-shell

# OS判定
UNAME_S := $(shell uname -s)

# Linux (Debian/Ubuntu) で必要な apt パッケージ
APT_DEPS := libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev pkg-config

help:
	@echo "Tana (棚) - Lightweight cross-platform file manager"
	@echo ""
	@echo "Usage:"
	@echo "  make doctor       開発環境の前提条件をチェック"
	@echo "  make install-rust rustup で Rust をインストール（未導入時のみ）"
	@echo "  make setup        依存関係を一括インストール（doctor 後に実行）"
	@echo "  make dev          開発モード起動"
	@echo "  make build        プロダクションビルド"
	@echo "  make test         全テスト実行"
	@echo "  make lint         全lint実行"
	@echo "  make format       全フォーマット実行"
	@echo "  make check        lint + format + test + build"
	@echo "  make clean        ビルド成果物を削除"

doctor:
	@echo "==> 開発環境をチェックします..."
	@missing=0; \
	if command -v node >/dev/null 2>&1; then echo "  ✓ node $$(node --version)"; else echo "  ✗ node が見つかりません"; missing=1; fi; \
	if command -v npm >/dev/null 2>&1; then echo "  ✓ npm $$(npm --version)"; else echo "  ✗ npm が見つかりません"; missing=1; fi; \
	if command -v cargo >/dev/null 2>&1; then echo "  ✓ cargo $$(cargo --version | awk '{print $$2}')"; else \
		echo "  ✗ cargo (Rust) が見つかりません → make install-rust"; missing=1; fi; \
	if [ "$(UNAME_S)" = "Linux" ] && command -v dpkg >/dev/null 2>&1; then \
		missing_pkgs=""; for pkg in $(APT_DEPS); do dpkg -s "$$pkg" >/dev/null 2>&1 || missing_pkgs="$$missing_pkgs $$pkg"; done; \
		if [ -n "$$missing_pkgs" ]; then echo "  ✗ 不足aptパッケージ:$$missing_pkgs"; echo "    → sudo apt-get install -y$$missing_pkgs"; missing=1; \
		else echo "  ✓ aptパッケージは揃っています"; fi; \
	fi; \
	if [ $$missing -ne 0 ]; then echo "✗ 前提条件が不足しています。"; exit 1; fi; \
	echo "✓ 環境チェック OK"

install-rust:
	@if command -v cargo >/dev/null 2>&1; then echo "Rust は既にインストール済み: $$(cargo --version)"; else \
		curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile default; \
		echo "==> source \"$$HOME/.cargo/env\" を実行してください"; fi

setup: doctor
	npm install
	cargo build --manifest-path src-tauri/Cargo.toml
	@echo "==> セットアップ完了"

dev:
	npm run build:frontend
	npx tauri dev

build:
	npm run build:frontend
	npx tauri build || echo "Note: 一部のbundleターゲットが失敗する場合があります（例: WSL上のAppImage）。"

build-frontend:
	npm run build:frontend

test: test-js test-rust

test-js:
	npx vitest run

test-rust:
	cd src-tauri && cargo test --lib

lint: lint-js lint-rust

lint-js:
	npx eslint src/js/

lint-rust:
	cd src-tauri && cargo clippy -- -D warnings

format: format-js format-rust

format-js:
	npx prettier --write 'src/**/*.{js,css,html}'

format-rust:
	cd src-tauri && cargo fmt

format-check:
	npx prettier --check 'src/**/*.{js,css,html}'
	cd src-tauri && cargo fmt --check

check: format-check lint test build-frontend

clean:
	rm -rf dist/bundle.js dist/index.html dist/style.css
	cd src-tauri && cargo clean

# ---- Docker 動作確認（安全・隔離） ----
# 詳細は docs/DOCKER.md
docker-build:
	docker compose build

docker-gui: docker-build
	@echo "起動後: http://localhost:6080/vnc.html を開いてください"
	docker compose up

docker-test:
	docker compose run --rm tana test

docker-check:
	docker compose run --rm tana check

docker-shell:
	docker compose run --rm tana shell
