// dragdrop.js — ドラッグ操作の追跡 (FR-02, FR-11)
//
// HTML5 D&D は使わず、ポインタイベントで自作する。Tauri の `dragDropEnabled`
// （既定 true）は「Tauri 内部D&Dが有効 / DOM の D&D が無効」を意味し両者は排他で、
// HTML5 D&D を選ぶと OS からのファイルドロップを永久に受けられなくなるため。
//
// 座標からドロップ先を解決する resolveDropTarget は、将来 OS ドロップ
// (webview の onDragDropEvent) を受けるときにもそのまま使う。
//
// 判定そのものは core/dnd.js（純粋関数）に置き、ここは DOM の面倒だけを見る。
// 設計の詳細は docs/DRAG-AND-DROP.md。

import { dragPayload, dropEffect, validateDrop, exceededThreshold, describeDrag } from './dnd.js';
import { isOutsideViewport, isNearEdge } from './osdnd.js';

/**
 * 画面座標からドロップ先を解決する。
 *
 * フォルダ行の上ならそのフォルダ、ブレッドクラムの上ならその階層、
 * それ以外（ファイル行・一覧の余白）ならそのペインの現在地。
 *
 * @param {number} x
 * @param {number} y
 * @param {(pane: string) => string|null} getPaneDir ペインの現在地を返す
 * @param {Document} [doc]
 * @returns {{pane: string, destDir: string, kind: string, el: Element}|null}
 */
export function resolveDropTarget(x, y, getPaneDir, doc = globalThis.document) {
  if (!doc || typeof doc.elementFromPoint !== 'function') return null;
  const el = doc.elementFromPoint(x, y);
  if (!el || typeof el.closest !== 'function') return null;

  const paneEl = el.closest('.pane');
  const pane = paneEl && paneEl.dataset ? paneEl.dataset.pane : null;
  if (!pane) return null;

  // ブレッドクラムは title に階層の絶対パスを持っている（filepane.renderBreadcrumb）
  const crumb = el.closest('.crumb');
  if (crumb && crumb.title) {
    return { pane, destDir: crumb.title, kind: 'crumb', el: crumb };
  }

  // フォルダ行の上ならその中へ。ファイル行はペインの現在地へ落ちる（下へ抜ける）
  const row = el.closest('.entry');
  if (row && row.classList.contains('is-dir') && row.dataset && row.dataset.path) {
    return { pane, destDir: row.dataset.path, kind: 'entry', el: row };
  }

  const dir = getPaneDir ? getPaneDir(pane) : null;
  if (!dir) return null;
  return { pane, destDir: dir, kind: 'pane', el: paneEl };
}

/**
 * ドラッグセッションを生成する。
 *
 * @param {object} deps
 * @param {(pane: string) => string|null} deps.getPaneDir
 * @param {() => boolean} deps.canMutate 破壊的操作が許可されているか
 * @param {(info: {sources: object[], destDir: string, effect: string}) => void} deps.onDrop
 * @param {(msg: string) => void} [deps.toast] 安全モードでのドロップ拒否を伝える
 * @param {(sources: object[], stillHeld: () => boolean) => (void|Promise<void>)} [deps.onLeaveWindow]
 *   ドラッグ中のカーソルがウィンドウの外へ出たときに呼ぶ（OS のドラッグへ引き継ぐ, §10）。
 *   stillHeld() はボタンがまだ押されているか。取り寄せを待つ間に離されたら OS の
 *   ドラッグを始めてはいけない（離した位置に勝手に落ちる）。
 * @param {() => {width: number, height: number}} [deps.getViewport]
 * @param {Document} [deps.doc]
 */
