import { expect, test } from "vitest";
import { fixture } from "./fixture";
import { encodeBuild } from "./share";
import { buildTitle, previewPath, readPathCodes, summarizeBuild } from "./summary";

const code = (ranks: Record<number, { rank: number }>) => encodeBuild({ classSlug: "mage", specId: 1482, build: fixture.build, ranks });

test("a build is named by its leading tree and split, as players say it", () => {
  const empty = summarizeBuild(fixture, {});
  expect(empty).toMatchObject({ lead: null, spent: 0 });
  expect(buildTitle(fixture, empty)).toBe(fixture.className);
  const s = summarizeBuild(fixture, { 11: { rank: 3 } });
  expect(s.spent).toBe(3);
  expect(s.trees.map((t) => t.points)).toEqual(fixture.trees.map((t, i) => (i === 0 ? 3 : 0)));
  expect(buildTitle(fixture, s)).toBe(`${fixture.trees[0].name} ${fixture.className} ${s.split}`);
});

test("a build link's path carries one or two sets; a bad code is dropped, none loading is not a build", () => {
  const a = code({ 11: { rank: 2 } });
  expect(previewPath("mage", a, null)).toBe(`/tools/talents/mage/b/${a}`);
  expect(previewPath("mage", null, a)).toBe(`/tools/talents/mage/b/-/${a}`);
  expect(previewPath("mage", null, null)).toBeNull();
  expect(readPathCodes(fixture, [a])).toMatchObject({ first: a, second: null });
  expect(readPathCodes(fixture, ["-", a])).toMatchObject({ first: null, second: a });
  expect(readPathCodes(fixture, [a, "EL1-nonsense"])).toMatchObject({ first: a, second: null });
  expect(readPathCodes(fixture, ["junk"])).toBeNull();
});

test("a path segment that does not unescape is a bad code too, and reading it never throws", () => {
  const a = code({ 11: { rank: 2 } });
  for (const segment of ["%E0%A4%A", "%E0"]) {
    expect(readPathCodes(fixture, [segment]), segment).toBeNull();
    expect(readPathCodes(fixture, [a, segment]), segment).toMatchObject({ first: a, second: null });
  }
});

test("a path segment must read as a code whole, as the calculator reads it: a link's code inside one is not read", () => {
  const a = code({ 11: { rank: 2 } });
  for (const segment of [`junk%23plan=${a}`, `junk#plan=${a}`]) {
    expect(readPathCodes(fixture, [segment]), segment).toBeNull();
    expect(readPathCodes(fixture, [a, segment]), segment).toMatchObject({ first: a, second: null });
  }
});
