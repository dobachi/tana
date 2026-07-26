import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// フロントエンドが呼ぶ Tauri プラグインのコマンドは、src-tauri の capabilities
// (ACL) で許可されていないと実行時に "not allowed by ACL" で弾かれる。これは
// JS ↔ Rust の境界をまたぐため単体テストのモックでは検出できず、実際に
// opener:allow-open-path の欠落が本番で "外部アプリで開く" を壊していた。
//
// ここでは「フロントで使っている opener のメソッド」と「capabilities に付与した
// 許可」の整合だけを静的に突き合わせ、許可の付け忘れを回帰として捕まえる。
// （実際に開けるか＝ポータル/ハンドラの有無は環境依存なので対象外。）

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

// opener の JS メソッド名 → 対応する capability の許可 identifier
const OPENER_PERMISSION = {
  openPath: 'opener:allow-open-path',
  revealItemInDir: 'opener:allow-reveal-item-in-dir',
  openUrl: 'opener:allow-open-url',
};

/** capabilities/default.json の permissions から identifier 文字列を集める */
function grantedPermissions() {
  const cap = JSON.parse(read('src-tauri/capabilities/default.json'));
  return new Set(
    (cap.permissions || []).map((p) => (typeof p === 'string' ? p : p.identifier)).filter(Boolean),
  );
}

/** app.js で実際に呼んでいる opener メソッドを抜き出す */
function usedOpenerMethods() {
  const src = read('src/js/app.js');
  const used = new Set();
  for (const m of Object.keys(OPENER_PERMISSION)) {
    if (new RegExp(`opener\\.${m}\\b`).test(src)) used.add(m);
  }
  return used;
}

describe('capabilities と opener 利用の整合', () => {
  it('capabilities/default.json が読める（陽性対照）', () => {
    expect(grantedPermissions().size).toBeGreaterThan(0);
  });

  it('フロントで使う opener メソッドが1つ以上ある（陽性対照）', () => {
    // これが空になったら検査自体が形骸化しているサイン（app.js のパス変更等）
    expect(usedOpenerMethods().size).toBeGreaterThan(0);
  });

  it('使っている opener メソッドはすべて capabilities で許可されている', () => {
    const granted = grantedPermissions();
    const missing = [...usedOpenerMethods()]
      .map((m) => OPENER_PERMISSION[m])
      .filter((perm) => !granted.has(perm));
    // 例: openPath を使っているのに opener:allow-open-path が無い、を検出する
    expect(missing).toEqual([]);
  });
});
