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
 * @param {object} deps.backend { copyPath, movePath, deleteToTrash, deletePermanent, uniqueName, renamePath, makeDir }
 * @param {(name: string, suggested: string) => Promise<{action: string, name?: string}>} deps.resolveConflict 衝突時の3択
 * @param {(title: string, def?: string) => Promise<string|null>} deps.promptName 名前入力
 * @param {(msg: string) => Promise<boolean>|boolean} deps.confirm 完全削除の確認
 * @param {(msg: string) => void} deps.toast 通知
 * @param {() => Promise<void>|void} deps.refresh 完了後のペイン更新
 */
export function createFileOps(deps) {
  const { canMutate, backend, resolveConflict, promptName, confirm, toast, refresh } = deps;

  async function gate() {
    if (!canMutate()) {
      toast('安全モードです（切替: Ctrl+Shift+Space）');
      return false;
    }
    return true;
  }

  // 宛先が既存(EXISTS)なら3択（名前変更/上書き/キャンセル）で解決して再実行。
  // run(destName, overwrite) は backend を呼ぶ。
  // 名前変更は任意入力可（既定はインクリメント名）。入力名も衝突したら再プロンプト。
  async function withConflict(entry, destDir, run) {
    try {
      return await run(null, false);
    } catch (e) {
      if (!isExists(e)) throw e;
    }
    let conflictName = entry.name;
    for (;;) {
      const suggested = await backend.uniqueName(destDir, conflictName);
      const res = (await resolveConflict(conflictName, suggested)) || { action: 'cancel' };
      if (res.action === 'cancel') return null;
      if (res.action === 'overwrite') return run(null, true);
      // rename: 入力名（空なら提案名）で実行
      const name = (res.name && res.name.trim()) || suggested;
      try {
        return await run(name, false);
      } catch (e) {
        if (!isExists(e)) throw e;
        conflictName = name; // 入力名も衝突 → その名前を基準に再提案
      }
    }
  }

  async function done(message) {
    toast(message);
    await refresh();
  }

  /** entry / 配列 / null をエントリ配列に正規化する */
  function asList(entryOrList) {
    if (!entryOrList) return [];
    return Array.isArray(entryOrList) ? entryOrList.filter(Boolean) : [entryOrList];
  }

  /**
   * 複数件の実行結果をまとめてトースト1回・refresh1回にする。
   *
   * 1件のときは従来どおりの文言（「コピーしました」）を出し、複数件のときだけ
   * 件数入りにする。衝突ダイアログでキャンセルした分は「スキップ」として数え、
   * 残りの処理は続ける（1件のキャンセルで全部止まる方が驚きが大きいため）。
   *
   * @param {{ok: number, skipped: number, failed: string[]}} r
   * @param {string} verb 「コピー」など
   * @param {string} singleMessage 1件成功時の従来メッセージ
   */
  async function reportBatch(r, verb, singleMessage) {
    const parts = [];
    if (r.ok > 0)
      parts.push(
        r.ok === 1 && !r.skipped && !r.failed.length ? singleMessage : `${r.ok} 件${verb}しました`,
      );
    if (r.skipped > 0) parts.push(`${r.skipped} 件スキップ`);
    if (r.failed.length > 0) parts.push(`${r.failed.length} 件失敗: ${r.failed[0]}`);
    if (parts.length === 0) return;
    if (r.ok > 0) await done(parts.join(' / '));
    else toast(parts.join(' / '));
  }

  /** 各エントリに op を適用し、成功/スキップ/失敗を集計する */
  async function runBatch(list, op) {
    const r = { ok: 0, skipped: 0, failed: [] };
    for (const entry of list) {
      try {
        const res = await op(entry);
        if (res === null) r.skipped += 1;
        else r.ok += 1;
      } catch (e) {
        r.failed.push(e && e.message ? e.message : String(e));
      }
    }
    return r;
  }

  return {
    /** entry（単体または配列）を destDir へコピー */
    async copy(entryOrList, destDir) {
      const list = asList(entryOrList);
      if (!list.length || !destDir) return;
      if (!(await gate())) return;
      const r = await runBatch(list, (entry) =>
        withConflict(entry, destDir, (name, ow) => backend.copyPath(entry.path, destDir, name, ow)),
      );
      await reportBatch(r, 'コピー', 'コピーしました');
    },

    /** entry（単体または配列）を destDir へ移動 */
    async move(entryOrList, destDir) {
      const list = asList(entryOrList);
      if (!list.length || !destDir) return;
      if (!(await gate())) return;
      const r = await runBatch(list, (entry) =>
        withConflict(entry, destDir, (name, ow) => backend.movePath(entry.path, destDir, name, ow)),
      );
      await reportBatch(r, '移動', '移動しました');
    },

    /** entry（単体または配列）をゴミ箱へ（既定の削除, NFR-R2） */
    async trash(entryOrList) {
      const list = asList(entryOrList);
      if (!list.length) return;
      if (!(await gate())) return;
      const r = await runBatch(list, (entry) => backend.deleteToTrash(entry.path));
      await reportBatch(r, 'ゴミ箱へ移動', 'ゴミ箱へ移動しました');
    },

    /** entry の名前を変更（同じフォルダ内, FR-03） */
    async rename(entry) {
      if (!entry) return;
      if (!(await gate())) return;
      const name = await promptName('名前の変更', entry.name);
      if (name == null) return;
      const trimmed = name.trim();
      if (!trimmed || trimmed === entry.name) return;
      try {
        await backend.renamePath(entry.path, trimmed);
        await done('名前を変更しました');
      } catch (e) {
        if (isExists(e)) toast('その名前は既に存在します');
        else toast('名前変更失敗: ' + (e && e.message ? e.message : e));
      }
    },

    /** dir 配下に新規フォルダを作成（FR-03） */
    async makeNewFolder(dir) {
      if (!dir) return;
      if (!(await gate())) return;
      const name = await promptName('新しいフォルダ', '新しいフォルダ');
      if (name == null) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        await backend.makeDir(dir, trimmed);
        await done('フォルダを作成しました');
      } catch (e) {
        if (isExists(e)) toast('その名前は既に存在します');
        else toast('作成失敗: ' + (e && e.message ? e.message : e));
      }
    },

    /** entry（単体または配列）を完全削除（確認必須, NFR-R3） */
    async deletePermanent(entryOrList) {
      const list = asList(entryOrList);
      if (!list.length) return;
      if (!(await gate())) return;
      // 確認は最初に1回だけ。件数が多いときに全ファイル名を並べても読めないので、
      // 数件までは名前を出し、それ以上は件数で示す。
      const names =
        list.length <= 3
          ? list.map((e) => e.name).join('\n')
          : `${list
              .slice(0, 3)
              .map((e) => e.name)
              .join('\n')}\nほか ${list.length - 3} 件`;
      const ok = await confirm(`完全に削除します（元に戻せません）:\n${names}\nよろしいですか？`);
      if (!ok) return;
      const r = await runBatch(list, (entry) => backend.deletePermanent(entry.path));
      await reportBatch(r, '完全に削除', '完全に削除しました');
    },
  };
}
