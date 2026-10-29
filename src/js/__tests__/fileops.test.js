import { describe, it, expect, vi } from 'vitest';
import { createFileOps } from '../core/fileops.js';

function setup({
  canMutate = true,
  conflictResult = { action: 'overwrite' },
  confirmReturn = true,
  promptReturn = 'newname.txt',
  writeBlocked,
  noTrash,
} = {}) {
  const backend = {
    copyPath: vi.fn(async () => '/dest/f'),
    movePath: vi.fn(async () => '/dest/f'),
    deleteToTrash: vi.fn(async () => {}),
    deletePermanent: vi.fn(async () => {}),
    uniqueName: vi.fn(async () => 'f (1).txt'),
    renamePath: vi.fn(async () => '/src/newname.txt'),
    makeDir: vi.fn(async () => '/dir/newdir'),
    makeFile: vi.fn(async () => '/dir/new.txt'),
  };
  const toast = vi.fn();
  const resolveConflict = vi.fn(async () => conflictResult);
  const promptName = vi.fn(async () => promptReturn);
  const confirm = vi.fn(async () => confirmReturn);
  const refresh = vi.fn(async () => {});
  const ops = createFileOps({
    canMutate: () => canMutate,
    backend,
    resolveConflict,
    promptName,
    confirm,
    toast,
    refresh,
    writeBlocked,
    noTrash,
  });
  return { ops, backend, toast, resolveConflict, promptName, confirm, refresh };
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

describe('fileops リネーム', () => {
  it('安全モードでは入力も出さずブロック', async () => {
    const { ops, backend, promptName } = setup({ canMutate: false });
    await ops.rename(entry);
    expect(promptName).not.toHaveBeenCalled();
    expect(backend.renamePath).not.toHaveBeenCalled();
  });

  it('新しい名前で renamePath を呼ぶ', async () => {
    const { ops, backend, refresh } = setup({ promptReturn: 'renamed.txt' });
    await ops.rename(entry);
    expect(backend.renamePath).toHaveBeenCalledWith('/src/f.txt', 'renamed.txt');
    expect(refresh).toHaveBeenCalled();
  });

  it('キャンセル(null)・同名・空文字では何もしない', async () => {
    const c = setup({ promptReturn: null });
    await c.ops.rename(entry);
    expect(c.backend.renamePath).not.toHaveBeenCalled();

    const same = setup({ promptReturn: 'f.txt' });
    await same.ops.rename(entry);
    expect(same.backend.renamePath).not.toHaveBeenCalled();

    const empty = setup({ promptReturn: '   ' });
    await empty.ops.rename(entry);
    expect(empty.backend.renamePath).not.toHaveBeenCalled();
  });

  it('既存名なら EXISTS を分かりやすく通知', async () => {
    const { ops, backend, toast } = setup({ promptReturn: 'taken.txt' });
    backend.renamePath.mockRejectedValueOnce(new Error('EXISTS'));
    await ops.rename(entry);
    expect(toast).toHaveBeenCalledWith('その名前は既に存在します');
  });
});

describe('fileops 新規フォルダ', () => {
  it('安全モードではブロック', async () => {
    const { ops, backend, promptName } = setup({ canMutate: false });
    await ops.makeNewFolder('/dir');
    expect(promptName).not.toHaveBeenCalled();
    expect(backend.makeDir).not.toHaveBeenCalled();
  });

  it('入力名で makeDir を呼ぶ', async () => {
    const { ops, backend, refresh } = setup({ promptReturn: 'work' });
    await ops.makeNewFolder('/dir');
    expect(backend.makeDir).toHaveBeenCalledWith('/dir', 'work');
    expect(refresh).toHaveBeenCalled();
  });

  it('キャンセルなら作成しない', async () => {
    const { ops, backend } = setup({ promptReturn: null });
    await ops.makeNewFolder('/dir');
    expect(backend.makeDir).not.toHaveBeenCalled();
  });
});

describe('fileops 新規ファイル', () => {
  it('安全モードではブロック', async () => {
    const { ops, backend, promptName } = setup({ canMutate: false });
    expect(await ops.makeNewFile('/dir')).toBeNull();
    expect(promptName).not.toHaveBeenCalled();
    expect(backend.makeFile).not.toHaveBeenCalled();
  });

  it('既定名を拡張子つきで出し、入力名（前後の空白は除く）で makeFile を呼ぶ', async () => {
    const { ops, backend, promptName, refresh, toast } = setup({ promptReturn: ' memo.md ' });
    const created = await ops.makeNewFile('/dir');
    expect(promptName).toHaveBeenCalledWith('新しいファイル', '新しいファイル.txt');
    expect(backend.makeFile).toHaveBeenCalledWith('/dir', 'memo.md');
    expect(backend.makeDir).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('ファイルを作成しました');
    // カーソルを合わせられるよう、作ったパスを返す
    expect(created).toBe('/dir/new.txt');
  });

  it('キャンセル・空の名前なら作成しない', async () => {
    for (const promptReturn of [null, '', '   ']) {
      const { ops, backend } = setup({ promptReturn });
      expect(await ops.makeNewFile('/dir')).toBeNull();
      expect(backend.makeFile).not.toHaveBeenCalled();
    }
  });

  it('場所が無ければ何もしない', async () => {
    const { ops, promptName } = setup();
    expect(await ops.makeNewFile(null)).toBeNull();
    expect(promptName).not.toHaveBeenCalled();
  });

  it('既存の名前なら上書きせず知らせる', async () => {
    const { ops, backend, toast, refresh } = setup({ promptReturn: 'taken.txt' });
    backend.makeFile.mockRejectedValueOnce(new Error('EXISTS'));
    expect(await ops.makeNewFile('/dir')).toBeNull();
    expect(toast).toHaveBeenCalledWith('その名前は既に存在します');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('その他の失敗は理由を出す', async () => {
    const { ops, backend, toast } = setup({ promptReturn: 'x.txt' });
    backend.makeFile.mockRejectedValueOnce('名前が不正です');
    expect(await ops.makeNewFile('/dir')).toBeNull();
    expect(toast).toHaveBeenCalledWith('作成失敗: 名前が不正です');
  });

  it('新規フォルダも作ったパスを返す', async () => {
    const { ops } = setup({ promptReturn: 'work' });
    expect(await ops.makeNewFolder('/dir')).toBe('/dir/newdir');
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

// ── 複数選択への一括操作 (FR-11) ────────────────────────────
const entries = (...names) => names.map((n) => ({ name: n, path: '/src/' + n }));

describe('fileops 複数件の一括操作', () => {
  it('配列を渡すと全件にバックエンドを呼ぶ', async () => {
    const { ops, backend } = setup();
    await ops.copy(entries('a.txt', 'b.txt', 'c.txt'), '/dest');
    expect(backend.copyPath).toHaveBeenCalledTimes(3);
    expect(backend.copyPath.mock.calls.map((c) => c[0])).toEqual([
      '/src/a.txt',
      '/src/b.txt',
      '/src/c.txt',
    ]);
  });

  it('refresh は最後に1回だけ（件数分走らせない）', async () => {
    const { ops, refresh } = setup();
    await ops.copy(entries('a.txt', 'b.txt', 'c.txt'), '/dest');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('複数件のトーストは件数で伝える', async () => {
    const { ops, toast } = setup();
    await ops.move(entries('a.txt', 'b.txt'), '/dest');
    expect(toast).toHaveBeenCalledWith('2 件移動しました');
  });

  it('1件のときは従来どおりの文言のまま', async () => {
    const { ops, toast } = setup();
    await ops.copy(entries('a.txt'), '/dest');
    expect(toast).toHaveBeenCalledWith('コピーしました');
  });

  it('単体の entry も引き続き受け付ける（後方互換）', async () => {
    const { ops, backend, toast } = setup();
    await ops.trash(entry);
    expect(backend.deleteToTrash).toHaveBeenCalledWith('/src/f.txt');
    expect(toast).toHaveBeenCalledWith('ゴミ箱へ移動しました');
  });

  it('空配列では何もしない', async () => {
    const { ops, backend, toast, refresh } = setup();
    await ops.copy([], '/dest');
    expect(backend.copyPath).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('安全モードなら1件も実行しない', async () => {
    const { ops, backend } = setup({ canMutate: false });
    await ops.trash(entries('a.txt', 'b.txt'));
    expect(backend.deleteToTrash).not.toHaveBeenCalled();
  });

  it('1件失敗しても残りは続行し、結果をまとめて伝える', async () => {
    const { ops, backend, toast, refresh } = setup();
    backend.deleteToTrash
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {
        throw new Error('権限がありません');
      })
      .mockImplementationOnce(async () => {});
    await ops.trash(entries('a.txt', 'b.txt', 'c.txt'));
    expect(backend.deleteToTrash).toHaveBeenCalledTimes(3);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('2 件ゴミ箱へ移動しました'));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('1 件失敗'));
    expect(refresh).toHaveBeenCalledTimes(1); // 成功が1件でもあれば再読込する
  });

  it('全件失敗なら refresh しない', async () => {
    const { ops, backend, toast, refresh } = setup();
    backend.deleteToTrash.mockImplementation(async () => {
      throw new Error('だめ');
    });
    await ops.trash(entries('a.txt', 'b.txt'));
    expect(refresh).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('2 件失敗'));
  });

  it('衝突でキャンセルした分はスキップし、残りは続ける', async () => {
    // 1件のキャンセルで全部止まると、残りをやり直す羽目になって驚きが大きい
    const { ops, backend, toast } = setup({ conflictResult: { action: 'cancel' } });
    backend.copyPath
      .mockImplementationOnce(async () => {
        throw new Error('EXISTS');
      })
      .mockImplementationOnce(async () => '/dest/b');
    await ops.copy(entries('a.txt', 'b.txt'), '/dest');
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('1 件スキップ'));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('1 件コピーしました'));
  });

  it('完全削除の確認は最初に1回だけ', async () => {
    const { ops, confirm, backend } = setup();
    await ops.deletePermanent(entries('a.txt', 'b.txt', 'c.txt'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(backend.deletePermanent).toHaveBeenCalledTimes(3);
  });

  it('完全削除の確認文は4件以上なら件数で丸める', async () => {
    const { ops, confirm } = setup();
    await ops.deletePermanent(entries('a', 'b', 'c', 'd', 'e'));
    expect(confirm.mock.calls[0][0]).toContain('ほか 2 件');
  });

  it('完全削除の確認を断れば1件も消さない', async () => {
    const { ops, backend } = setup({ confirmReturn: false });
    await ops.deletePermanent(entries('a.txt', 'b.txt'));
    expect(backend.deletePermanent).not.toHaveBeenCalled();
  });
});

describe('fileops リモート接続の書き込み許可 (FR-20)', () => {
  // sftp:// のうち "w" だけ書き込みを許可している想定
  const writeBlocked = (paths) => {
    const ro = paths.find((p) => p.startsWith('sftp://') && !p.startsWith('sftp://w/'));
    return ro ? `閲覧のみ: ${ro}` : null;
  };
  const noTrash = (e) => e.path.startsWith('sftp://');
  const remote = { name: 'r.txt', path: 'sftp://ro/r.txt' };

  it('閲覧のみの宛先へのコピーはバックエンドを呼ばず理由を出す', async () => {
    const { ops, backend, toast } = setup({ writeBlocked });
    await ops.copy(entry, 'sftp://ro/dir');
    expect(backend.copyPath).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('閲覧のみ: sftp://ro/dir');
  });

  it('閲覧のみのリモートからローカルへのコピーは読むだけなので通す', async () => {
    const { ops, backend } = setup({ writeBlocked });
    await ops.copy(remote, '/dest');
    expect(backend.copyPath).toHaveBeenCalledWith('sftp://ro/r.txt', '/dest', null, false);
  });

  it('移動は元を消すので元の接続にも許可が要る', async () => {
    const { ops, backend } = setup({ writeBlocked });
    await ops.move(remote, '/dest');
    expect(backend.movePath).not.toHaveBeenCalled();
    await ops.move({ name: 'x', path: 'sftp://w/x' }, '/dest');
    expect(backend.movePath).toHaveBeenCalledTimes(1);
  });

  it('改名・新規フォルダ・完全削除も対象の接続で判定する', async () => {
    const { ops, backend } = setup({ writeBlocked });
    await ops.rename(remote);
    await ops.makeNewFolder('sftp://ro/d');
    await ops.makeNewFile('sftp://ro/d');
    await ops.deletePermanent(remote);
    expect(backend.renamePath).not.toHaveBeenCalled();
    expect(backend.makeDir).not.toHaveBeenCalled();
    expect(backend.makeFile).not.toHaveBeenCalled();
    expect(backend.deletePermanent).not.toHaveBeenCalled();
  });

  it('安全モードの判定が先（理由は安全モード）', async () => {
    const { ops, toast } = setup({ canMutate: false, writeBlocked });
    await ops.copy(entry, 'sftp://ro/dir');
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('安全モード'));
  });

  it('リモートの「ゴミ箱へ」は完全削除の確認に回す', async () => {
    const { ops, backend, confirm } = setup({ writeBlocked, noTrash });
    const w = { name: 'x', path: 'sftp://w/x' };
    await ops.trash([w, entry]);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('ゴミ箱がありません'));
    expect(backend.deleteToTrash).not.toHaveBeenCalled();
    expect(backend.deletePermanent).toHaveBeenCalledTimes(2);
  });

  it('確認で断ればリモートは消さない', async () => {
    const { ops, backend } = setup({ writeBlocked, noTrash, confirmReturn: false });
    await ops.trash({ name: 'x', path: 'sftp://w/x' });
    expect(backend.deletePermanent).not.toHaveBeenCalled();
  });

  it('ローカルだけなら従来どおりゴミ箱へ', async () => {
    const { ops, backend, confirm } = setup({ writeBlocked, noTrash });
    await ops.trash(entry);
    expect(backend.deleteToTrash).toHaveBeenCalledWith('/src/f.txt');
    expect(confirm).not.toHaveBeenCalled();
  });
});
