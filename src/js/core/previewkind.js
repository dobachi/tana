// previewkind.js - Pure preview type detection. No DOM / no Tauri, so it is
// unit-testable directly. The controller calls detectKind twice: once with no
// sniff bytes (to decide the route: meta / asset / read), then again with the
// first bytes returned by the backend to refine text-vs-binary.

export const KIND = {
  DIR: 'dir',
  IMAGE: 'image',
  TEXT: 'text',
  MARKDOWN: 'markdown',
  PDF: 'pdf',
  BINARY: 'binary',
  TOO_LARGE: 'too-large',
  EMPTY: 'empty',
};

/** Default limits (bytes / ms). */
export const LIMITS = {
  sniffBytes: 4096,
  maxTextBytes: 262144, // 256 KiB
  maxPreviewBytes: 33554432, // 32 MiB
  debounceMs: 150,
};

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg']);
const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdx', 'mdown', 'mkd']);

/** Lowercased extension (no dot) of a name/path, or '' if none. */
export function extOf(nameOrPath) {
  const s = String(nameOrPath || '');
  const base = s.slice(s.replace(/\\/g, '/').lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** True if a byte sequence looks binary (NUL, or many C0 control bytes). */
export function isBinaryBytes(bytes) {
  if (!bytes || bytes.length === 0) return false;
  let suspicious = 0;
  for (const c of bytes) {
    if (c === 0) return true;
    if (c < 9 || (c > 13 && c < 32)) suspicious += 1;
  }
  return suspicious * 100 > bytes.length * 3;
}

/** Classify from magic bytes: IMAGE / PDF / TEXT / BINARY, or null if empty. */
export function sniffKind(bytes) {
  if (!bytes || bytes.length === 0) return null;
  const b = bytes;
  const starts = (sig) => sig.every((v, i) => b[i] === v);
  if (starts([0x89, 0x50, 0x4e, 0x47])) return KIND.IMAGE; // PNG
  if (starts([0xff, 0xd8, 0xff])) return KIND.IMAGE; // JPEG
  if (starts([0x47, 0x49, 0x46, 0x38])) return KIND.IMAGE; // GIF8
  if (starts([0x42, 0x4d])) return KIND.IMAGE; // BMP
  if (starts([0x25, 0x50, 0x44, 0x46])) return KIND.PDF; // %PDF
  if (
    b.length >= 12 &&
    starts([0x52, 0x49, 0x46, 0x46]) && // RIFF
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50 // WEBP
  ) {
    return KIND.IMAGE;
  }
  return isBinaryBytes(b) ? KIND.BINARY : KIND.TEXT;
}

/**
 * Determine the preview kind for a directory entry.
 * @param {{is_dir?:boolean, size?:number, name?:string, path?:string}} entry
 * @param {Uint8Array|number[]|null} [sniff] first bytes (secondary pass)
 * @param {typeof LIMITS} [limits]
 * @returns {string} one of KIND
 */
export function detectKind(entry, sniff = null, limits = LIMITS) {
  if (!entry) return KIND.BINARY;
  if (entry.is_dir) return KIND.DIR;
  if (entry.size === 0) return KIND.EMPTY;

  const ext = extOf(entry.name || entry.path || '');
  const sniffed = sniff ? sniffKind(sniff) : null;

  // Images / PDF are served via the asset protocol (not read as text) and are
  // not subject to the text size cap. Magic bytes win over the extension so
  // extension-less or mis-named files are still recognized.
  if (sniffed === KIND.IMAGE || IMAGE_EXT.has(ext)) return KIND.IMAGE;
  if (sniffed === KIND.PDF || ext === 'pdf') return KIND.PDF;

  // Everything below is read as text; enforce the size cap here.
  if (typeof entry.size === 'number' && entry.size > limits.maxPreviewBytes) {
    return KIND.TOO_LARGE;
  }

  if (sniffed === KIND.BINARY) return KIND.BINARY;
  if (MARKDOWN_EXT.has(ext)) return KIND.MARKDOWN;
  if (sniffed === KIND.TEXT) return KIND.TEXT;
  // No sniff yet (primary pass) and unknown extension: attempt to read as text;
  // the secondary pass will downgrade to BINARY if the bytes say so.
  return KIND.TEXT;
}

/** Read cap for a kind. 0 means "do not read the body" (handled elsewhere). */
export function maxBytesFor(kind, limits = LIMITS) {
  switch (kind) {
    case KIND.TEXT:
    case KIND.MARKDOWN:
      return limits.maxTextBytes;
    default:
      return 0;
  }
}
