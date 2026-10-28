import { describe, it, expect } from 'vitest';
import {
  loadPdfPreview,
  storePdfPreview,
  pdfDecision,
  describeProgress,
  PDF_PREVIEW_KEY,
  PDF_ENGINE_FILES,
} from '../core/pdfpreview.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m };
}

describe('PDF プレビューの設定', () => {
  it('既定はオフ。保存した値を読み戻す', () => {
    const s = memStorage();
    expect(loadPdfPreview(s)).toBe(false);
    storePdfPreview(true, s);
    expect(s.m.get(PDF_PREVIEW_KEY)).toBe('on');
    expect(loadPdfPreview(s)).toBe(true);
    storePdfPreview(false, s);
    expect(loadPdfPreview(s)).toBe(false);
  });

  it('壊れた値・読めないストレージはオフ扱い、保存の失敗は投げない', () => {
    const s = memStorage();
    s.setItem(PDF_PREVIEW_KEY, 'yes');
    expect(loadPdfPreview(s)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadPdfPreview(broken)).toBe(false);
    expect(() => storePdfPreview(true, broken)).not.toThrow();
    expect(loadPdfPreview(null)).toBe(false);
  });

  it('エンジンは拡張の4ファイル', () => {
    expect(Object.values(PDF_ENGINE_FILES)).toEqual([
      'pdf.min.mjs',
      'pdf.worker.js',
      'cmaps.json',
      'standard_fonts.json',
    ]);
  });
});

describe('pdfDecision', () => {
  const base = { enabled: true, installed: true, size: 10, maxBytes: 100 };
  it('オフ → 設定の案内', () => {
    expect(pdfDecision({ ...base, enabled: false })).toMatchObject({ show: false });
    expect(pdfDecision({ ...base, enabled: false }).note).toMatch(/設定 → 拡張機能/);
  });
  it('未導入 → 導入の案内（オフより後に判定）', () => {
    expect(pdfDecision({ ...base, installed: false }).note).toMatch(/入っていません/);
  });
  it('上限を超えたら描かない。ちょうどは描く。大きさ不明は描く', () => {
    expect(pdfDecision({ ...base, size: 101 }).note).toMatch(/大きすぎる/);
    expect(pdfDecision({ ...base, size: 100 })).toEqual({ show: true });
    expect(pdfDecision({ ...base, size: undefined })).toEqual({ show: true });
  });
});

describe('describeProgress', () => {
  it('MB で表す。全体が不明なら受信量だけ', () => {
    expect(describeProgress(1048576, 4 * 1048576)).toBe('1.0 / 4.0 MB');
    expect(describeProgress(524288, 0)).toBe('0.5 MB');
  });
});
