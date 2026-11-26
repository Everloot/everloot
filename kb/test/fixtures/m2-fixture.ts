/**
 * Builds tiny chunked M2 (MD21), .skin and .anim files in memory for the render tests. Every number here is
 * made up; no byte comes from a Blizzard file. The layout follows the public format notes on wowdev.wiki
 * (header offsets, 48-byte vertices, 64-byte sequences, 88-byte bones, 20-byte tracks, 48-byte skin
 * sections, 24-byte batches).
 */

export interface FixtureVertex { pos: [number, number, number]; normal?: [number, number, number]; uv?: [number, number]; bones?: [number, number, number, number]; weights?: [number, number, number, number] }
/** A track with one key at time 0 for the stand sequence; `global` puts it on global sequence 0. */
export interface FixtureBone { parent?: number; pivot?: [number, number, number]; translation?: [number, number, number]; rotation?: [number, number, number, number]; global?: boolean }
export interface FixtureSequence { id: number; variation?: number; flags: number; aliasNext?: number }
export interface FixtureBatch { section: number; material: number; textureCombo: number; color?: number; weightCombo?: number }
export interface FixtureM2 {
  vertices: FixtureVertex[];
  textures: { type: number }[];
  /** File ids for the type-0 textures, in texture order (the TXID chunk). */
  txid?: number[];
  materials: { flags?: number; blend: number }[];
  textureCombos: number[];
  sequences?: FixtureSequence[];
  bones?: FixtureBone[];
  /** Texture weights at frame 0, as fixed-point 0..32767. */
  weights?: number[];
  weightCombos?: number[];
  skins: number[];
  /** [animId, subAnimId, fileId] */
  afid?: [number, number, number][];
  /** Put the stand sequence's bone keys in a separate .anim body instead of the M2 (returned as `anim`). */
  externalKeys?: boolean;
}

class Writer {
  buf = Buffer.alloc(0);
  at(): number { return this.buf.length; }
  append(b: Buffer): number { const off = this.buf.length; this.buf = Buffer.concat([this.buf, b]); return off; }
  pad(n: number) { this.append(Buffer.alloc(n)); }
}

const u16 = (...v: number[]) => { const b = Buffer.alloc(2 * v.length); v.forEach((x, i) => b.writeUInt16LE(x, 2 * i)); return b; };
const i16 = (...v: number[]) => { const b = Buffer.alloc(2 * v.length); v.forEach((x, i) => b.writeInt16LE(x, 2 * i)); return b; };
const u32 = (...v: number[]) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeUInt32LE(x, 4 * i)); return b; };
const f32 = (...v: number[]) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeFloatLE(x, 4 * i)); return b; };
/** A quaternion as the file stores it (M2CompQuat): the reader decodes v as (v < 0 ? v + 32768 : v - 32767) / 32767. */
export const packQuat = (q: [number, number, number, number]) => {
  const b = Buffer.alloc(8);
  q.forEach((f, i) => b.writeInt16LE(f >= 0 ? Math.round(f * 32767) - 32768 : Math.round(f * 32767) + 32767, 2 * i));
  return b;
};

export function chunk(tag: string, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from(tag, "latin1"), u32(body.length), body]);
}

