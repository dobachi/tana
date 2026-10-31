// osdragdrop.js — OS とのドラッグ＆ドロップの配線（docs/DRAG-AND-DROP.md §10）
//
//   - createOsDropTarget: 外 → Tana。onDragDropEvent の enter/over/leave/drop を受け、
//     内部D&Dと同じ resolveDropTarget で宛先を決めて fileOps のコピーへ渡す。
//   - createDragOut: Tana → 外。内部D&Dがウィンドウの外へ出たときに呼ばれ、
//     OS のドラッグ（tauri-plugin-drag）を始める。
//
// Tauri の呼び出しはすべて deps で受けるので、jsdom で単体テストできる。
// 判定そのものは core/osdnd.js と core/dnd.js。

import { resolveDropTarget } from './dragdrop.js';
import { validateDrop } from './dnd.js';
import {
  toClientPoint,
  sourcesFromKinds,
  matchOutbound,
  planDragOut,
  describeDragOutRefusal,
} from './osdnd.js';

const SAFE_MODE_MSG = '安全モードです（切替: Ctrl+Shift+Space）';

function errorText(e) {
  return e && e.message ? e.message : String(e);
}

/** 弾いたドロップの理由を伝える文言。黙ってよいものは '' */
export function describeOsDropRefusal(reason) {
  if (reason === 'into-self' || reason === 'into-descendant') {
    return 'フォルダをそれ自身の中へはコピーできません';
  }
  return '';
}

/**
 * 外 → Tana のドロップを受ける。
 *
 * 外からのドロップは常にコピーにする。onDragDropEvent は修飾キーを運ばないので
 * Shift=移動 を判別できず、移動にすると元（エクスプローラー側）を消してしまうため。
 *
 * @param {object} deps
 * @param {(pane: string) => string|null} deps.getPaneDir
 * @param {() => boolean} deps.canMutate
 * @param {(paths: string[]) => Promise<object[]>} deps.pathKinds path_kinds コマンド
 * @param {(info: {sources: object[], destDir: string, effect: string}) => void} deps.onDrop
 * @param {(msg: string) => void} deps.toast
 * @param {() => number} [deps.getScale] 物理ピクセル→CSS ピクセルの倍率
 * @param {() => ({paths: string[], sources: object[]}|null)} [deps.getOutbound]
 * @param {Document} [deps.doc]
 */
export function createOsDropTarget(deps) {
  const { getPaneDir, canMutate, pathKinds, onDrop, toast } = deps;
  const doc = deps.doc || globalThis.document;
  const getScale = deps.getScale || (() => globalThis.devicePixelRatio || 1);
  const getOutbound = deps.getOutbound || (() => null);

  let highlighted = null;
  let paths = [];

  // 外へ出したドラッグが戻ってきたとき、通り道の文字が選択されていることがある
  function clearSelection() {
    const sel = doc.getSelection ? doc.getSelection() : null;
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
  }

  function clearHighlight() {
    if (!highlighted) return;
    highlighted.classList.remove('drop-into', 'drop-here');
    highlighted = null;
  }

  function targetAt(position) {
    const pt = toClientPoint(position, getScale());
    if (!pt) return null;
    return resolveDropTarget(pt.x, pt.y, getPaneDir, doc);
  }

  // 落とす前は種類（フォルダか）が分からないので、自分自身への落下だけを見て光らせる
  function paint(position) {
    const target = targetAt(position);
    const allowed =
      target &&
      canMutate() &&
      validateDrop(
        paths.map((p) => ({ path: p })),
        target.destDir,
        'copy',
      ).ok;
    if (!target || !allowed) {
      clearHighlight();
      return;
    }
    if (highlighted && highlighted !== target.el) clearHighlight();
    highlighted = target.el;
    highlighted.classList.add(target.kind === 'entry' ? 'drop-into' : 'drop-here');
  }

  async function drop(dropped, position) {
    const target = targetAt(position);
    if (!target || dropped.length === 0) return;
    if (!canMutate()) {
      toast(SAFE_MODE_MSG);
      return;
    }
    let sources = matchOutbound(getOutbound(), dropped);
    if (!sources) {
      try {
        sources = sourcesFromKinds(await pathKinds(dropped));
      } catch (e) {
        toast(`ドロップを受け付けられません: ${errorText(e)}`);
        return;
      }
    }
    if (sources.length === 0) return;
    const { ok, reason } = validateDrop(sources, target.destDir, 'copy');
    if (!ok) {
      const msg = describeOsDropRefusal(reason);
      if (msg) toast(msg);
      return;
    }
    onDrop({ sources, destDir: target.destDir, effect: 'copy' });
  }

  return {
    /** onDragDropEvent の payload（{type, paths?, position?}）を渡す */
    async handle(ev) {
      if (!ev) return;
      switch (ev.type) {
        case 'enter':
          paths = Array.isArray(ev.paths) ? ev.paths : [];
          paint(ev.position);
          return;
        case 'over':
          paint(ev.position);
          return;
        case 'drop': {
          clearHighlight();
          clearSelection();
          const dropped = Array.isArray(ev.paths) && ev.paths.length ? ev.paths : paths;
          paths = [];
          await drop(dropped, ev.position);
          return;
        }
        default: // 'leave'（キャンセル・ウィンドウ外へ出た）
          clearHighlight();
          clearSelection();
          paths = [];
      }
    },
  };
}

/**
 * Tana → 外 のドラッグを始める。
 *
 * OS へは常に「コピー」として渡す。移動にすると受け取り側のアプリが元を消し、
 * Tana の安全モードや確認を素通りしてしまうため。
 *
 * @param {object} deps
 * @param {(paths: string[], icon: string) => Promise<unknown>} deps.startDrag
 * @param {(path: string) => Promise<string>} deps.fetchRemote リモートを手元へ取り寄せる
 * @param {(path: string) => boolean} deps.isRemote
 * @param {(sources: object[]) => string} deps.makeIcon PNG の data URL
 * @param {(msg: string) => void} deps.toast
 */
export function createDragOut(deps) {
  const { startDrag, fetchRemote, isRemote, makeIcon, toast } = deps;
  let outbound = null;

  return {
    /**
     * @param {object[]} sources
     * @param {() => boolean} [stillHeld] ボタンがまだ押されているか
     * @returns {Promise<boolean>} OS のドラッグを始めたか
     */
    async start(sources, stillHeld = () => true) {
      const plan = planDragOut(sources, isRemote);
      if (!plan.ok) {
        const msg = describeDragOutRefusal(plan.reason);
        if (msg) toast(msg);
        return false;
      }
      const hasRemote = plan.items.some((i) => i.remote);
      if (hasRemote) toast('リモートのファイルを手元へ取り寄せています…');
      let paths;
      try {
        paths = await Promise.all(plan.items.map((i) => (i.remote ? fetchRemote(i.path) : i.path)));
      } catch (e) {
        toast(`外へドラッグできません: ${errorText(e)}`);
        return false;
      }
      // 取り寄せている間に離されたら始めない。OS のドラッグはボタンが上がっていると
      // その場で落としてしまい、意図しない場所へコピーされる。
      if (hasRemote && !stillHeld()) {
        toast('ボタンが離されたので、外へのドラッグをやめました');
        return false;
      }
      outbound = { paths, sources };
      try {
        await startDrag(paths, makeIcon(sources));
      } catch (e) {
        toast(`外へドラッグできません: ${errorText(e)}`);
        return false;
      }
      return true;
    },
    /** 直前に外へ出したもの（Tana へ戻して落としたときに元の場所へ読み替える） */
    getOutbound: () => outbound,
  };
}
