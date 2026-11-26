/**
 * Reading picture files by their bytes, never their name or their declared type, for player screenshots
 * (lib/screenshots.ts). No decoding: sniffImage names the container, cleanWebp checks a WebP's structure and keeps only
 * the chunks that hold pixels.
 */

export type SniffedImage = "image/png" | "image/jpeg" | "image/webp";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const startsWith = (bytes: Uint8Array, sig: readonly number[], at = 0) => bytes.length >= at + sig.length && sig.every((b, i) => bytes[at + i] === b);
const fourcc = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u24 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

/** The image type a file's first bytes say it is: PNG, JPEG or WebP. Anything else (GIF, SVG, HTML, a PDF) is null. */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (startsWith(bytes, PNG) && bytes.length > PNG.length) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff]) && bytes.length > 3) return "image/jpeg";
  if (bytes.length >= 20 && fourcc(bytes, 0) === "RIFF" && fourcc(bytes, 8) === "WEBP") return "image/webp";
  return null;
}

interface Chunk { type: string; data: Uint8Array }

/** A frame's own width and height: lossy (VP8) key frame header or lossless (VP8L) header. Null if it is neither. */
function frameSize(c: Chunk): { width: number; height: number } | null {
  const d = c.data;
  if (c.type === "VP8 ") {
    if (d.length < 10 || (d[0] & 1) !== 0 || d[3] !== 0x9d || d[4] !== 0x01 || d[5] !== 0x2a) return null;
    return { width: u16(d, 6) & 0x3fff, height: u16(d, 8) & 0x3fff };
  }
  if (d.length < 5 || d[0] !== 0x2f) return null;
  const bits = u32(d, 1);
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
}

function encodeChunk(type: string, data: Uint8Array): number[] {
  const size = data.length;
  return [...Array.from(type, (ch) => ch.charCodeAt(0)), size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >>> 24) & 255, ...data, ...(size % 2 ? [0] : [])];
}

/**
 * A still WebP rebuilt from its pixel chunks alone (VP8 or VP8L, and ALPH for a lossy picture with transparency), with
 * its size. EXIF, XMP, colour profiles and any chunk this does not know are dropped; an extended header is rewritten to
 * claim alpha at most. Null for anything that is not one well-formed still picture: an animation, two frames, a header
 * whose canvas differs from the frame, a size field that lies, a truncated chunk or bytes after the end.
 */
export function cleanWebp(bytes: Uint8Array): { bytes: Uint8Array; width: number; height: number } | null {
  if (sniffImage(bytes) !== "image/webp" || u32(bytes, 4) !== bytes.length - 8) return null;
  const chunks: Chunk[] = [];
  for (let at = 12; at < bytes.length;) {
    if (at + 8 > bytes.length) return null;
    const type = fourcc(bytes, at);
    const size = u32(bytes, at + 4);
    const end = at + 8 + size;
    if (end > bytes.length) return null;
    chunks.push({ type, data: bytes.subarray(at + 8, end) });
    at = end + (size % 2);
    if (at > bytes.length) return null;
  }
  if (chunks.some((c) => c.type === "ANIM" || c.type === "ANMF")) return null;
  const frames = chunks.filter((c) => c.type === "VP8 " || c.type === "VP8L");
  if (frames.length !== 1) return null;
  const frame = frames[0];
  const size = frameSize(frame);
  if (!size || size.width < 1 || size.height < 1) return null;
  const header = chunks.filter((c) => c.type === "VP8X");
  const alpha = chunks.filter((c) => c.type === "ALPH");
  if (header.length > 1 || alpha.length > 1) return null;
  if (header.length) {
    const d = header[0].data;
    if (d.length < 10 || u24(d, 4) + 1 !== size.width || u24(d, 7) + 1 !== size.height) return null;
  }
  // Alpha belongs to a lossy frame in an extended file; a lossless frame carries its own.
  if (alpha.length && (!header.length || frame.type !== "VP8 ")) return null;

  const out: number[] = [];
  if (alpha.length) {
    const vp8x = new Uint8Array(10);
    vp8x[0] = 0x10;
    vp8x.set([(size.width - 1) & 255, ((size.width - 1) >> 8) & 255, ((size.width - 1) >> 16) & 255], 4);
    vp8x.set([(size.height - 1) & 255, ((size.height - 1) >> 8) & 255, ((size.height - 1) >> 16) & 255], 7);
    out.push(...encodeChunk("VP8X", vp8x), ...encodeChunk("ALPH", alpha[0].data));
  }
  out.push(...encodeChunk(frame.type, frame.data));
  const body = 4 + out.length;
  const file = new Uint8Array(8 + body);
  file.set([0x52, 0x49, 0x46, 0x46, body & 255, (body >> 8) & 255, (body >> 16) & 255, (body >>> 24) & 255, 0x57, 0x45, 0x42, 0x50]);
  file.set(out, 12);
  return { bytes: file, ...size };
}
