// fileops.js — ファイル操作のオーケストレーション (FR-02, FR-03)
// 安全モードのゲート(NFR-R1)・上書き確認(NFR-R3)をここで一元化する。
// 依存はすべて注入し、Tauri/DOM 非依存で単体テストできるようにする。

const EXISTS = 'EXISTS';

/**
 * @param {object} deps
 * @param {() => boolean} deps.canMutate 破壊的操作が許可されるか（safemode.canMutate）
 * @param {object} deps.backend { copyPath, movePath, deleteToTrash, deletePermanent }
 * @param {(msg: string) => Promise<boolean>|boolean} deps.confirm 確認ダイアログ
 * @param {(msg: string) => void} deps.toast 通知
 * @param {() => Promise<void>|void} deps.refresh 完了後のペイン更新
 */
export function createFileOps(deps) {
  const { canMutate, backend, confirm, toast, refresh } = deps;

  async function gate() {
    if (!canMutate()) {
      toast('安全モードです（切替: Ctrl+Shift+Space）');
      return false;
    }
    return true;
  }

  // 宛先が既存(EXISTS)なら確認して overwrite で再実行
  async function withOverwrite(run) {
    try {
      return await run(false);
    } catch (e) {
      if (String(e && e.message ? e.message : e).includes(EXISTS)) {
        const ok = await confirm('同名の項目があります。上書きしますか？');
        if (ok) return run(true);
        return null;
      }
      throw e;
    }
  }

  async function done(message) {
    toast(message);
    await refresh();
  }

  return {
    /** アクティブペインの entry を destDir へコピー */
    async copy(entry, destDir) {
      if (!entry || !destDir) return;
      if (!(await gate())) return;
      try {
        const r = await withOverwrite((ow) => backend.copyPath(entry.path, destDir, ow));
        if (r !== null) await done('コピーしました');
      } catch (e) {
        toast('コピー失敗: ' + (e && e.message ? e.message : e));
      }
    },

    /** アクティブペインの entry を destDir へ移動 */
    async move(entry, destDir) {
      if (!entry || !destDir) return;
      if (!(await gate())) return;
      try {
        const r = await withOverwrite((ow) => backend.movePath(entry.path, destDir, ow));
        if (r !== null) await done('移動しました');
      } catch (e) {
        toast('移動失敗: ' + (e && e.message ? e.message : e));
      }
    },

    /** entry をゴミ箱へ（既定の削除, NFR-R2） */
    async trash(entry) {
      if (!entry) return;
      if (!(await gate())) return;
      try {
        await backend.deleteToTrash(entry.path);
        await done('ゴミ箱へ移動しました');
      } catch (e) {
        toast('削除失敗: ' + (e && e.message ? e.message : e));
      }
    },

    /** entry を完全削除（確認必須, NFR-R3） */
    async deletePermanent(entry) {
      if (!entry) return;
      if (!(await gate())) return;
      const ok = await confirm(
        `完全に削除します（元に戻せません）:\n${entry.name}\nよろしいですか？`,
      );
      if (!ok) return;
      try {
        await backend.deletePermanent(entry.path);
        await done('完全に削除しました');
      } catch (e) {
        toast('削除失敗: ' + (e && e.message ? e.message : e));
      }
    },
  };
}