export function createDragSession(deps) {
  const { getPaneDir, canMutate, onDrop, toast, onLeaveWindow } = deps;
  const doc = deps.doc || globalThis.document;
  const getViewport =
    deps.getViewport ||
    (() => {
      const w = doc.defaultView || globalThis;
      return { width: w.innerWidth, height: w.innerHeight };
    });

  let pending = null; // mousedown 済み・しきい値未満
  let active = null; // ドラッグ中
  let ghost = null;
  let highlighted = null;
  let shiftHeld = false;
  let lastPoint = null; // Shift の押し引きは座標を運ばないので、最後の位置を覚えておく

  function clearHighlight() {
    if (!highlighted) return;
    highlighted.classList.remove('drop-into', 'drop-here');
    highlighted = null;
  }

  function setHighlight(target, allowed) {
    if (highlighted && highlighted !== target.el) clearHighlight();
    if (!allowed) return;
    highlighted = target.el;
    highlighted.classList.add(target.kind === 'entry' ? 'drop-into' : 'drop-here');
  }

  function makeGhost() {
    ghost = doc.createElement('div');
    ghost.className = 'drag-ghost';
    doc.body.appendChild(ghost);
  }

  function moveGhost(x, y) {
    if (!ghost) return;
    // カーソルの右下に少しずらす。真下だと elementFromPoint がゴースト自身を拾う
    ghost.style.left = `${x + 14}px`;
    ghost.style.top = `${y + 14}px`;
  }

  /** 現在の効果と、その座標に落とせるかを求める */
  function evaluate(x, y) {
    const effect = dropEffect({ shift: shiftHeld }, canMutate());
    const target = resolveDropTarget(x, y, getPaneDir, doc);
    if (!target) return { effect, target: null, allowed: false };
    const { ok } = validateDrop(active.sources, target.destDir, effect);
    return { effect, target, allowed: ok };
  }

  function paint(x, y) {
    const { effect, target, allowed } = evaluate(x, y);
    moveGhost(x, y);
    if (ghost) {
      ghost.textContent = describeDrag(active.sources, effect);
      ghost.classList.toggle('denied', !allowed);
    }
    if (target) setHighlight(target, allowed);
    else clearHighlight();
  }

  function start() {
    active = {
      sources: dragPayload(pending.entries, pending.selected, pending.path),
      rows: [],
    };
    pending = null;
    if (active.sources.length === 0) {
      stop();
      return;
    }
    // しきい値を越えるまでに始まってしまった文字列選択を消す
    const sel = doc.getSelection ? doc.getSelection() : null;
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
    // ドラッグ元の行を半透明にする
    const paths = new Set(active.sources.map((s) => s.path));
    for (const row of doc.querySelectorAll('.entry')) {
      if (row.dataset && paths.has(row.dataset.path)) {
        row.classList.add('dragging');
        active.rows.push(row);
      }
    }
    makeGhost();
  }

  function stop() {
    if (active) for (const row of active.rows) row.classList.remove('dragging');
    if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
    clearHighlight();
    ghost = null;
    active = null;
    pending = null;
    shiftHeld = false;
    if (doc.body) doc.body.classList.remove('dnd-active');
    doc.removeEventListener('mousemove', onMouseMove, true);
    doc.removeEventListener('mousemove', trackPoint, true);
    doc.removeEventListener('mouseup', onMouseUp, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('keyup', onKeyUp, true);
    doc.removeEventListener('mouseout', onMouseOut, true);
  }

  /**
   * ウィンドウの外へ出た。内部のドラッグを畳み、OS のドラッグへ引き継ぐ。
   * 引き継いだあとは OS がマウスを握るので、こちらの mouseup は来ない前提で片付ける。
   */
  function handOff() {
    const sources = active.sources;
    stop();
    let released = false;
    const onRelease = () => {
      released = true;
    };
    doc.addEventListener('mouseup', onRelease, true);
    const done = () => doc.removeEventListener('mouseup', onRelease, true);
    suppressSelectionUntilNextPress();
    Promise.resolve()
      .then(() => onLeaveWindow(sources, () => !released))
      .then(done, done);
  }

  /**
   * 引き継いだあと、webview はボタンが押されたままだと思っていることがあり
   * （OS のドラッグが mouseup を飲み込む）、Tana の上へ戻ると通り道の文字が
   * 範囲選択されてしまう（実機で確認）。次に押されるまで選択を止める。
   */
  function suppressSelectionUntilNextPress() {
    const block = (ev) => ev.preventDefault();
    const release = () => {
      doc.removeEventListener('selectstart', block, true);
      doc.removeEventListener('mousedown', release, true);
      doc.removeEventListener('mouseup', release, true);
    };
    doc.addEventListener('selectstart', block, true);
    doc.addEventListener('mousedown', release, true);
    doc.addEventListener('mouseup', release, true);
  }

  function onMouseMove(ev) {
    shiftHeld = ev.shiftKey === true;
    const point = { x: ev.clientX, y: ev.clientY };
    if (pending) {
      if (!exceededThreshold(pending.start, point)) return;
      start();
      if (!active) return;
    }
    if (!active) return;
    // ドラッグ中はテキスト選択が走らないようにする
    ev.preventDefault();
    if (onLeaveWindow) {
      const { width, height } = getViewport();
      if (isOutsideViewport(point, width, height)) {
        handOff();
        return;
      }
    }
    paint(point.x, point.y);
  }

  // ボタンを押したままの移動はふつう外でも座標が届くが（暗黙のキャプチャ）、
  // 届かない環境に備え、ウィンドウから出た mouseout（relatedTarget なし）でも引き継ぐ
  // （プレビュー iframe へ入ったときなどの誤検知を避けるため、縁にいるときに限る）
  function onMouseOut(ev) {
    if (!active || !onLeaveWindow || ev.relatedTarget) return;
    const { width, height } = getViewport();
    if (!isNearEdge({ x: ev.clientX, y: ev.clientY }, width, height)) return;
    handOff();
  }

  function onMouseUp(ev) {
    if (!active) {
      stop(); // しきい値未満のまま離した = ただのクリック。後始末だけする
      return;
    }
    shiftHeld = ev.shiftKey === true;
    const { effect, target, allowed } = evaluate(ev.clientX, ev.clientY);
    const sources = active.sources;
    stop();
    if (allowed && target && onDrop) {
      onDrop({ sources, destDir: target.destDir, effect });
    } else if (effect === 'none' && target && toast) {
      // 安全モードで、落とせる場所に落とそうとした場合だけ理由を伝える。
      // F5/F6 のゲートと同じ文言に揃える。ペイン外へ落としたとき（target なし）は
      // 「やめた」操作なので黙る。
      toast('安全モードです（切替: Ctrl+Shift+Space）');
    }
  }

  function onKeyDown(ev) {
    if (ev.key === 'Escape') {
      stop();
      return;
    }
    if (ev.key === 'Shift' && active) {
      shiftHeld = true;
      repaintLast();
    }
  }

  function onKeyUp(ev) {
    if (ev.key === 'Shift' && active) {
      shiftHeld = false;
      repaintLast();
    }
  }

  // Shift の押し引きだけでは座標が来ないので、最後の位置で描き直す
  function repaintLast() {
    if (active && lastPoint) paint(lastPoint.x, lastPoint.y);
  }

  function trackPoint(ev) {
    lastPoint = { x: ev.clientX, y: ev.clientY };
  }

  return {
    /**
     * 行の mousedown から呼ぶ。ここではまだドラッグを開始しない
     * （しきい値を超えるまでは、ただのクリックと区別できないため）。
     */
    begin({ entries, selected, path, x, y }) {
      // 安全モードでもドラッグ自体は始める。ゴーストを取り消し線付き（ドロップ不可）で
      // 見せ、離したときにトーストで理由を伝えるほうが、無反応より親切なため
      // （実機フィードバックで「動かない」と受け取られた）。ドロップの実行は
      // dropEffect が 'none' を返すので validateDrop 側で確実に弾かれる。
      if (!path) return;
      stop();
      pending = { entries, selected, path, start: { x, y } };
      // 押している間は画面全体で文字列選択を止める。一覧の行は user-select: none だが、
      // 相手ペインへ動かすと選択がヘッダ等へ広がっていた（実機で確認）
      if (doc.body) doc.body.classList.add('dnd-active');
      lastPoint = { x, y };
      doc.addEventListener('mousemove', onMouseMove, true);
      doc.addEventListener('mousemove', trackPoint, true);
      doc.addEventListener('mouseup', onMouseUp, true);
      doc.addEventListener('keydown', onKeyDown, true);
      doc.addEventListener('keyup', onKeyUp, true);
      doc.addEventListener('mouseout', onMouseOut, true);
    },
    /** ドラッグ中か（テスト・外部からの問い合わせ用） */
    isDragging: () => active !== null,
    cancel: stop,
  };
}
