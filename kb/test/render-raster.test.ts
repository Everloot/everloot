import { describe, expect, test } from "vitest";
import { rasterize, type Texture } from "../src/renders/raster.js";

const solid = (r: number, g: number, b: number, a = 255): Texture => ({ width: 2, height: 2, data: new Uint8Array(Array.from({ length: 4 }, () => [r, g, b, a]).flat()) });
/** Two squares in the y/z plane, facing the camera on +x; the second sits at `x2`, half the size, in the middle. */
function scene(x2: number) {
  const quad = (x: number, s: number) => [[x, -s, -s], [x, s, -s], [x, s, s], [x, -s, s]].flat();
  const positions = new Float32Array([...quad(0, 1), ...quad(x2, 0.5)]);
  const normals = new Float32Array(Array.from({ length: 8 }, () => [1, 0, 0]).flat());
  const uvs = new Float32Array(Array.from({ length: 8 }, () => [0.5, 0.5]).flat());
  return { positions, normals, uvs };
}
const big = new Uint32Array([0, 1, 2, 0, 2, 3]);
const small = new Uint32Array([4, 5, 6, 4, 6, 7]);
const px = (img: Uint8Array, size: number, x: number, y: number) => [...img.subarray(4 * (y * size + x), 4 * (y * size + x) + 4)];
const flat = { size: 32, yaw: 0, pitch: 0, margin: 0.5 };

describe("rasterize", () => {
  test("fits the model in the frame on a transparent background", () => {
    const img = rasterize(scene(0), [{ triangles: big, texture: solid(200, 0, 0), blend: 0, alpha: 1 }], flat);
    expect(img.length).toBe(32 * 32 * 4);
    expect(px(img, 32, 16, 16)[0]).toBeGreaterThan(100);
    expect(px(img, 32, 16, 16)[3]).toBe(255);
    expect(px(img, 32, 1, 1)).toEqual([0, 0, 0, 0]);
    // margin 0.5: the square covers the middle half, so a pixel just inside its edge is drawn and one outside is not.
    expect(px(img, 32, 9, 16)[3]).toBe(255);
    expect(px(img, 32, 6, 16)[3]).toBe(0);
  });

  test("the nearer surface wins whatever the draw order", () => {
    const red = { triangles: big, texture: solid(255, 0, 0), blend: 0, alpha: 1 };
    const blue = { triangles: small, texture: solid(0, 0, 255), blend: 0, alpha: 1 };
    for (const order of [[red, blue], [blue, red]]) {
      const front = rasterize(scene(1), order, flat);
      expect(px(front, 32, 16, 16)[2]).toBeGreaterThan(100);
      const behind = rasterize(scene(-1), order, flat);
      expect(px(behind, 32, 16, 16)[0]).toBeGreaterThan(100);
    }
  });

  test("alpha key drops see-through texels; alpha blend mixes over what is behind", () => {
    const keyed = rasterize(scene(0), [{ triangles: big, texture: solid(255, 0, 0, 100), blend: 1, alpha: 1 }], flat);
    expect(px(keyed, 32, 16, 16)[3]).toBe(0);
    const mixed = rasterize(scene(1), [
      { triangles: big, texture: solid(255, 0, 0), blend: 0, alpha: 1 },
      { triangles: small, texture: solid(0, 0, 255, 128), blend: 2, alpha: 1 },
    ], flat);
    const [r, , b, a] = px(mixed, 32, 16, 16);
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(40);
    expect(b).toBeGreaterThan(40);
  });

  test("nothing to draw gives an empty picture", () => {
    expect(rasterize(scene(0), [], flat).every((v) => v === 0)).toBe(true);
  });
});
