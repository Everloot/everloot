import { describe, expect, test } from "vitest";
import { drawList, poseMesh, readM2, readSkin, standSequence } from "../src/renders/m2.js";
import { buildM2, buildSkin, chunk, type FixtureM2 } from "./fixtures/m2-fixture.js";

// A unit square in the y/z plane (facing +x, the camera), two triangles, one texture slot of each kind.
const square: FixtureM2 = {
  vertices: [
    { pos: [0, -1, 0], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 1] },
    { pos: [0, 1, 2], uv: [1, 0] }, { pos: [0, -1, 2], uv: [0, 0] },
  ],
  textures: [{ type: 0 }, { type: 11 }, { type: 2 }],
  txid: [7001, 0, 0],
  materials: [{ blend: 0 }, { blend: 1 }, { blend: 4 }],
  textureCombos: [0, 1, 2],
  skins: [8001],
};
const squareSkin = buildSkin({
  vertexMap: [0, 1, 2, 3],
  indices: [0, 1, 2, 0, 2, 3, 0, 1, 2, 0, 2, 3, 0, 1, 2, 0, 1, 2],
  sections: [{ id: 0, indexStart: 0, indexCount: 6 }, { id: 101, indexStart: 6, indexCount: 6 }, { id: 102, indexStart: 12, indexCount: 3 }, { id: 0, indexStart: 15, indexCount: 3 }],
  batches: [
    { section: 0, material: 0, textureCombo: 0 },
    { section: 1, material: 1, textureCombo: 1 },
    { section: 2, material: 0, textureCombo: 2 },
    { section: 3, material: 2, textureCombo: 2 },
  ],
});

describe("readM2", () => {
  test("reads the chunked header, vertices, textures, materials and the file id chunks", () => {
    const m = readM2(buildM2({ ...square, afid: [[0, 0, 9001]] }).file);
    expect(m.vertexCount).toBe(4);
    expect([...m.positions.subarray(6, 9)]).toEqual([0, 1, 2]);
    expect([...m.uvs.subarray(2, 4)]).toEqual([1, 1]);
    expect(m.textures.map((t) => t.type)).toEqual([0, 11, 2]);
    expect(m.materials).toEqual([{ flags: 0, blend: 0 }, { flags: 0, blend: 1 }, { flags: 0, blend: 4 }]);
    expect(m.textureCombos).toEqual([0, 1, 2]);
    expect(m.skinFileIds).toEqual([8001]);
    expect(m.txid).toEqual([7001, 0, 0]);
    expect(m.animFiles).toEqual([{ animId: 0, subAnimId: 0, fileId: 9001 }]);
  });

  test("refuses a chunk that runs past the end and a file without MD21", () => {
    const file = buildM2(square).file;
    expect(() => readM2(file.subarray(0, file.length - 2))).toThrow(/past the end/);
    expect(() => readM2(chunk("SFID", Buffer.alloc(4)))).toThrow(/MD21/);
  });
});

describe("readSkin", () => {
  test("reads the vertex map, indices, sections and batches", () => {
    const s = readSkin(squareSkin);
    expect([...s.vertexMap]).toEqual([0, 1, 2, 3]);
    expect(s.indices.length).toBe(18);
    expect(s.sections[1]).toEqual({ id: 101, indexStart: 6, indexCount: 6 });
    expect(s.batches[1]).toMatchObject({ section: 1, material: 1, textureCombo: 1, color: -1 });
  });

  test("refuses a file that is not a skin", () => {
    expect(() => readSkin(Buffer.from("NOPE0000"))).toThrow(/SKIN/);
  });
});

