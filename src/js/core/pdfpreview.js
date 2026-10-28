// pdfpreview.js — PDF プレビュー（オプション）の設定と、表示するかどうかの判断。純粋・DOM 非依存。
//
// 描画エンジン pdf.js はダウンロード型拡張（id "pdfjs"、カタログは dobachi/tana-extensions）で、
// 本体には含めない（Fude の PlantUML / Mermaid 拡張と同じ構成）。設定 → 拡張機能 で有効に
// したときだけ取得し、既定はオフ。

export const PDF_EXT_ID = 'pdfjs';
export const PDF_PREVIEW_KEY = 'tana.preview.pdf';

/** 拡張に含まれるエンジンのファイル（read_extension_file で読む名前）。 */
export const PDF_ENGINE_FILES = Object.freeze({
  pdf: 'pdf.min.mjs',
  worker: 'pdf.worker.js',
  cmaps: 'cmaps.json',
  fonts: 'standard_fonts.json',
});

/** 保存された設定を読む。未設定・壊れた値はオフ。 */
export function loadPdfPreview(storage = globalThis.localStorage) {
  try {
    return !!storage && storage.getItem(PDF_PREVIEW_KEY) === 'on';
  } catch {
    return false;
  }
}

export function storePdfPreview(on, storage = globalThis.localStorage) {
  try {
    if (storage) storage.setItem(PDF_PREVIEW_KEY, on ? 'on' : 'off');
  } catch {
    // 保存できなくても今回の切替は効かせる
  }
}

/**
 * PDF を選んだときに描くか、代わりに何と出すか。
 * @param {{enabled: boolean, installed: boolean, size?: number, maxBytes: number}} s
 * @returns {{show: true} | {show: false, note: string}}
 */
export function pdfDecision({ enabled, installed, size, maxBytes }) {
  if (!enabled) {
    return { show: false, note: 'PDF プレビューはオフです（設定 → 拡張機能 で有効にできます）' };
  }
  if (!installed) {
    return {
      show: false,
      note: 'PDF プレビューの拡張機能が入っていません（設定 → 拡張機能）',
    };
  }
  // 中身を丸ごと読んで（リモートは取得して）から描くので、大きさに上限を設ける
  if (typeof size === 'number' && size > maxBytes) {
    return { show: false, note: '大きすぎるためプレビューしません' };
  }
  return { show: true };
}

/** ダウンロードの進み具合の表示（例: "1.2 / 4.4 MB"）。total が不明なら受信量だけ。 */
export function describeProgress(progress, total) {
  const mb = (n) => (n / 1048576).toFixed(1);
  return total > 0 ? `${mb(progress)} / ${mb(total)} MB` : `${mb(progress)} MB`;
}
