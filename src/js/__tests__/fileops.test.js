import { describe, it, expect, vi } from 'vitest';
import { createFileOps } from '../core/fileops.js';

function setup({ canMutate = true, confirmReturn = true } = {}) {
  const backend = {
    copyPath: vi.fn(async () => '/dest/f'),
    movePath: vi.fn(async () => '/dest/f'),
    deleteToTrash: vi.fn(async () => {}),
    deletePermanent: vi.fn(async () => {}),
  };
  const toast = vi.fn();
  const confirm = vi.fn(async () => confirmReturn);
  const refresh = vi.fn(async () => {});
  const ops = createFileOps({ canMutate: () => canMutate, backend, confirm, toast, refresh });
  return { ops, backend, toast, confirm, refresh };
}

const entry = { name: 'f', path: '/src/f' };

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

describe('fileops 操作モード', () => {
  it('copy はバックエンドを呼び、完了で refresh する', async () => {
    const { ops, backend, refresh, toast } = setup();
    await ops.copy(entry, '/dest');
    expect(backend.copyPath).toHaveBeenCalledWith('/src/f', '/dest', false);
    expect(refresh).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('コピーしました');
  });

  it('EXISTS のとき確認OKなら overwrite=true で再実行', async () => {
    const { ops, backend, confirm } = setup({ confirmReturn: true });
    backend.copyPath.mockRejectedValueOnce(new Error('EXISTS')).mockResolvedValueOnce('/dest/f');
    await ops.copy(entry, '/dest');
    expect(confirm).toHaveBeenCalled();
    expect(backend.copyPath).toHaveBeenNthCalledWith(2, '/src/f', '/dest', true);
  });

  it('EXISTS のとき確認キャンセルなら上書きしない', async () => {
    const { ops, backend, refresh } = setup({ confirmReturn: false });
    backend.copyPath.mockRejectedValueOnce(new Error('EXISTS'));
    await ops.copy(entry, '/dest');
    expect(backend.copyPath).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('trash はゴミ箱へ移動し refresh する', async () => {
    const { ops, backend, refresh } = setup();
    await ops.trash(entry);
    expect(backend.deleteToTrash).toHaveBeenCalledWith('/src/f');
    expect(refresh).toHaveBeenCalled();
  });

  it('完全削除は確認必須。OKで削除、キャンセルで何もしない', async () => {
    const yes = setup({ confirmReturn: true });
    await yes.ops.deletePermanent(entry);
    expect(yes.backend.deletePermanent).toHaveBeenCalledWith('/src/f');

    const no = setup({ confirmReturn: false });
    await no.ops.deletePermanent(entry);
    expect(no.backend.deletePermanent).not.toHaveBeenCalled();
  });

  it('対象が無い場合は何もしない', async () => {
    const { ops, backend } = setup();
    await ops.copy(null, '/dest');
    await ops.trash(null);
    expect(backend.copyPath).not.toHaveBeenCalled();
    expect(backend.deleteToTrash).not.toHaveBeenCalled();
  });
});
