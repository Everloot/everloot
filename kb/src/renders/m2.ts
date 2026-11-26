/**
 * Reads the parts of a model file (chunked M2, "MD21") and its .skin that a still picture needs: the vertices,
 * the texture slots and materials, the bones with the stand animation's first key, and the skin's triangles
 * and batches. Written from the public format notes on wowdev.wiki; no third-party model code. File ids come
 * from the model's own chunks (SFID skins, TXID textures, AFID animation files), never from a listfile.
 */

interface M2Array { count: number; offset: number }
const arr = (b: Buffer, off: number): M2Array => ({ count: b.readUInt32LE(off), offset: b.readUInt32LE(off + 4) });

/** An animated value: per animation (or per global sequence), its key times and values. */
export interface Track { globalSequence: number; times: M2Array; values: M2Array }
const track = (b: Buffer, off: number): Track => ({ globalSequence: b.readInt16LE(off + 2), times: arr(b, off + 4), values: arr(b, off + 12) });

export interface Sequence { id: number; variation: number; flags: number; aliasNext: number }
export interface Bone { parent: number; translation: Track; rotation: Track; scale: Track; pivot: [number, number, number] }

export interface M2Model {
  /** The MD20 block; every offset in it is relative to its start. */
  md: Buffer;
  vertexCount: number;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  boneIndices: Uint8Array;
  boneWeights: Uint8Array;
  textures: { type: number }[];
  materials: { flags: number; blend: number }[];
  textureCombos: number[];
  textureWeights: Track[];
  textureWeightCombos: number[];
  colorAlpha: Track[];
  sequences: Sequence[];
  bones: Bone[];
  skinFileIds: number[];
  txid: number[];
  animFiles: { animId: number; subAnimId: number; fileId: number }[];
}

/** SequenceFlags: the keys of this animation are in the M2 itself, not in an .anim file. */
const SEQ_IN_M2 = 0x20;
/** SequenceFlags: this entry is an alias; `aliasNext` is the one to play. */
const SEQ_ALIAS = 0x40;
/** Animation id 0 is "Stand". */
const STAND = 0;

export function readChunks(data: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let i = 0;
  while (i + 8 <= data.length) {
    const tag = data.toString("latin1", i, i + 4);
    const size = data.readUInt32LE(i + 4);
    if (i + 8 + size > data.length) throw new Error(`chunk ${tag} runs past the end of the file`);
    out.set(tag, data.subarray(i + 8, i + 8 + size));
    i += 8 + size;
  }
  return out;
}

const u32s = (b: Buffer | undefined) => (b ? Array.from({ length: b.length >> 2 }, (_, i) => b.readUInt32LE(4 * i)) : []);
const u16s = (b: Buffer, a: M2Array) => Array.from({ length: a.count }, (_, i) => b.readUInt16LE(a.offset + 2 * i));

