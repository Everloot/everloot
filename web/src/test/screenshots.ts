import { vi } from "vitest";

/** Test doubles for the screenshot routes: a WebP built by hand, an in-memory bucket and a Cloudflare Images stand-in. */

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const chunk = (type: string, data: number[]) => [...ascii(type), ...u32(data.length), ...data, ...(data.length % 2 ? [0] : [])];
const riff = (...chunks: number[][]) => {
  const body = [...ascii("WEBP"), ...chunks.flat()];
  return new Uint8Array([...ascii("RIFF"), ...u32(body.length), ...body]);
};
const vp8 = (w: number, h: number) => chunk("VP8 ", [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, w & 255, w >> 8, h & 255, h >> 8, 1, 2]);

export const webp = (w: number, h: number) => riff(vp8(w, h));
/** What a careless encoder might hand back: the picture with the camera's GPS in an EXIF chunk. */
export const webpWithExif = (w: number, h: number) =>
  riff(chunk("VP8X", [0x08, 0, 0, 0, (w - 1) & 255, (w - 1) >> 8, 0, (h - 1) & 255, (h - 1) >> 8, 0]), vp8(w, h), chunk("EXIF", ascii("GPS 18.46N 66.10W")));
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii("IHDR")]);
export const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

export function fakeBucket() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    get: vi.fn(async (key: string) => {
      const value = objects.get(key);
      return value ? { arrayBuffer: async () => value.slice().buffer } : null;
    }),
    put: vi.fn(async (key: string, value: Uint8Array) => { objects.set(key, new Uint8Array(value)); }),
    delete: vi.fn(async (keys: string | string[]) => { for (const k of [keys].flat()) objects.delete(k); }),
  };
}

/** Cloudflare Images as far as the site uses it: reads a format and size, then returns `out`. */
export function fakeImages(info: { format: string; width?: number; height?: number }, out: Uint8Array = webp(1920, 1080)) {
  const output = vi.fn(async () => ({ response: () => new Response(out.slice()) }));
  const transform = vi.fn(() => chain);
  const chain = { transform, output };
  return { info: vi.fn(async () => info), input: vi.fn(() => chain), transform, output };
}
