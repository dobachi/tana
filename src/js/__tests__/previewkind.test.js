import { describe, it, expect } from 'vitest';
import {
  KIND,
  LIMITS,
  extOf,
  isBinaryBytes,
  sniffKind,
  detectKind,
  maxBytesFor,
} from '../core/previewkind.js';

describe('extOf', () => {
  it('extracts lowercased extension', () => {
    expect(extOf('a/b/File.MD')).toBe('md');
    expect(extOf('C:\\x\\y.PNG')).toBe('png');
    expect(extOf('noext')).toBe('');
    expect(extOf('.hidden')).toBe(''); // leading dot only → no ext
    expect(extOf('archive.tar.gz')).toBe('gz');
  });
});

describe('isBinaryBytes', () => {
  it('flags NUL and control-heavy data, allows text', () => {
    expect(isBinaryBytes([])).toBe(false);
    expect(isBinaryBytes([104, 105, 10, 9])).toBe(false); // "hi\n\t"
    expect(isBinaryBytes([104, 0, 105])).toBe(true); // NUL
    expect(isBinaryBytes([1, 2, 3, 4, 5, 104])).toBe(true); // control-heavy
  });
});

describe('sniffKind', () => {
  it('detects image/pdf magic numbers', () => {
    expect(sniffKind([0x89, 0x50, 0x4e, 0x47])).toBe(KIND.IMAGE); // PNG
    expect(sniffKind([0xff, 0xd8, 0xff, 0x00])).toBe(KIND.IMAGE); // JPEG
    expect(sniffKind([0x25, 0x50, 0x44, 0x46])).toBe(KIND.PDF); // %PDF
    expect(sniffKind([0x42, 0x4d, 0x00])).toBe(KIND.IMAGE); // BMP
  });
  it('falls back to text/binary', () => {
    expect(sniffKind([104, 105])).toBe(KIND.TEXT);
    expect(sniffKind([104, 0])).toBe(KIND.BINARY);
    expect(sniffKind([])).toBe(null);
  });
});

describe('detectKind', () => {
  it('handles dir / empty / too-large', () => {
    expect(detectKind({ is_dir: true, size: 4096, name: 'd' })).toBe(KIND.DIR);
    expect(detectKind({ is_dir: false, size: 0, name: 'a.md' })).toBe(KIND.EMPTY);
    expect(detectKind({ size: LIMITS.maxPreviewBytes + 1, name: 'huge.log' })).toBe(KIND.TOO_LARGE);
  });

  it('recognizes images/pdf by extension regardless of size', () => {
    expect(detectKind({ size: LIMITS.maxPreviewBytes + 1, name: 'big.png' })).toBe(KIND.IMAGE);
    expect(detectKind({ size: 10, name: 'a.jpeg' })).toBe(KIND.IMAGE);
    expect(detectKind({ size: 10, name: 'a.svg' })).toBe(KIND.IMAGE);
    expect(detectKind({ size: 10, name: 'doc.pdf' })).toBe(KIND.PDF);
  });

  it('recognizes images/pdf by magic even with wrong extension', () => {
    expect(detectKind({ size: 10, name: 'a.txt' }, [0x89, 0x50, 0x4e, 0x47])).toBe(KIND.IMAGE);
    expect(detectKind({ size: 10, name: 'a.txt' }, [0x25, 0x50, 0x44, 0x46])).toBe(KIND.PDF);
  });

  it('primary pass (no sniff): markdown by ext, unknown → text (attempt read)', () => {
    expect(detectKind({ size: 10, name: 'readme.md' })).toBe(KIND.MARKDOWN);
    expect(detectKind({ size: 10, name: 'notes.markdown' })).toBe(KIND.MARKDOWN);
    expect(detectKind({ size: 10, name: 'script' })).toBe(KIND.TEXT);
    expect(detectKind({ size: 10, name: 'a.log' })).toBe(KIND.TEXT);
  });

  it('secondary pass (with sniff): downgrades mis-typed text to binary', () => {
    expect(detectKind({ size: 10, name: 'a.txt' }, [104, 0, 105])).toBe(KIND.BINARY);
    // .md that is actually binary → binary wins over the markdown extension
    expect(detectKind({ size: 10, name: 'a.md' }, [0, 1, 2])).toBe(KIND.BINARY);
    // .md with real text → markdown
    expect(detectKind({ size: 10, name: 'a.md' }, [104, 105])).toBe(KIND.MARKDOWN);
  });
});

describe('maxBytesFor', () => {
  it('caps text/markdown, zero for the rest', () => {
    expect(maxBytesFor(KIND.TEXT)).toBe(LIMITS.maxTextBytes);
    expect(maxBytesFor(KIND.MARKDOWN)).toBe(LIMITS.maxTextBytes);
    expect(maxBytesFor(KIND.IMAGE)).toBe(0);
    expect(maxBytesFor(KIND.DIR)).toBe(0);
    expect(maxBytesFor(KIND.BINARY)).toBe(0);
  });
});
