// fileops.js — ファイル操作のオーケストレーション (FR-02, FR-03)
// 安全モードのゲート(NFR-R1)・衝突解決(NFR-R3)をここで一元化する。
// 依存はすべて注入し、Tauri/DOM 非依存で単体テストできるようにする。

const EXISTS = 'EXISTS';

function isExists(e) {
  return String(e && e.message ? e.message : e).includes(EXISTS);
}

/**
 * @param {object} deps
 * @param {() => boolean} deps.canMutate 破壊的操作が許可されるか（safemode.canMutate）
 * @param {object} deps.backend { copyPath, movePath, deleteToTrash, deletePermanent, uniqueName }
 * @param {(name: string) => Promise<'rename'|'overwrite'|'cancel'>} deps.resolveConflict 衝突時の3択
 * @param {(msg: string) => Promise<boolean>|boolean} deps.confirm 完全削除の確認
 * @param {(msg: string) => void} deps.toast 通知
 * @param {() => Promise<void>|void} deps.refresh 完了後のペイン更新
 */
export function createFileOps(deps) {
  const { canMutate, backend, resolveConflict, confirm, toast, refresh } = deps;

  async function gate() {
    if (!canMutate()) {
      toast('安全モードです（切替: Ctrl+Shift+Space）');
      return false;
    }
    return true;
  }

  // 宛先が既存(EXISTS)なら3択（名前変更/上書き/キャンセル）で解決して再実行。
  // run(destName, overwrite) は backend を呼ぶ。
  async function withConflict(entry, destDir, run) {
    try {
      return await run(null, false);
    } catch (e) {
      if (!isExists(e)) throw e;
      const choice = await resolveConflict(entry.name);
      if (choice === 'overwrite') return run(null, true);
      if (choice === 'rename') {
        const name = await backend.uniqueName(destDir, entry.name);
        return run(name, false);
      }
      return null; // cancel
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
        const r = await withConflict(entry, destDir, (name, ow) =>
          backend.copyPath(entry.path, destDir, name, ow),
        );
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
        const r = await withConflict(entry, destDir, (name, ow) =>
          backend.movePath(entry.path, destDir, name, ow),
        );
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
