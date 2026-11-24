import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import {
  METRES_PER_INCH,
  PNG_SIGNATURE,
  crc32,
  isPng,
  physChunkData,
  pngChunks,
  readPngDpi,
  withPngDpi,
} from '../src/lib/pngDpi';

/* A real 2 × 2 RGB PNG built here, byte by byte, so the tests never depend on
   a canvas or on a fixture file whose resolution nobody can see. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

function buildPng(options: { dpi?: number } = {}): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 2); // width
  view.setUint32(4, 2); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  // The remaining bytes (compression, filter, interlace) stay 0.
  const raw = new Uint8Array([
    0, 255, 0, 0, 0, 255, 0, // row 0: red, green (filter byte first)
    0, 0, 0, 255, 255, 255, 255, // row 1: blue, white
  ]);
  const parts: Uint8Array[] = [new Uint8Array(PNG_SIGNATURE), chunk('IHDR', ihdr)];
  if (options.dpi) parts.push(chunk('pHYs', physChunkData(options.dpi)));
  parts.push(chunk('tEXt', new Uint8Array([...Buffer.from('Software\0HD2Lab Sigrún', 'latin1')])));
  parts.push(chunk('IDAT', new Uint8Array(deflateSync(raw))));
  parts.push(chunk('IEND', new Uint8Array(0)));
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  parts.forEach((part) => { out.set(part, at); at += part.length; });
  return out;
}

describe('PNG resolution metadata (WO-01/2)', () => {
  it('recognises a real PNG signature and its chunk list in order', () => {
    const bytes = buildPng();
    expect(isPng(bytes)).toBe(true);
    expect(isPng(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(pngChunks(bytes).map((c) => c.type)).toEqual(['IHDR', 'tEXt', 'IDAT', 'IEND']);
    expect(pngChunks(new Uint8Array([0x89, 0x50]))).toEqual([]);
  });

  it('states the requested DPI in a pHYs chunk placed right after IHDR', () => {
    const source = buildPng();
    for (const dpi of [150, 300, 600]) {
      const bytes = withPngDpi(source, dpi);
      const types = pngChunks(bytes).map((c) => c.type);
      expect(types).toEqual(['IHDR', 'pHYs', 'tEXt', 'IDAT', 'IEND']);
      // pixels per metre are integers, so reading back lands within 0.05 DPI
      expect(readPngDpi(bytes)).toBeCloseTo(dpi, 1);
      const phys = pngChunks(bytes).find((c) => c.type === 'pHYs');
      expect(phys?.dataLength).toBe(9);
      // pixels per metre, big-endian, unit = 1 (metre)
      const view = new DataView(bytes.buffer, bytes.byteOffset + (phys as { dataStart: number }).dataStart, 9);
      const expected = Math.round(dpi / METRES_PER_INCH);
      expect(view.getUint32(0)).toBe(expected);
      expect(view.getUint32(4)).toBe(expected);
      expect(view.getUint8(8)).toBe(1);
      expect(expected).toBeGreaterThan(0);
    }
  });

  it('writes the exact pixel-per-metre numbers a print reader expects', () => {
    // 150 DPI = 5906 px/m, 300 DPI = 11811 px/m, 600 DPI = 23622 px/m
    const at = (dpi: number) => {
      const bytes = withPngDpi(buildPng(), dpi);
      const start = (pngChunks(bytes).find((c) => c.type === 'pHYs') as { dataStart: number }).dataStart;
      return new DataView(bytes.buffer, bytes.byteOffset + start, 8).getUint32(0);
    };
    expect(at(150)).toBe(5906);
    expect(at(300)).toBe(11811);
    // 23622.05 rounds to 23622
    expect(at(600)).toBe(23622);
  });

  it('recomputes a valid CRC-32 for the inserted chunk', () => {
    const bytes = withPngDpi(buildPng(), 300);
    const phys = pngChunks(bytes).find((c) => c.type === 'pHYs');
    const start = (phys as { offset: number }).offset;
    const length = (phys as { dataLength: number }).dataLength;
    const stored = new DataView(bytes.buffer, bytes.byteOffset + start + 8 + length, 4).getUint32(0);
    expect(stored).toBe(crc32(bytes, start + 4, start + 8 + length));
  });

  it('replaces an existing pHYs instead of adding a second contradiction', () => {
    const bytes = withPngDpi(buildPng({ dpi: 72 }), 300);
    expect(pngChunks(bytes).filter((c) => c.type === 'pHYs')).toHaveLength(1);
    expect(readPngDpi(bytes)).toBeCloseTo(300, 1);
    expect(pngChunks(withPngDpi(bytes, 600)).filter((c) => c.type === 'pHYs')).toHaveLength(1);
  });

  it('keeps the image bytes untouched', () => {
    const source = buildPng();
    const bytes = withPngDpi(source, 300);
    const idat = (list: Uint8Array) => {
      const found = pngChunks(list).find((c) => c.type === 'IDAT');
      const at = (found as { dataStart: number }).dataStart;
      return list.slice(at, at + (found as { dataLength: number }).dataLength);
    };
    expect(Buffer.from(idat(bytes)).equals(Buffer.from(idat(source)))).toBe(true);
    expect(pngChunks(bytes).filter((c) => c.type === 'tEXt')).toHaveLength(1);
  });

  it('reports no resolution when the unit byte is not the metre', () => {
    const bytes = buildPng({ dpi: 300 });
    const phys = pngChunks(bytes).find((c) => c.type === 'pHYs');
    const copy = new Uint8Array(bytes);
    copy[(phys as { dataStart: number }).dataStart + 8] = 0; // "unknown aspect ratio"
    expect(readPngDpi(copy)).toBeNull();
    expect(readPngDpi(buildPng())).toBeNull();
  });

  it('refuses a non-PNG buffer and an impossible DPI', () => {
    expect(() => withPngDpi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), 300)).toThrow('png.signature');
    expect(() => withPngDpi(buildPng(), 0)).toThrow('png.dpi');
    expect(() => withPngDpi(buildPng(), Number.NaN)).toThrow('png.dpi');
  });
});
