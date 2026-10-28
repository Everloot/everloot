import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { planHash, readPlanHash } from "./import";
import { decodeOrder, encodeOrder, type OrderError, type OrderOrigin } from "./share";
import type { Ranks } from "./types";

// The spend order vectors in docs/fixtures are shared by every reader and writer of the token, so they
// all agree case by case. This runs the site's codec and link helpers against each one.

type RankList = ([number, number] | [number, number, number])[];
type Sets = { first: string | null; second: string | null; firstOrder: string | null; secondOrder: string | null };
interface Vectors {
  encode: { name: string; ranks: RankList; order: number[]; origin: OrderOrigin; token: string | null }[];
  decode: ({ name: string; token: string; ranks: RankList } & ({ origin: OrderOrigin; order: number[] } | { error: OrderError }))[];
  links: { read: ({ name: string; link: string } & Sets)[]; write: ({ name: string; fragment: string } & Sets)[] };
}

const file = readFileSync(new URL("../../../../docs/fixtures/talent-order-v1.json", import.meta.url), "utf8");
const vectors = JSON.parse(file) as Vectors;

const toRanks = (list: RankList): Ranks =>
  Object.fromEntries(list.map(([id, rank, choice]) => [id, choice === undefined ? { rank } : { rank, choice }]));

describe("shared spend order vectors", () => {
  test.each(vectors.encode)("encode: $name", ({ ranks, order, origin, token }) => {
    expect(encodeOrder(toRanks(ranks), order, origin)).toBe(token);
  });

  test.each(vectors.decode)("decode: $name", (v) => {
    const want = "error" in v ? { ok: false, error: v.error } : { ok: true, origin: v.origin, order: v.order };
    expect(decodeOrder(v.token, toRanks(v.ranks))).toEqual(want);
  });

  test.each(vectors.links.read)("read a link: $name", (v) => {
    expect(readPlanHash(v.link)).toEqual({ first: v.first, second: v.second, firstOrder: v.firstOrder, secondOrder: v.secondOrder });
  });

  test.each(vectors.links.write)("write a link: $name", (v) => {
    expect(planHash(v.first, v.second, v.firstOrder, v.secondOrder)).toBe(v.fragment);
  });

  test("the file is plain ASCII, every other character an escape, so any JSON reader gets the same code points", () => {
    expect(file).toMatch(/^[\r\n\x20-\x7e]*$/);
  });

  test("they cover both makers and every way a token is refused", () => {
    expect(new Set(vectors.encode.map((v) => v.origin))).toEqual(new Set(["planned", "provisional"]));
    expect(new Set(vectors.decode.flatMap((v) => ("error" in v ? [] : [v.origin])))).toEqual(new Set(["planned", "provisional"]));
    const errors: OrderError[] = ["malformed", "newer-version", "unsupported-mode", "over-limit", "extra-points", "missing-points"];
    expect(new Set(vectors.decode.flatMap((v) => ("error" in v ? [v.error] : [])))).toEqual(new Set(errors));
  });
});
