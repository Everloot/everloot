import { describe, expect, test } from "vitest";
import { cleanWebp, sniffImage } from "./webp";

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const u24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];

function chunk(type: string, data: number[]): number[] {
  return [...ascii(type), ...u32(data.length), ...data, ...(data.length % 2 ? [0] : [])];
}
function riff(...chunks: number[][]): Uint8Array {
  const body = [...ascii("WEBP"), ...chunks.flat()];
  return new Uint8Array([...ascii("RIFF"), ...u32(body.length), ...body]);
}
/** A lossy key frame's header: frame tag, start code, 14-bit width and height. */
const vp8 = (w: number, h: number) => chunk("VP8 ", [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, w & 255, w >> 8, h & 255, h >> 8, 1, 2, 3, 4]);
const vp8l = (w: number, h: number) => chunk("VP8L", [0x2f, ...u32((w - 1) | ((h - 1) << 14)), 9, 9, 9]);
const vp8x = (flags: number, w: number, h: number) => chunk("VP8X", [flags, 0, 0, 0, ...u24(w - 1), ...u24(h - 1)]);
const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

describe("sniffImage", () => {
  test("names PNG, JPEG and WebP by their first bytes, whatever the file is called", () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("image/jpeg");
    expect(sniffImage(riff(vp8(4, 4)))).toBe("image/webp");
  });

  test("refuses everything else: GIF, SVG, HTML, a PDF, a zip, text, an empty file, a RIFF that is not WebP", () => {
    for (const bytes of [
      ascii("GIF89a......"), ascii("<svg xmlns='http://www.w3.org/2000/svg'>"), ascii("<!doctype html><script>"), ascii("%PDF-1.7"),
      [0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0], ascii("just some words"), [], [...ascii("RIFF"), ...u32(4), ...ascii("WAVE")],
      [0x89, 0x50, 0x4e, 0x47], // a PNG signature cut short
    ]) expect(sniffImage(new Uint8Array(bytes)), String(bytes.slice(0, 8))).toBeNull();
  });
});

describe("cleanWebp", () => {
  test("a plain lossy or lossless WebP comes back as it was, with its size", () => {
    const lossy = riff(vp8(1920, 1080));
    expect(cleanWebp(lossy)).toEqual({ bytes: lossy, width: 1920, height: 1080 });
    const lossless = riff(vp8l(640, 480));
    expect(cleanWebp(lossless)).toEqual({ bytes: lossless, width: 640, height: 480 });
  });

  test("EXIF, XMP, a colour profile and unknown chunks are dropped, and the header no longer claims them", () => {
    const exif = chunk("EXIF", [...ascii("Exif\0\0GPS 18.4655 N 66.1057 W"), 1, 2]);
    const xmp = chunk("XMP ", ascii("<x:xmpmeta>Camera owner: Ada</x:xmpmeta>"));
    const icc = chunk("ICCP", [1, 2, 3, 4]);
    const odd = chunk("ZZZZ", ascii("hidden"));
    const dirty = riff(vp8x(0x20 | 0x08 | 0x04, 800, 600), icc, vp8(800, 600), exif, xmp, odd);
    const clean = cleanWebp(dirty)!;
    expect(clean).not.toBeNull();
    expect(clean.width).toBe(800);
    expect(clean.height).toBe(600);
    expect(text(clean.bytes)).not.toMatch(/EXIF|Exif|GPS|XMP|xmpmeta|Ada|ICCP|ZZZZ|hidden/);
    expect(clean.bytes).toEqual(riff(vp8(800, 600)));
  });

  test("alpha stays, in an extended header that sets only the alpha flag", () => {
    const alph = chunk("ALPH", [0, 7, 7, 7]);
    const clean = cleanWebp(riff(vp8x(0x10 | 0x08, 32, 16), alph, vp8(32, 16), chunk("EXIF", [1, 2, 3])))!;
    expect(clean.bytes).toEqual(riff(vp8x(0x10, 32, 16), alph, vp8(32, 16)));
  });

  test("refuses animation, a lying header, a second image, trailing bytes, a truncated chunk and a broken frame", () => {
    const bad: Array<[string, Uint8Array]> = [
      ["animation", riff(vp8x(0x02, 8, 8), chunk("ANIM", [0, 0, 0, 0, 0, 0]), chunk("ANMF", [0, 0, 0]))],
      ["canvas differs from the frame", riff(vp8x(0, 100, 100), vp8(50, 50))],
      ["two images", riff(vp8(8, 8), vp8(8, 8))],
      ["no image", riff(chunk("EXIF", [1, 2]))],
      ["alpha without the extended header", riff(chunk("ALPH", [0, 1]), vp8(8, 8))],
      ["bad start code", riff(chunk("VP8 ", [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2b, 8, 0, 8, 0]))],
      ["bad lossless signature", riff(chunk("VP8L", [0x2e, 0, 0, 0, 0]))],
      ["zero width", riff(vp8(0, 8))],
    ];
    for (const [why, bytes] of bad) expect(cleanWebp(bytes), why).toBeNull();
    const ok = riff(vp8(8, 8));
    expect(cleanWebp(new Uint8Array([...ok, 0, 0])), "trailing bytes").toBeNull();
    expect(cleanWebp(ok.slice(0, ok.length - 2)), "truncated").toBeNull();
    const lying = ok.slice();
    lying.set(u32(9999), 4);
    expect(cleanWebp(lying), "RIFF size").toBeNull();
    expect(cleanWebp(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "a JPEG").toBeNull();
  });
});