describe("standSequence and poseMesh", () => {
  // A quarter turn about z (x -> y) on bone 0 at the stand animation's first key.
  const turn: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const posed: FixtureM2 = { ...square, vertices: [{ pos: [1, 0, 0], normal: [1, 0, 0] }], sequences: [{ id: 4, flags: 0x20 }, { id: 0, flags: 0x20 }], bones: [{ rotation: turn }] };

  test("without sequences the bind pose is kept", () => {
    const m = readM2(buildM2({ ...posed, sequences: [], bones: [{ rotation: turn }] }).file);
    expect(standSequence(m)).toBeNull();
    expect([...poseMesh(m, null, null).positions]).toEqual([1, 0, 0]);
  });

  test("a T-pose model is posed at the stand animation's first frame", () => {
    const m = readM2(buildM2(posed).file);
    const stand = standSequence(m);
    expect(stand).toEqual({ index: 1, animFileId: null });
    const { positions, normals } = poseMesh(m, stand, null);
    expect([...positions].map((x) => Math.round(x * 1e4) / 1e4)).toEqual([0, 1, 0]);
    expect([...normals].map((x) => Math.round(x * 1e4) / 1e4)).toEqual([0, 1, 0]);
  });

  test("translation and a parent bone's pivot compose like the client's bone matrices", () => {
    const m = readM2(buildM2({
      ...posed,
      vertices: [{ pos: [2, 0, 0], bones: [1, 0, 0, 0] }],
      bones: [{ translation: [0, 0, 5] }, { parent: 0, pivot: [1, 0, 0], rotation: turn }],
    }).file);
    // Bone 1 turns the vertex a quarter about its pivot (1,0,0): (2,0,0) -> (1,1,0); bone 0 lifts it by 5.
    expect([...poseMesh(m, standSequence(m), null).positions].map((x) => Math.round(x * 1e4) / 1e4)).toEqual([1, 1, 5]);
  });

  test("an alias stand follows its target, and keys stored in an .anim file are read from it", () => {
    const external = buildM2({ ...posed, sequences: [{ id: 0, flags: 0x40, aliasNext: 1 }, { id: 0, variation: 1, flags: 0 }], afid: [[0, 1, 9001]], externalKeys: true });
    const m = readM2(external.file);
    const stand = standSequence(m);
    expect(stand).toEqual({ index: 1, animFileId: 9001 });
    expect([...poseMesh(m, stand, external.anim).positions].map((x) => Math.round(x * 1e4) / 1e4)).toEqual([0, 1, 0]);
    // The .anim file was not available: the bind pose stands in, never a half-posed model.
    expect([...poseMesh(m, stand, null).positions]).toEqual([1, 0, 0]);
  });

  test("a bone on a global sequence takes its first key whatever the animation", () => {
    const m = readM2(buildM2({ ...posed, bones: [{ rotation: turn, global: true }] }).file);
    expect([...poseMesh(m, standSequence(m), null).positions].map((x) => Math.round(x * 1e4) / 1e4)).toEqual([0, 1, 0]);
  });
});

describe("drawList", () => {
  const m = readM2(buildM2(square).file);
  const s = readSkin(squareSkin);

  test("keeps geoset 0 and each group's first variant, resolves texture slots and leaves out glow batches", () => {
    const d = drawList(m, s, { replaceable: { 11: 7011, 2: 7002 } });
    expect(d.batches.map((b) => [b.textureFileId, b.blend, b.triangles.length])).toEqual([[7001, 0, 6], [7011, 1, 6]]);
    expect(d.skipped).toEqual({ geoset: 1, blend: 1, texture: 0, hidden: 0 });
  });

  test("a display's geoset choice replaces the group's default", () => {
    const d = drawList(m, s, { replaceable: { 11: 7011, 2: 7002 }, geosets: [102] });
    expect(d.batches.map((b) => b.textureFileId)).toEqual([7001, 7002]);
  });

  test("a slot with no file is left out and counted", () => {
    const d = drawList(m, s, { replaceable: {} });
    expect(d.batches.map((b) => b.textureFileId)).toEqual([7001]);
    expect(d.skipped.texture).toBe(1);
  });

  test("a batch whose texture weight is zero at the first frame is hidden", () => {
    const hidden = readM2(buildM2({ ...square, sequences: [{ id: 0, flags: 0x20 }], weights: [0, 32767], weightCombos: [0, 1] }).file);
    const skin = readSkin(buildSkin({
      vertexMap: [0, 1, 2, 3], indices: [0, 1, 2, 0, 2, 3],
      sections: [{ id: 0, indexStart: 0, indexCount: 6 }],
      batches: [{ section: 0, material: 0, textureCombo: 0, weightCombo: 0 }, { section: 0, material: 0, textureCombo: 0, weightCombo: 1 }],
    }));
    const d = drawList(hidden, skin, { replaceable: {}, stand: standSequence(hidden) });
    expect(d.batches).toHaveLength(1);
    expect(d.batches[0].alpha).toBeCloseTo(1);
    expect(d.skipped.hidden).toBe(1);
  });

  test("indices above 65535 use the section's level", () => {
    const skin = readSkin(buildSkin({ vertexMap: [0], indices: [0, 0, 0], sections: [{ id: 0, indexStart: 0x10000, indexCount: 3 }], batches: [] }));
    expect(skin.sections[0].indexStart).toBe(0x10000);
  });
});
