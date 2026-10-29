import { describe, it, expect, vi } from 'vitest';
import {
  buildFileMenuItems,
  buildEditExtraItems,
  buildGoMenuItems,
  buildFilterMenuItems,
} from '../core/appmenus.js';
import { SHORTCUTS } from '../core/help.js';

const byLabel = (items, label) => items.find((i) => i.label === label);
const shortcuts = (items) => items.filter((i) => !i.separator).map((i) => i.shortcut);

describe('buildFileMenuItems', () => {
  it('カーソル行が無ければ「開く」系は無効', () => {
    const items = buildFileMenuItems({ hasEntry: false });
    expect(byLabel(items, '既定のアプリで開く').disabled).toBe(true);
    expect(byLabel(items, 'ファイルマネージャで表示').disabled).toBe(true);
    expect(byLabel(items, '別のアプリで開く…').disabled).toBe(true);
    expect(byLabel(items, '新しいタブ').disabled).toBeFalsy();
  });

  it('WSL のときだけ Windows 側で開く項目を出す', () => {
    expect(byLabel(buildFileMenuItems({ hasEntry: true }), 'エクスプローラーで表示')).toBe(
      undefined,
    );
    const items = buildFileMenuItems({ hasEntry: true, wsl: true });
    expect(byLabel(items, 'Windows の既定アプリで開く').shortcut).toBe('o → w');
    expect(byLabel(items, 'エクスプローラーで表示').disabled).toBe(false);
  });

  it('モード切替のラベルは今のモードの逆を言う', () => {
    const toggleMode = vi.fn();
    const safe = buildFileMenuItems({ safe: true }, { toggleMode });
    expect(byLabel(safe, '操作モードに切り替える').shortcut).toBe('Ctrl+Shift+Space');
    byLabel(safe, '操作モードに切り替える').action();
    expect(toggleMode).toHaveBeenCalled();
    expect(
      byLabel(buildFileMenuItems({ safe: false }), '安全モード（閲覧のみ）に戻す'),
    ).toBeTruthy();
  });

  it('注入した action をそのまま項目に付ける', () => {
    const openApp = vi.fn();
    const remote = vi.fn();
    const items = buildFileMenuItems({ hasEntry: true }, { openApp, remote });
    expect(byLabel(items, '既定のアプリで開く').action).toBe(openApp);
    expect(byLabel(items, 'リモート接続…（SSH / SFTP）').action).toBe(remote);
  });
});

describe('buildEditExtraItems', () => {
  it('対象が無ければコピー/切り取りは無効、貼り付けは canPaste 次第', () => {
    const items = buildEditExtraItems({ targetCount: 0, canPaste: false });
    expect(byLabel(items, 'コピー').disabled).toBe(true);
    expect(byLabel(items, '切り取り').disabled).toBe(true);
    expect(byLabel(items, 'ここへ貼り付け').disabled).toBe(true);
    expect(byLabel(buildEditExtraItems({ canPaste: true }), 'ここへ貼り付け').disabled).toBe(false);
  });

  it('複数件なら件数を出す。選択が無ければ解除は無効', () => {
    const items = buildEditExtraItems({ targetCount: 3, hasSelection: false });
    expect(byLabel(items, 'コピー（3 件）').shortcut).toBe('Ctrl+C');
    expect(byLabel(items, '選択を解除').disabled).toBe(true);
  });

  it('パス・名前のコピーはカーソル行が要る。現在地のパスはいつでも', () => {
    const items = buildEditExtraItems({ hasEntry: false });
    expect(byLabel(items, 'パスをコピー').disabled).toBe(true);
    expect(byLabel(items, '名前をコピー').disabled).toBe(true);
    expect(byLabel(items, '現在地のパスをコピー').disabled).toBeFalsy();
  });
});

describe('buildGoMenuItems', () => {
  it('履歴が無ければ戻る/進むは無効', () => {
    const items = buildGoMenuItems({ canBack: false, canForward: true });
    expect(byLabel(items, '戻る').disabled).toBe(true);
    expect(byLabel(items, '進む').disabled).toBe(false);
  });

  it('パス入力（Ctrl+L）がある', () => {
    const pathInput = vi.fn();
    const item = byLabel(buildGoMenuItems({}, { pathInput }), 'パスを入力して移動…');
    expect(item.shortcut).toBe('Ctrl+L');
    expect(item.action).toBe(pathInput);
  });
});