export function buildM2(m: FixtureM2): { file: Buffer; anim: Buffer | null } {
  const HEADER = 0x130;
  const w = new Writer();
  w.pad(HEADER);
  const header = Buffer.alloc(HEADER);
  header.write("MD20", 0, "latin1");
  header.writeUInt32LE(274, 4);
  const setArr = (off: number, count: number, offset: number) => { header.writeUInt32LE(count, off); header.writeUInt32LE(offset, off + 4); };
  const anim = new Writer();

  // Vertices, 48 bytes each.
  const verts = Buffer.concat(m.vertices.map((v) => {
    const b = Buffer.alloc(48);
    v.pos.forEach((x, i) => b.writeFloatLE(x, 4 * i));
    (v.weights ?? [255, 0, 0, 0]).forEach((x, i) => b.writeUInt8(x, 12 + i));
    (v.bones ?? [0, 0, 0, 0]).forEach((x, i) => b.writeUInt8(x, 16 + i));
    (v.normal ?? [1, 0, 0]).forEach((x, i) => b.writeFloatLE(x, 20 + 4 * i));
    (v.uv ?? [0, 0]).forEach((x, i) => b.writeFloatLE(x, 32 + 4 * i));
    return b;
  }));
  setArr(60, m.vertices.length, w.append(verts));
  header.writeUInt32LE(m.skins.length, 68);

  const textures = Buffer.concat(m.textures.map((t) => Buffer.concat([u32(t.type, 0), u32(0, 0)])));
  setArr(80, m.textures.length, m.textures.length ? w.append(textures) : 0);
  setArr(112, m.materials.length, w.append(Buffer.concat(m.materials.map((x) => u16(x.flags ?? 0, x.blend)))));
  setArr(128, m.textureCombos.length, w.append(u16(...m.textureCombos)));

  const seqs = m.sequences ?? [];
  // Tracks: one key at time 0, the same in every sequence's slot (or in global sequence 0's).
  const trackOf = (value: Buffer | null, global: boolean): Buffer => {
    const t = Buffer.alloc(20);
    t.writeUInt16LE(0, 0);
    t.writeInt16LE(global ? 0 : -1, 2);
    if (!value) return t;
    const external = m.externalKeys && !global;
    const target = external ? anim : w;
    const times = target.append(u32(0));
    const values = target.append(value);
    const slots = global ? 1 : Math.max(1, seqs.length);
    const timeHeaders = w.append(Buffer.concat(Array.from({ length: slots }, () => u32(1, times))));
    const valueHeaders = w.append(Buffer.concat(Array.from({ length: slots }, () => u32(1, values))));
    t.writeUInt32LE(slots, 4); t.writeUInt32LE(timeHeaders, 8);
    t.writeUInt32LE(slots, 12); t.writeUInt32LE(valueHeaders, 16);
    return t;
  };

  const seqBuf = Buffer.concat(seqs.map((s) => {
    const b = Buffer.alloc(64);
    b.writeUInt16LE(s.id, 0); b.writeUInt16LE(s.variation ?? 0, 2); b.writeUInt32LE(1000, 4); b.writeUInt32LE(s.flags, 12);
    b.writeInt16LE(-1, 60); b.writeUInt16LE(s.aliasNext ?? 0, 62);
    return b;
  }));
  setArr(28, seqs.length, seqs.length ? w.append(seqBuf) : 0);
  if (m.bones?.some((b) => b.global)) setArr(20, 1, w.append(u32(1000)));

  const bones = (m.bones ?? []).map((bone) => {
    const b = Buffer.alloc(88);
    b.writeInt32LE(-1, 0);
    b.writeInt16LE(bone.parent ?? -1, 8);
    trackOf(bone.translation ? f32(...bone.translation) : null, !!bone.global).copy(b, 16);
    trackOf(bone.rotation ? packQuat(bone.rotation) : null, !!bone.global).copy(b, 36);
    trackOf(null, false).copy(b, 56);
    (bone.pivot ?? [0, 0, 0]).forEach((x, i) => b.writeFloatLE(x, 76 + 4 * i));
    return b;
  });
  setArr(44, bones.length, bones.length ? w.append(Buffer.concat(bones)) : 0);

  if (m.weights) {
    const tracks = m.weights.map((x) => trackOf(i16(x), false));
    setArr(88, tracks.length, w.append(Buffer.concat(tracks)));
  }
  if (m.weightCombos) setArr(144, m.weightCombos.length, w.append(u16(...m.weightCombos)));

  header.copy(w.buf, 0);
  const parts = [chunk("MD21", w.buf), chunk("SFID", u32(...m.skins))];
  if (m.txid) parts.push(chunk("TXID", u32(...m.txid)));
  if (m.afid) parts.push(chunk("AFID", Buffer.concat(m.afid.map(([a, s, f]) => Buffer.concat([u16(a, s), u32(f)])))));
  return { file: Buffer.concat(parts), anim: m.externalKeys ? chunk("AFM2", anim.buf) : null };
}

export interface FixtureSkin { vertexMap: number[]; indices: number[]; sections: { id: number; indexStart: number; indexCount: number }[]; batches: FixtureBatch[] }

export function buildSkin(s: FixtureSkin): Buffer {
  const w = new Writer();
  w.pad(64);
  const head = Buffer.alloc(64);
  head.write("SKIN", 0, "latin1");
  const setArr = (off: number, count: number, offset: number) => { head.writeUInt32LE(count, off); head.writeUInt32LE(offset, off + 4); };
  setArr(4, s.vertexMap.length, w.append(u16(...s.vertexMap)));
  setArr(12, s.indices.length, w.append(u16(...s.indices)));
  setArr(28, s.sections.length, w.append(Buffer.concat(s.sections.map((x) => {
    const b = Buffer.alloc(48);
    b.writeUInt16LE(x.id, 0); b.writeUInt16LE(x.indexStart >> 16, 2); b.writeUInt16LE(x.indexStart & 0xffff, 8); b.writeUInt16LE(x.indexCount, 10);
    return b;
  }))));
  setArr(36, s.batches.length, w.append(Buffer.concat(s.batches.map((x) => {
    const b = Buffer.alloc(24);
    b.writeUInt16LE(x.section, 4); b.writeInt16LE(x.color ?? -1, 8); b.writeUInt16LE(x.material, 10);
    b.writeUInt16LE(1, 14); b.writeUInt16LE(x.textureCombo, 16); b.writeUInt16LE(x.weightCombo ?? 0, 20);
    return b;
  }))));
  head.copy(w.buf, 0);
  return w.buf;
}