export function readM2(file: Buffer): M2Model {
  const chunks = readChunks(file);
  const md = chunks.get("MD21");
  if (!md || md.toString("latin1", 0, 4) !== "MD20") throw new Error("not a chunked model file (no MD21 chunk)");
  const v = arr(md, 60);
  const positions = new Float32Array(v.count * 3), normals = new Float32Array(v.count * 3), uvs = new Float32Array(v.count * 2);
  const boneIndices = new Uint8Array(v.count * 4), boneWeights = new Uint8Array(v.count * 4);
  for (let i = 0; i < v.count; i++) {
    const o = v.offset + 48 * i;
    for (let k = 0; k < 3; k++) { positions[3 * i + k] = md.readFloatLE(o + 4 * k); normals[3 * i + k] = md.readFloatLE(o + 20 + 4 * k); }
    for (let k = 0; k < 4; k++) { boneWeights[4 * i + k] = md[o + 12 + k]; boneIndices[4 * i + k] = md[o + 16 + k]; }
    uvs[2 * i] = md.readFloatLE(o + 32); uvs[2 * i + 1] = md.readFloatLE(o + 36);
  }
  const list = <T>(off: number, size: number, read: (o: number) => T): T[] => {
    const a = arr(md, off);
    return Array.from({ length: a.count }, (_, i) => read(a.offset + size * i));
  };
  const afid = chunks.get("AFID");
  return {
    md, vertexCount: v.count, positions, normals, uvs, boneIndices, boneWeights,
    textures: list(80, 16, (o) => ({ type: md.readUInt32LE(o) })),
    materials: list(112, 4, (o) => ({ flags: md.readUInt16LE(o), blend: md.readUInt16LE(o + 2) })),
    textureCombos: u16s(md, arr(md, 128)),
    textureWeights: list(88, 20, (o) => track(md, o)),
    textureWeightCombos: u16s(md, arr(md, 144)),
    colorAlpha: list(72, 40, (o) => track(md, o + 20)),
    sequences: list(28, 64, (o) => ({ id: md.readUInt16LE(o), variation: md.readUInt16LE(o + 2), flags: md.readUInt32LE(o + 12), aliasNext: md.readUInt16LE(o + 62) })),
    bones: list(44, 88, (o) => ({
      parent: md.readInt16LE(o + 8), translation: track(md, o + 16), rotation: track(md, o + 36), scale: track(md, o + 56),
      pivot: [md.readFloatLE(o + 76), md.readFloatLE(o + 80), md.readFloatLE(o + 84)],
    })),
    skinFileIds: u32s(chunks.get("SFID")).slice(0, md.readUInt32LE(68)),
    txid: u32s(chunks.get("TXID")),
    animFiles: afid ? Array.from({ length: afid.length >> 3 }, (_, i) => ({ animId: afid.readUInt16LE(8 * i), subAnimId: afid.readUInt16LE(8 * i + 2), fileId: afid.readUInt32LE(8 * i + 4) })) : [],
  };
}

export interface SkinSection { id: number; indexStart: number; indexCount: number }
export interface SkinBatch { section: number; color: number; material: number; textureCombo: number; weightCombo: number }
export interface Skin { vertexMap: Uint16Array; indices: Uint16Array; sections: SkinSection[]; batches: SkinBatch[] }

export function readSkin(file: Buffer): Skin {
  if (file.toString("latin1", 0, 4) !== "SKIN") throw new Error("not a .skin file (no SKIN magic)");
  const vm = arr(file, 4), ix = arr(file, 12), sec = arr(file, 28), bat = arr(file, 36);
  const copy16 = (a: M2Array) => { const out = new Uint16Array(a.count); for (let i = 0; i < a.count; i++) out[i] = file.readUInt16LE(a.offset + 2 * i); return out; };
  return {
    vertexMap: copy16(vm), indices: copy16(ix),
    sections: Array.from({ length: sec.count }, (_, i) => {
      const o = sec.offset + 48 * i;
      return { id: file.readUInt16LE(o), indexStart: file.readUInt16LE(o + 8) + (file.readUInt16LE(o + 2) << 16), indexCount: file.readUInt16LE(o + 10) };
    }),
    batches: Array.from({ length: bat.count }, (_, i) => {
      const o = bat.offset + 24 * i;
      return { section: file.readUInt16LE(o + 4), color: file.readInt16LE(o + 8), material: file.readUInt16LE(o + 10), textureCombo: file.readUInt16LE(o + 16), weightCombo: file.readUInt16LE(o + 20) };
    }),
  };
}

/** The stand animation to pose with, and the .anim file its keys are in (null: in the M2). Null when the model has none. */
export interface Stand { index: number; animFileId: number | null }

export function standSequence(m: M2Model): Stand | null {
  let index = m.sequences.findIndex((s) => s.id === STAND);
  for (let hops = 0; index >= 0 && m.sequences[index].flags & SEQ_ALIAS && hops < 8; hops++) index = m.sequences[index].aliasNext;
  const seq = m.sequences[index];
  if (!seq) return null;
  if (seq.flags & SEQ_IN_M2) return { index, animFileId: null };
  const file = m.animFiles.find((a) => a.animId === seq.id && a.subAnimId === seq.variation);
  return { index, animFileId: file?.fileId ?? null };
}

/** The body of an .anim file the keys' offsets point into: the AFM2 chunk of a chunked file, else the whole file. */
export function animBody(file: Buffer): Buffer {
  return file.toString("latin1", 0, 4) === "AFM2" ? readChunks(file).get("AFM2")! : file;
}

/**
 * Where the first key of a track for the stand animation is, or null when it has none. The per-animation key
 * lists are always listed in the M2; their contents are in `anim` (the .anim body) when the stand animation's
 * keys live in an .anim file. A track on a global sequence always reads from the M2.
 */
