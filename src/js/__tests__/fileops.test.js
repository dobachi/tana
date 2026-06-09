import { describe, it, expect, vi } from 'vitest';
import { createFileOps } from '../core/fileops.js';

function setup({
  canMutate = true,
  conflictResult = { action: 'overwrite' },
  confirmReturn = true,
} = {}) {
  const backend = {
    copyPath: vi.fn(async () => '/dest/f'),
    movePath: vi.fn(async () => '/dest/f'),
    deleteToTrash: vi.fn(async () => {}),
    deletePermanent: vi.fn(async () => {}),
    uniqueName: vi.fn(async () => 'f (1).txt'),
  };
  const toast = vi.fn();
  const resolveConflict = vi.fn(async () => conflictResult);
  const confirm = vi.fn(async () => confirmReturn);
  const refresh = vi.fn(async () => {});
  const ops = createFileOps({
    canMutate: () => canMutate,
    backend,
    resolveConflict,
    confirm,
    toast,
    refresh,
  });
  return { ops, backend, toast, resolveConflict, confirm, refresh };
}

const entry = { name: 'f.txt', path: '/src/f.txt' };

describe('fileops 安全モードゲート', () => {
  it('安全モードでは copy がバックエンドを呼ばず警告する', async () => {
    const { ops, backend, toast, refresh } = setup({ canMutate: false });
    await ops.copy(entry, '/dest');
    expect(backend.copyPath).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('安全モード'));
  });

  it('安全モードでは trash / 完全削除もブロックする', async () => {
    const { ops, backend } = setup({ canMutate: false });
    await ops.trash(entry);
    await ops.deletePermanent(entry);
    expect(backend.deleteToTrash).not.toHaveBeenCalled();
    expect(backend.deletePermanent).not.toHaveBeenCalled();
  });
});

describe('fileops 操作モード（衝突なし）', () => {
  it('copy はバックエンドを呼び、完了で refresh する', async () => {
    const { ops, backend, refresh, toast } = setup();
    await ops.copy(entry, '/dest');
    expect(backend.copyPath).toHaveBeenCalledWith('/src/f.txt', '/dest', null, false);
    expect(refresh).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('コピーしました');
  });

  it('trash はゴミ箱へ移動し refresh する', async () => {
    const { ops, backend, refresh } = setup();
    await ops.trash(entry);
    expect(backend.deleteToTrash).toHaveBeenCalledWith('/src/f.txt');
    expect(refresh).toHaveBeenCalled();
  });

  it('対象が無い場合は何もしない', async () => {
    const { ops, backend } = setup();
    await ops.copy(null, '/dest');
    await ops.trash(null);
    expect(backend.copyPath).not.toHaveBeenCalled();
    expect(backend.deleteToTrash).not.toHaveBeenCalled();
  });
});

describe('fileops 衝突解決（入力付き3択）', () => {
  it('衝突時はインクリメント名を提案として渡す', async () => {
    const { ops, backend, resolveConflict } = setup({ conflictResult: { action: 'cancel' } });
    backend.copyPath.mockRejectedValueOnce(new Error('EXISTS'));
    await ops.copy(entry, '/dest');
    expect(backend.uniqueName).toHaveBeenCalledWith('/dest', 'f.txt');
    expect(resolveConflict).toHaveBeenCalledWith('f.txt', 'f (1).txt');
  });

  it('上書き選択 → overwrite=true で再実行', async () => {
    const { ops, backend } = setup({ conflictResult: { action: 'overwrite' } });
    backend.copyPath
      .mockRejectedValueOnce(new Error('EXISTS'))
      .mockResolvedValueOnce('/dest/f.txt');
    await ops.copy(entry, '/dest');
    expect(backend.copyPath).toHaveBeenNthCalledWith(2, '/src/f.txt', '/dest', null, true);
  });

  it('名前変更（任意入力）→ 入力名を宛先名に指定して再実行', async () => {
    const { ops, backend } = setup({ conflictResult: { action: 'rename', name: 'myname.txt' } });
    backend.copyPath
      .mockRejectedValueOnce(new Error('EXISTS'))
      .mockResolvedValueOnce('/dest/myname.txt');
    await ops.copy(entry, '/dest');
    expect(backend.copyPath).toHaveBeenNthCalledWith(2, '/src/f.txt', '/dest', 'myname.txt', false);
  });

  it('名前が空なら提案名（インクリメント）を使う', async () => {
    const { ops, backend } = setup({ conflictResult: { action: 'rename', name: '  ' } });
    backend.copyPath
      .mockRejectedValueOnce(new Error('EXISTS'))
      .mockResolvedValueOnce('/dest/f (1).txt');
    await ops.copy(entry, '/dest');
    expect(backend.copyPath).toHaveBeenNthCalledWith(2, '/src/f.txt', '/dest', 'f (1).txt', false);
  });

  it('入力名も衝突したら再プロンプト（最終的にキャンセル）', async () => {
    const backend = {
      copyPath: vi
        .fn()
        .mockRejectedValueOnce(new Error('EXISTS'))
        .mockRejectedValueOnce(new Error('EXISTS')),
      uniqueName: vi.fn(async () => 'f (1).txt'),
    };
    const resolveConflict = vi
      .fn()
      .mockResolvedValueOnce({ action: 'rename', name: 'taken.txt' })
      .mockResolvedValueOnce({ action: 'cancel' });
    const refresh = vi.fn(async () => {});
    const ops = createFileOps({
      canMutate: () => true,
      backend,
      resolveConflict,
      confirm: vi.fn(),
      toast: vi.fn(),
      refresh,
    });
    await ops.copy(entry, '/dest');
    expect(resolveConflict).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('キャンセル選択 → 再実行せず refresh しない', async () => {
    const { ops, backend, refresh } = setup({ conflictResult: { action: 'cancel' } });
    backend.copyPath.mockRejectedValueOnce(new Error('EXISTS'));
    await ops.copy(entry, '/dest');
    expect(backend.copyPath).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('move も同様に衝突解決する（名前変更）', async () => {
    const { ops, backend } = setup({ conflictResult: { action: 'rename', name: 'f (1).txt' } });
    backend.movePath
      .mockRejectedValueOnce(new Error('EXISTS'))
      .mockResolvedValueOnce('/dest/f (1).txt');
    await ops.move(entry, '/dest');
    expect(backend.movePath).toHaveBeenNthCalledWith(2, '/src/f.txt', '/dest', 'f (1).txt', false);
  });
});

describe('fileops 完全削除', () => {
  it('確認OKで削除、キャンセルで何もしない', async () => {
    const yes = setup({ confirmReturn: true });
    await yes.ops.deletePermanent(entry);
    expect(yes.backend.deletePermanent).toHaveBeenCalledWith('/src/f.txt');

    const no = setup({ confirmReturn: false });
    await no.ops.deletePermanent(entry);
    expect(no.backend.deletePermanent).not.toHaveBeenCalled();
  });
});
