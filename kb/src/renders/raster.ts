/**
 * A small software rasteriser for one still picture of a posed model: orthographic camera, depth buffer,
 * bilinear texture lookup, simple Lambert light, alpha key and alpha blend. No GPU, browser or native module,
 * so it runs wherever `client-assets` runs and gives the same picture each time for the same files.
 */

/** Straight (not premultiplied) RGBA, row by row from the top. */
export interface Texture { width: number; height: number; data: Uint8Array }
export interface RenderBatch { triangles: Uint32Array; texture: Texture; blend: number; alpha: number }
export interface Mesh { positions: Float32Array; normals: Float32Array; uvs: Float32Array }
export interface Camera {
  /** Square picture size in pixels. */
  size: number;
  /** Turn about the up axis, degrees; the model faces +x, so a negative yaw shows its right side. */
  yaw?: number;
  /** Camera height, degrees above the model's horizon. */
  pitch?: number;
  /** Share of the picture the model's longer side fills. */
  margin?: number;
}

/** WoW's alpha-key threshold (224/255): below it a texel of an alpha-key material is not drawn. */
const ALPHA_KEY = 224 / 255;
const LIGHT = (() => { const l = [0.6, -0.3, 0.75]; const n = Math.hypot(...l); return l.map((x) => x / n); })();
const AMBIENT = 0.45;

function sample(t: Texture, u: number, v: number, out: Float64Array) {
  const fu = (u - Math.floor(u)) * t.width - 0.5, fv = (v - Math.floor(v)) * t.height - 0.5;
  const x0 = Math.floor(fu), y0 = Math.floor(fv), ax = fu - x0, ay = fv - y0;
  const wrap = (i: number, n: number) => ((i % n) + n) % n;
  const xa = wrap(x0, t.width), xb = wrap(x0 + 1, t.width), ya = wrap(y0, t.height), yb = wrap(y0 + 1, t.height);
  for (let c = 0; c < 4; c++) {
    const p = (x: number, y: number) => t.data[4 * (y * t.width + x) + c];
    out[c] = ((p(xa, ya) * (1 - ax) + p(xb, ya) * ax) * (1 - ay) + (p(xa, yb) * (1 - ax) + p(xb, yb) * ax) * ay) / 255;
  }
}

export function rasterize(mesh: Mesh, batches: RenderBatch[], cam: Camera): Uint8Array {
  const { size } = cam;
  const yaw = ((cam.yaw ?? -35) * Math.PI) / 180, pitch = ((cam.pitch ?? 10) * Math.PI) / 180, margin = cam.margin ?? 0.86;
  const img = new Float64Array(size * size * 4);
  const out = new Uint8Array(size * size * 4);
  const count = mesh.positions.length / 3;
  const used = new Uint8Array(count);
  for (const b of batches) for (const i of b.triangles) if (i < count) used[i] = 1;

  // Camera space: x toward the camera, y to the picture's left, z up. Screen x = -y, screen y = -z, depth = -x.
  const ca = Math.cos(yaw), sa = Math.sin(yaw), cb = Math.cos(pitch), sb = Math.sin(pitch);
  const X = new Float64Array(count), Y = new Float64Array(count), D = new Float64Array(count), L = new Float64Array(count);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const turn = (x: number, y: number, z: number) => {
    const x1 = x * ca - y * sa, y1 = x * sa + y * ca;
    return [x1 * cb + z * sb, y1, -x1 * sb + z * cb];
  };
  for (let i = 0; i < count; i++) {
    if (!used[i]) continue;
    const [x, y, z] = turn(mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]);
    X[i] = -y; Y[i] = -z; D[i] = -x;
    let [nx, ny, nz] = turn(mesh.normals[3 * i], mesh.normals[3 * i + 1], mesh.normals[3 * i + 2]);
    if (nx < 0) { nx = -nx; ny = -ny; nz = -nz; } // both faces are lit, as the one the camera sees
    L[i] = AMBIENT + (1 - AMBIENT) * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    minX = Math.min(minX, X[i]); maxX = Math.max(maxX, X[i]); minY = Math.min(minY, Y[i]); maxY = Math.max(maxY, Y[i]);
  }
  if (minX === Infinity) return out;
  const extent = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = (size * margin) / extent, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  for (let i = 0; i < count; i++) if (used[i]) { X[i] = (X[i] - cx) * scale + size / 2; Y[i] = (Y[i] - cy) * scale + size / 2; }

  const zbuf = new Float64Array(size * size).fill(Infinity);
  const texel = new Float64Array(4);
  const draw = (a: number, b: number, c: number, batch: RenderBatch) => {
    const area = (X[b] - X[a]) * (Y[c] - Y[a]) - (X[c] - X[a]) * (Y[b] - Y[a]);
    if (Math.abs(area) < 1e-12) return;
    const x0 = Math.max(0, Math.floor(Math.min(X[a], X[b], X[c]))), x1 = Math.min(size - 1, Math.ceil(Math.max(X[a], X[b], X[c])));
    const y0 = Math.max(0, Math.floor(Math.min(Y[a], Y[b], Y[c]))), y1 = Math.min(size - 1, Math.ceil(Math.max(Y[a], Y[b], Y[c])));
    const blend = batch.blend;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const sx = px + 0.5, sy = py + 0.5;
        const w0 = ((X[b] - sx) * (Y[c] - sy) - (X[c] - sx) * (Y[b] - sy)) / area;
        const w1 = ((X[c] - sx) * (Y[a] - sy) - (X[a] - sx) * (Y[c] - sy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const p = py * size + px;
        const z = w0 * D[a] + w1 * D[b] + w2 * D[c];
        if (z >= zbuf[p]) continue;
        const uv = mesh.uvs;
        sample(batch.texture, w0 * uv[2 * a] + w1 * uv[2 * b] + w2 * uv[2 * c], w0 * uv[2 * a + 1] + w1 * uv[2 * b + 1] + w2 * uv[2 * c + 1], texel);
        const shade = w0 * L[a] + w1 * L[b] + w2 * L[c];
        const o = 4 * p;
        if (blend === 2) {
          const s = texel[3] * batch.alpha;
          if (s <= 0) continue;
          const da = img[o + 3], oa = s + da * (1 - s);
          for (let k = 0; k < 3; k++) img[o + k] = (texel[k] * shade * s + img[o + k] * da * (1 - s)) / oa;
          img[o + 3] = oa;
          continue; // a see-through surface does not hide what is drawn behind it later
        }
        if (blend === 1 && texel[3] < ALPHA_KEY) continue;
        for (let k = 0; k < 3; k++) img[o + k] = texel[k] * shade;
        img[o + 3] = 1;
        zbuf[p] = z;
      }
    }
  };
  // Solid surfaces first, then the see-through ones from far to near.
  const blended: { a: number; b: number; c: number; batch: RenderBatch; depth: number }[] = [];
  for (const batch of batches) {
    const t = batch.triangles;
    for (let i = 0; i + 2 < t.length; i += 3) {
      const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
      if (a >= count || b >= count || c >= count) continue;
      if (batch.blend === 2) blended.push({ a, b, c, batch, depth: Math.max(D[a], D[b], D[c]) });
      else draw(a, b, c, batch);
    }
  }
  blended.sort((p, q) => q.depth - p.depth);
  for (const t of blended) draw(t.a, t.b, t.c, t.batch);
  for (let i = 0; i < img.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(img[i] * 255)));
  return out;
}
