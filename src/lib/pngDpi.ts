/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — PNG resolution metadata (WO-01/2)

   A PNG has no header field for dots per inch: the physical resolution lives
   in a `pHYs` chunk that stores pixels per unit (metre) and a unit byte. The
   browser canvas writes neither, so a "300 DPI" figure saved from a canvas
   carries no resolution at all and Word / Illustrator / print dialogs open it
   at 72 DPI — the number in the file name contradicts the pixels.

   These helpers read and rewrite the chunk list directly, byte by byte. They
   are deliberately independent of the rasteriser so the byte-level behaviour
   is testable without a canvas.
   ───────────────────────────────────────────────────────────────────────── */

/** `\x89PNG\r\n\x1a\n` */
export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** 1 inch = 25.4 mm exactly, so one inch holds 1/0.0254 metre. */
export const METRES_PER_INCH = 0.0254;

export interface PngChunk {
  /** four-character type, e.g. 'IHDR' */
  type: string;
  /** byte offset of the 4-byte length field */
  offset: number;
  /** byte offset of the chunk data */
  dataStart: number;
  dataLength: number;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Standard CRC-32 as PNG defines it (over chunk type + data). */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

/**
 * Walk the chunk list. A truncated or malformed file returns the chunks that
 * could be read rather than throwing, so a viewer can still report "no pHYs".
 */
export function pngChunks(bytes: Uint8Array): PngChunk[] {
  const out: PngChunk[] = [];
  if (!isPng(bytes)) return out;
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    // A length that would run past the buffer marks a corrupt chunk list.
    if (offset + 12 + length > bytes.length) {
      out.push({ type, offset, dataStart: offset + 8, dataLength: Math.max(0, bytes.length - (offset + 8)) });
      break;
    }
    out.push({ type, offset, dataStart: offset + 8, dataLength: length });
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  return out;
}

/** Read a `pHYs` chunk as DPI, or null when the file states no resolution. */
export function readPngDpi(bytes: Uint8Array): number | null {
  const chunk = pngChunks(bytes).find((c) => c.type === 'pHYs');
  if (!chunk || chunk.dataLength < 9) return null;
  const ppuX = readUint32(bytes, chunk.dataStart);
  const ppuY = readUint32(bytes, chunk.dataStart + 4);
  const unit = bytes[chunk.dataStart + 8];
  // unit 0 means "unknown aspect ratio": the numbers are not a resolution.
  if (unit !== 1 || ppuX === 0 || ppuY === 0) return null;
  return ppuX * METRES_PER_INCH;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  parts.forEach((part) => {
    out.set(part, at);
    at += part.length;
  });
  return out;
}

function encodeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeUint32(out, 0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  writeUint32(out, 8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** The 9 data bytes of a `pHYs` chunk for a DPI value (metre unit). */
export function physChunkData(dpi: number): Uint8Array {
  const pixelsPerMetre = Math.max(1, Math.round(dpi / METRES_PER_INCH));
  const data = new Uint8Array(9);
  writeUint32(data, 0, pixelsPerMetre);
  writeUint32(data, 4, pixelsPerMetre);
  data[8] = 1;
  return data;
}

/**
 * Return the same PNG with exactly one `pHYs` chunk stating `dpi`.
 *
 * The chunk goes directly after `IHDR`, which is where the PNG specification
 * puts ancillary chunks it wants readers to see before image data, and every
 * earlier `pHYs` is dropped so the file never carries two contradictory
 * resolutions. Image data, palette, transparency and text chunks are copied
 * byte for byte.
 */
export function withPngDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  if (!isPng(bytes)) throw new Error('png.signature');
  if (!Number.isFinite(dpi) || dpi <= 0) throw new Error('png.dpi');
  const chunks = pngChunks(bytes);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('png.ihdr');
  const depth = 12 + ihdr.dataLength;
  const head = bytes.slice(0, 8 + depth);
  const rest: Uint8Array[] = [];
  let offset = 8 + depth;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const size = 12 + length;
    if (offset + size > bytes.length) break;
    if (type !== 'pHYs') rest.push(bytes.slice(offset, offset + size));
    offset += size;
    if (type === 'IEND') break;
  }
  return concat([head, encodeChunk('pHYs', physChunkData(dpi)), ...rest]);
}

/** Browser helper: rewrite a PNG Blob so its pHYs states the requested DPI. */
export async function pngBlobWithDpi(blob: Blob, dpi: number): Promise<Blob> {
  if (!Number.isFinite(dpi) || dpi <= 0) return blob;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!isPng(bytes)) return blob;
    const next = withPngDpi(bytes, dpi);
    return new Blob([next as unknown as BlobPart], { type: 'image/png' });
  } catch {
    // A rasteriser that produced something unexpected keeps its own bytes;
    // the export still succeeds and simply carries no resolution claim.
    return blob;
  }
}
