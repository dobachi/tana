// placesview.js — 「場所(Places)」サイドバーの描画 + キーボード操作 (FR-07)
// ドライブ/ボリューム・標準フォルダの平坦リスト。クリック / Enter で移動。
// お気に入り(favoritesview)と違い、ネスト・検索・追加削除は無い静的な一覧。
// キーボード: j/k 移動, Enter/l 開く, Esc/Tab でペインへ戻る。

/**
 * @param {object} deps
 * @param {HTMLElement} deps.listEl 「場所」を描画する <ul>
 * @param {(path: string) => void} deps.onNavigate 場所を選んだとき
 * @param {() => void} [deps.onReturn] サイドバーからペインへ戻るとき（Esc/Tab）
 */
export function createPlacesView(deps) {
  const { listEl, onNavigate, onReturn } = deps;
  let rows = []; // [{ el, place }] 表示順
  let focusIdx = -1;
  let hasFocus = false;

  function placeRow(place) {
    const li = document.createElement('li');
    li.className = `place-node place-${place.kind}`;
    const row = document.createElement('div');
    row.className = 'place-row';
    row.tabIndex = -1;
    row.title = place.path;

    const name = document.createElement('span');
    name.className = 'place-name';
    name.textContent = place.name;
    row.appendChild(name);

    row.addEventListener('click', () => {
      if (onNavigate) onNavigate(place.path);
    });
    li.appendChild(row);
    rows.push({ el: row, place });
    return li;
  }

  /** 検出済みの場所一覧で描画し直す */
  function render(places) {
    listEl.replaceChildren();
    rows = [];
    if (!places || !places.length) {
      const li = document.createElement('li');
      li.className = 'placeholder';
      li.textContent = '（検出できませんでした）';
      listEl.appendChild(li);
      return;
    }
    for (const place of places) listEl.appendChild(placeRow(place));
  }

  function setFocus(i) {
    if (!rows.length) return;
    focusIdx = Math.max(0, Math.min(i, rows.length - 1));
    rows[focusIdx].el.focus();
  }

  /** サイドバーへフォーカスを移す（空なら何もしない） */
  function focusFirst() {
    if (rows.length) setFocus(0);
  }

  function onKey(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return; // 全局トグルは通す
    if (!rows.length) return;
    let idx = rows.findIndex((r) => r.el === document.activeElement);
    if (idx < 0) idx = focusIdx >= 0 ? focusIdx : 0;
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        setFocus(idx + 1);
        break;
      case 'k':
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        setFocus(idx - 1);
        break;
      case 'l':
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        rows[idx].el.click();
        break;
      case 'Tab':
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        if (onReturn) onReturn();
        break;
      default:
        break;
    }
  }

  listEl.addEventListener('keydown', onKey);
  listEl.addEventListener('focusin', () => {
    hasFocus = true;
  });
  listEl.addEventListener('focusout', (e) => {
    if (!listEl.contains(e.relatedTarget)) hasFocus = false;
  });

  return { render, focusFirst, isFocused: () => hasFocus };
}
