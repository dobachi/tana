import { describe, it, expect, vi } from 'vitest';
import {
  createExtApps,
  validateApp,
  normalizeApp,
  normalizeTarget,
  serialize,
  hydrate,
  pickByIndex,
  describeAppError,
  loadStoredExtApps,
  storeExtApps,
  QUICK_SLOTS,
} from '../core/extapps.js';

describe('validateApp', () => {
  it('コマンドがあれば OK', () => {
    expect(validateApp({ command: 'code' })).toEqual({ ok: true });
    expect(validateApp({ name: 'VS Code', command: 'code' })).toEqual({ ok: true });
  });

  it('空・空白のみのコマンドは弾く', () => {
    expect(validateApp({ command: '' }).ok).toBe(false);
    expect(validateApp({ command: '   ' }).ok).toBe(false);
    expect(validateApp({}).ok).toBe(false);
    expect(validateApp(null).ok).toBe(false);
  });

  it('空白を含むコマンドは通す（macOS のアプリ名・Windows のフルパス）', () => {
    expect(validateApp({ command: 'Visual Studio Code' }).ok).toBe(true);
    expect(validateApp({ command: 'C:\\Program Files\\7-Zip\\7zFM.exe' }).ok).toBe(true);
    expect(validateApp({ command: '/usr/bin/gimp' }).ok).toBe(true);
  });

  it('" は弾く（Windows は cmd /c start "" "<app>" に素通しするため）', () => {
    const r = validateApp({ command: 'x" & calc & "' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('"');
    expect(validateApp({ name: 'a"b', command: 'code' }).ok).toBe(false);
  });

  it('制御文字・改行は弾く', () => {
    expect(validateApp({ command: 'code\nrm -rf /' }).ok).toBe(false);
    expect(validateApp({ command: 'code\t-x' }).ok).toBe(false);
    expect(validateApp({ command: 'code\u0000' }).ok).toBe(false);
    expect(validateApp({ name: 'a\nb', command: 'code' }).ok).toBe(false);
  });

  it('長すぎる値は弾く', () => {
    expect(validateApp({ command: 'a'.repeat(261) }).ok).toBe(false);
    expect(validateApp({ command: 'code', name: 'あ'.repeat(61) }).ok).toBe(false);
    expect(validateApp({ command: 'a'.repeat(260) }).ok).toBe(true);
  });
});

describe('normalizeApp', () => {
  it('前後の空白を落とし、表示名が無ければコマンドを使う', () => {
    expect(normalizeApp({ command: '  code  ' })).toEqual({
      name: 'code',
      command: 'code',
      target: 'auto',
    });
    expect(normalizeApp({ name: ' VS Code ', command: 'code' })).toEqual({
      name: 'VS Code',
      command: 'code',
      target: 'auto',
    });
    expect(normalizeApp({ name: '   ', command: 'gimp' })).toEqual({
      name: 'gimp',
      command: 'gimp',
      target: 'auto',
    });
  });

  it('妥当でなければ null', () => {
    expect(normalizeApp({ command: '' })).toBeNull();
    expect(normalizeApp({ command: 'a"b' })).toBeNull();
  });

  it('起動先を保持し、未知の値・未指定は auto に倒す (WSL)', () => {
    expect(normalizeApp({ command: 'notepad.exe', target: 'windows' }).target).toBe('windows');
    expect(normalizeApp({ command: 'gimp', target: 'linux' }).target).toBe('linux');
    expect(normalizeApp({ command: 'gimp', target: 'mac' }).target).toBe('auto');
    expect(normalizeApp({ command: 'gimp' }).target).toBe('auto');
  });
});

describe('normalizeTarget', () => {
  it('既知の値はそのまま、それ以外は auto', () => {
    expect(normalizeTarget('windows')).toBe('windows');
    expect(normalizeTarget('linux')).toBe('linux');
    expect(normalizeTarget('auto')).toBe('auto');
    expect(normalizeTarget(undefined)).toBe('auto');
    expect(normalizeTarget(null)).toBe('auto');
    expect(normalizeTarget(42)).toBe('auto');
  });
});

describe('serialize / hydrate', () => {
  it('id を落として往復できる', () => {
    const list = [{ id: 'app-1', name: 'VS Code', command: 'code', target: 'linux' }];
    expect(serialize(list)).toEqual([{ name: 'VS Code', command: 'code', target: 'linux' }]);
    expect(hydrate(serialize(list))).toEqual([
      { name: 'VS Code', command: 'code', target: 'linux' },
    ]);
  });

  it('target 無しの旧い保存値も読める（後方互換）', () => {
    expect(hydrate([{ name: 'VS Code', command: 'code' }])).toEqual([
      { name: 'VS Code', command: 'code', target: 'auto' },
    ]);
    expect(serialize([{ name: 'a', command: 'a' }])).toEqual([
      { name: 'a', command: 'a', target: 'auto' },
    ]);
  });

  it('壊れた保存値は捨てる', () => {
    expect(hydrate(null)).toEqual([]);
    expect(hydrate('nope')).toEqual([]);
    expect(hydrate([{ command: '' }, { command: 'a"b' }, null, { command: 'gimp' }])).toEqual([
      { name: 'gimp', command: 'gimp', target: 'auto' },
    ]);
  });
});

describe('pickByIndex', () => {
  const list = [
    { name: 'a', command: 'a' },
    { name: 'b', command: 'b' },
  ];
  it('1 始まりで引く', () => {
    expect(pickByIndex(list, 1).command).toBe('a');
    expect(pickByIndex(list, '2').command).toBe('b');
  });
  it('範囲外・未登録・不正入力は null', () => {
    expect(pickByIndex(list, 3)).toBeNull();
    expect(pickByIndex(list, 0)).toBeNull();
    expect(pickByIndex(list, -1)).toBeNull();
    expect(pickByIndex(list, QUICK_SLOTS + 1)).toBeNull();
    expect(pickByIndex(list, 'x')).toBeNull();
    expect(pickByIndex(null, 1)).toBeNull();
  });
});

describe('createExtApps', () => {
  it('追加・削除・並べ替えができ、購読者へ通知する', () => {
    const store = createExtApps();
    const seen = vi.fn();
    store.subscribe(seen);

    expect(store.add({ name: 'VS Code', command: 'code' }).ok).toBe(true);
    expect(store.add({ command: 'gimp' }).ok).toBe(true);
    expect(store.list().map((a) => a.command)).toEqual(['code', 'gimp']);
    expect(seen).toHaveBeenCalledTimes(2);

    expect(store.move(store.list()[1].id, -1)).toBe(true);
    expect(store.list().map((a) => a.command)).toEqual(['gimp', 'code']);

    expect(store.remove(store.list()[0].id)).toBe(true);
    expect(store.list().map((a) => a.command)).toEqual(['code']);
  });

  it('不正な追加は理由を返し、一覧を変えない', () => {
    const store = createExtApps();
    const r = store.add({ command: '' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
    expect(store.list()).toEqual([]);
  });

  it('完全に同じ登録は拒否する', () => {
    const store = createExtApps([{ name: 'VS Code', command: 'code' }]);
    expect(store.add({ name: 'VS Code', command: 'code' }).ok).toBe(false);
    // 表示名が違えば別エントリとして許す（同じアプリを別用途で並べたいことがある）
    expect(store.add({ name: 'エディタ', command: 'code' }).ok).toBe(true);
    expect(store.list()).toHaveLength(2);
  });

  it('存在しない id の削除・端での移動は false', () => {
    const store = createExtApps([{ name: 'a', command: 'a' }]);
    expect(store.remove('nope')).toBe(false);
    expect(store.move(store.list()[0].id, -1)).toBe(false);
    expect(store.move(store.list()[0].id, 1)).toBe(false);
    expect(store.move('nope', 1)).toBe(false);
  });

  it('list() は複製を返すので外から壊せない', () => {
    const store = createExtApps([{ name: 'a', command: 'a' }]);
    store.list().push({ name: 'x', command: 'x' });
    expect(store.list()).toHaveLength(1);
  });

  it('保存値から復元し、保存用に serialize できる', () => {
    const store = createExtApps([
      { name: 'VS Code', command: 'code' },
      { command: '' }, // 壊れた値は落ちる
    ]);
    expect(store.serialize()).toEqual([{ name: 'VS Code', command: 'code', target: 'auto' }]);
  });

  it('setTarget で起動先を変えられ、購読者へ通知する (WSL)', () => {
    const store = createExtApps([{ name: 'メモ帳', command: 'notepad.exe' }]);
    const seen = vi.fn();
    store.subscribe(seen);
    const id = store.list()[0].id;

    expect(store.setTarget(id, 'windows')).toBe(true);
    expect(store.list()[0].target).toBe('windows');
    expect(seen).toHaveBeenCalledTimes(1);

    expect(store.setTarget(id, 'windows')).toBe(false); // 同値は通知しない
    expect(store.setTarget('nope', 'linux')).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);

    // 未知の値は auto に倒す
    expect(store.setTarget(id, 'mac')).toBe(true);
    expect(store.list()[0].target).toBe('auto');
  });
});

describe('localStorage 永続化', () => {
  it('保存して読み戻せる', () => {
    localStorage.clear();
    storeExtApps([{ id: 'app-1', name: 'VS Code', command: 'code', target: 'windows' }]);
    expect(loadStoredExtApps()).toEqual([{ name: 'VS Code', command: 'code', target: 'windows' }]);
  });

  it('壊れた保存値は空配列', () => {
    localStorage.setItem('tana.extapps', '{oops');
    expect(loadStoredExtApps()).toEqual([]);
    localStorage.setItem('tana.extapps', '{"a":1}');
    expect(loadStoredExtApps()).toEqual([]);
    localStorage.clear();
  });
});

describe('describeAppError', () => {
  it('見つからない系はコマンド名の確認を促す', () => {
    const msg = describeAppError('code', new Error('No such file or directory (os error 2)'));
    expect(msg).toContain('code');
    expect(msg).toContain('見つかりません');
  });

  it('その他の理由はそのまま添える', () => {
    expect(describeAppError('gimp', new Error('permission denied'))).toContain('permission denied');
  });

  it('アプリ未指定・理由なしでも文になる', () => {
    expect(describeAppError('', null)).toBe('既定のアプリ で開けませんでした');
    expect(describeAppError('code', null)).toBe('code で開けませんでした');
  });
});