function firstKey(m: M2Model, t: Track, stand: Stand | null, anim: Buffer | null): { buf: Buffer; off: number } | null {
  const global = t.globalSequence >= 0;
  if (!global && !stand) return null;
  const idx = global ? 0 : stand!.index;
  if (idx >= t.values.count) return null;
  const sub = arr(m.md, t.values.offset + 8 * idx);
  const buf = global || stand!.animFileId === null ? m.md : anim;
  return sub.count && buf ? { buf, off: sub.offset } : null;
}

type Mat = Float64Array;
const identity = (): Mat => { const m = new Float64Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
/** Column-major 4x4 product a * b. */
function mul(a: Mat, b: Mat): Mat {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
const translate = (x: number, y: number, z: number): Mat => { const m = identity(); m[12] = x; m[13] = y; m[14] = z; return m; };
function rotate(x: number, y: number, z: number, w: number): Mat {
  const n = Math.hypot(x, y, z, w) || 1;
  x /= n; y /= n; z /= n; w /= n;
  const m = identity();
  m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y + z * w); m[2] = 2 * (x * z - y * w);
  m[4] = 2 * (x * y - z * w); m[5] = 1 - 2 * (x * x + z * z); m[6] = 2 * (y * z + x * w);
  m[8] = 2 * (x * z + y * w); m[9] = 2 * (y * z - x * w); m[10] = 1 - 2 * (x * x + y * y);
  return m;
}
const scaling = (x: number, y: number, z: number): Mat => { const m = identity(); m[0] = x; m[5] = y; m[10] = z; return m; };
/** M2CompQuat: four signed 16-bit numbers, decoded as the client does. */
const quatPart = (v: number) => (v < 0 ? v + 32768 : v - 32767) / 32767;

/** Each bone's matrix at the stand animation's first key: parent * T(pivot) * T(t) * R(r) * S(s) * T(-pivot). */
function boneMatrices(m: M2Model, stand: Stand | null, anim: Buffer | null): Mat[] {
  const out: (Mat | undefined)[] = new Array(m.bones.length);
  const local = (b: Bone): Mat => {
    let t = identity(), r = identity(), s = identity();
    const kt = firstKey(m, b.translation, stand, anim), kr = firstKey(m, b.rotation, stand, anim), ks = firstKey(m, b.scale, stand, anim);
    if (kt) t = translate(kt.buf.readFloatLE(kt.off), kt.buf.readFloatLE(kt.off + 4), kt.buf.readFloatLE(kt.off + 8));
    if (kr) r = rotate(...([0, 2, 4, 6].map((k) => quatPart(kr.buf.readInt16LE(kr.off + k))) as [number, number, number, number]));
    if (ks) s = scaling(ks.buf.readFloatLE(ks.off), ks.buf.readFloatLE(ks.off + 4), ks.buf.readFloatLE(ks.off + 8));
    const [px, py, pz] = b.pivot;
    return mul(mul(mul(mul(translate(px, py, pz), t), r), s), translate(-px, -py, -pz));
  };
  const resolve = (i: number, depth = 0): Mat => {
    if (out[i]) return out[i]!;
    const b = m.bones[i];
    const own = local(b);
    const mat = b.parent >= 0 && b.parent < m.bones.length && b.parent !== i && depth < 256 ? mul(resolve(b.parent, depth + 1), own) : own;
    out[i] = mat;
    return mat;
  };
  return m.bones.map((_, i) => resolve(i));
}

/**
 * The model's vertices posed at the stand animation's first frame (a T-pose model then stands as in the game).
 * With no stand animation, no bones, or keys in an .anim file that was not given, the bind pose is returned.
 */
export function poseMesh(m: M2Model, stand: Stand | null, anim: Buffer | null): { positions: Float32Array; normals: Float32Array } {
  if (!stand || !m.bones.length || (stand.animFileId !== null && !anim)) return { positions: m.positions.slice(), normals: m.normals.slice() };
  const mats = boneMatrices(m, stand, anim ? animBody(anim) : null);
  const positions = new Float32Array(m.vertexCount * 3), normals = new Float32Array(m.vertexCount * 3);
  for (let i = 0; i < m.vertexCount; i++) {
    const x = m.positions[3 * i], y = m.positions[3 * i + 1], z = m.positions[3 * i + 2];
    const nx = m.normals[3 * i], ny = m.normals[3 * i + 1], nz = m.normals[3 * i + 2];
    let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0, total = 0;
    for (let k = 0; k < 4; k++) {
      const w = m.boneWeights[4 * i + k] / 255;
      const mat = mats[m.boneIndices[4 * i + k]];
      if (!w || !mat) continue;
      total += w;
      px += w * (mat[0] * x + mat[4] * y + mat[8] * z + mat[12]);
      py += w * (mat[1] * x + mat[5] * y + mat[9] * z + mat[13]);
      pz += w * (mat[2] * x + mat[6] * y + mat[10] * z + mat[14]);
      qx += w * (mat[0] * nx + mat[4] * ny + mat[8] * nz);
      qy += w * (mat[1] * nx + mat[5] * ny + mat[9] * nz);
      qz += w * (mat[2] * nx + mat[6] * ny + mat[10] * nz);
    }
    if (!total) { px = x; py = y; pz = z; qx = nx; qy = ny; qz = nz; }
    const len = Math.hypot(qx, qy, qz) || 1;
    positions.set([px, py, pz], 3 * i);
    normals.set([qx / len, qy / len, qz / len], 3 * i);
  }
  return { positions, normals };
}

/** One textured run of triangles to draw: vertex indices into the model's (posed) vertices. */
export interface DrawBatch { triangles: Uint32Array; textureFileId: number; blend: number; alpha: number }
export interface DrawList { batches: DrawBatch[]; skipped: { geoset: number; blend: number; texture: number; hidden: number } }

/** Blend modes drawn: opaque, alpha key and alpha blend. Additive and modulating glows are left out of a still picture. */
const DRAWN_BLENDS = new Set([0, 1, 2]);

/**
 * What to draw: the skin's batches whose geoset is shown, whose texture slot has a file and whose blend mode is
 * drawn. Geoset 0 always shows; in every other group (id / 100) the variant `geosets` names, else variant 1.
 * `replaceable` gives the file for each texture type other than 0 (2: the item's own texture, 11-13: the
 * creature display's skins); type 0 takes the model's own TXID file.
 */
export function drawList(m: M2Model, skin: Skin, opts: { replaceable: Record<number, number>; geosets?: number[]; stand?: Stand | null; anim?: Buffer | null }): DrawList {
  const chosen = new Map((opts.geosets ?? []).map((g) => [Math.floor(g / 100), g % 100]));
  const shown = (id: number) => id === 0 || id % 100 === (chosen.get(Math.floor(id / 100)) ?? 1);
  const skipped = { geoset: 0, blend: 0, texture: 0, hidden: 0 };
  const stand = opts.stand ?? null;
  const anim = opts.anim ? animBody(opts.anim) : null;
  const fixed = (t: Track | undefined) => {
    const k = t ? firstKey(m, t, stand, anim) : null;
    return k ? Math.max(0, Math.min(1, k.buf.readInt16LE(k.off) / 32767)) : 1;
  };
  const batches: DrawBatch[] = [];
  for (const b of skin.batches) {
    const section = skin.sections[b.section];
    if (!section || !shown(section.id)) { skipped.geoset += 1; continue; }
    const material = m.materials[b.material];
    if (!material || !DRAWN_BLENDS.has(material.blend)) { skipped.blend += 1; continue; }
    const texIndex = m.textureCombos[b.textureCombo];
    const tex = texIndex === undefined ? undefined : m.textures[texIndex];
    const file = !tex ? 0 : tex.type === 0 ? (m.txid[texIndex] ?? 0) : (opts.replaceable[tex.type] ?? 0);
    if (!file) { skipped.texture += 1; continue; }
    const alpha = fixed(m.textureWeights[m.textureWeightCombos[b.weightCombo]]) * (b.color >= 0 ? fixed(m.colorAlpha[b.color]) : 1);
    if (alpha < 0.01) { skipped.hidden += 1; continue; }
    const triangles = new Uint32Array(section.indexCount);
    for (let i = 0; i < section.indexCount; i++) triangles[i] = skin.vertexMap[skin.indices[section.indexStart + i]];
    batches.push({ triangles, textureFileId: file, blend: material.blend, alpha });
  }
  return { batches, skipped };
}