describe('buildFilterMenuItems', () => {
  const labels = (items) => items.map((i) => i.label);

  it('絞り込み無し: ✓ は付かず、解除は無効', () => {
    const items = buildFilterMenuItems({ type: 'all', exts: [] });
    expect(labels(items)).toEqual([
      '　フォルダだけ',
      '　ファイルだけ',
      '　拡張子を指定…',
      '　絞り込みを解除',
    ]);
    expect(items[3].disabled).toBe(true);
  });

  it('今の状態に ✓ を付け、指定中の拡張子を見せる', () => {
    const items = buildFilterMenuItems({ type: 'files', exts: ['md', 'txt'] });
    expect(labels(items)).toEqual([
      '　フォルダだけ',
      '✓ ファイルだけ',
      '✓ 拡張子を指定…（.md .txt）',
      '　絞り込みを解除',
    ]);
    expect(items[3].disabled).toBe(false);
  });

  it('キー表記と action を割り当てる', () => {
    const a = { dirs: vi.fn(), files: vi.fn(), ext: vi.fn(), clear: vi.fn() };
    const items = buildFilterMenuItems({ type: 'dirs', exts: [] }, a);
    expect(items.map((i) => i.shortcut)).toEqual(['f → d', 'f → f', 'f → e', 'f → a']);
    expect(items.map((i) => i.action)).toEqual([a.dirs, a.files, a.ext, a.clear]);
  });

  it('ヘルプの絞り込みキーは全部このメニューにある', () => {
    const keys = new Set(shortcuts(buildFilterMenuItems(null)).flatMap(expand));
    const view = SHORTCUTS.find((s) => s.section === '表示');
    const filterRows = view.items.filter(([k]) => k.startsWith('f →'));
    expect(filterRows.length).toBeGreaterThan(0);
    for (const [k] of filterRows) for (const p of expand(k)) expect(keys).toContain(p);
  });
});

describe('ヘルプに載っている操作はメニューからも辿れる', () => {
  const all = [
    ...buildFileMenuItems({ wsl: true }),
    ...buildEditExtraItems({}),
    ...buildGoMenuItems({}),
  ];
  const menuKeys = new Set(shortcuts(all).filter(Boolean).flatMap(expand));

  // 「表示」「ファイル操作（F5 等）」は app.js の表示メニューと editmenu.js が受け持つ。
  // お気に入り（一覧内のキー）・マウス操作・ヘルプ自身は対象外。
  const covered = ['移動', 'ペイン・タブ・サイドバー', '開く', 'パス・名前のコピー', 'モード'];

  // カーソル移動そのもの（j/k/g/G/l/Enter）と右クリックメニュー自体はメニューに置かない
  const SKIP = new Set(['j', 'k', 'g', 'G', 'l', 'Enter', 'Shift+F10', '≣']);

  it.each(covered)('「%s」の各キーがメニューにある', (name) => {
    const sec = SHORTCUTS.find((s) => s.section === name);
    expect(sec).toBeTruthy();
    for (const [keys] of sec.items) {
      // 'o → o / r' や 'Ctrl + T / W' のような束ねた表記は、各キーに展開して確かめる
      const parts = expand(keys);
      for (const k of parts) {
        if (SKIP.has(k)) continue;
        expect(menuKeys, `${name}: ${k}`).toContain(k);
      }
    }
  });
});

/** ヘルプの束ねたキー表記を、メニューの shortcut 表記（空白なし）へ展開する。 */
function expand(keys) {
  const k = keys.replace(/\s/g, '');
  // 「または」は区切り（'/ または Ctrl + F' など）
  const [head, ...alts] = k.split('/');
  const prefix = head.includes('→') ? head.slice(0, head.indexOf('→') + 1) : null;
  const out = [head];
  for (const alt of alts) {
    if (prefix && !alt.includes('→')) out.push(prefix + alt);
    else if (/^[A-Z←→]$/.test(alt) && head.includes('+')) {
      out.push(head.slice(0, head.lastIndexOf('+') + 1) + alt);
    } else out.push(alt);
  }
  return out;
}
