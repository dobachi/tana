import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// backend.js が呼ぶ Tauri コマンドと、Rust 側 (lib.rs) の generate_handler! 登録の整合。
//
// capabilities.test.js と同じ動機: 実行時にしか出ない結線ミスを静的に捕まえる。
// コマンドを足したのに generate_handler! への追加を忘れると、本番でだけ
// "command not found" になる（テストは Tauri 不在で null を返すので気付けない）。

const here = dirname(fileURLToPath(import.meta.url));
const backendSrc = readFileSync(resolve(here, '../backend.js'), 'utf8');
const libSrc = readFileSync(resolve(here, '../../../src-tauri/src/lib.rs'), 'utf8');

/** backend.js から呼んでいるコマンド名を抜き出す（invoke('x') と fn('x') の両方） */
function invokedCommands() {
  const names = new Set();
  const re = /\b(?:invoke|fn)\(\s*'([a-z_][a-z0-9_]*)'/g;
  let m;
  while ((m = re.exec(backendSrc))) names.add(m[1]);
  return names;
}

/** generate_handler![...] に登録されたコマンド名（module:: は落とす） */
function registeredCommands() {
  const block = libSrc.match(/generate_handler!\s*\[([\s\S]*?)\]/);
  if (!block) return new Set();
  return new Set(
    block[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split('::').pop()),
  );
}

describe('backend.js と Rust コマンド登録の整合', () => {
  it('呼び出しているコマンドが1つ以上ある（陽性対照）', () => {
    expect(invokedCommands().size).toBeGreaterThan(5);
  });

  it('登録一覧を読めている（陽性対照）', () => {
    const reg = registeredCommands();
    expect(reg.has('list_dir')).toBe(true);
    expect(reg.size).toBeGreaterThan(5);
  });

  it('backend.js が呼ぶコマンドはすべて generate_handler! に登録されている', () => {
    const registered = registeredCommands();
    const missing = [...invokedCommands()].filter((c) => !registered.has(c));
    expect(missing).toEqual([]);
  });

  it('WSL 連携のコマンドが揃っている (FR-13 の WSL 拡張)', () => {
    const registered = registeredCommands();
    for (const c of ['wsl_info', 'windows_path', 'open_in_windows', 'reveal_in_windows']) {
      expect(registered.has(c)).toBe(true);
    }
  });
});
