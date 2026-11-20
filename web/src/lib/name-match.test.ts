import { expect, test } from "vitest";
import { matchNames } from "./name-match";

const rows = [{ id: 1, n: "Linen Cloth" }, { id: 2, n: "Bolt of Linen Cloth" }, { id: 3, n: "Cloth Linen Scraps" }, { id: 4, n: "Wool Cloth" }];
const name = (r: { n: string | null }) => r.n;

test("words match in any order, ranked whole name, prefix, contains, word starts, anywhere", () => {
  const { hits, respelled } = matchNames(rows, "linen cloth", name);
  expect(hits.map((h) => [h.row.id, h.r])).toEqual([[1, 0], [2, 2], [3, 3]]);
  expect(respelled).toBeUndefined();
});

test("a typo finds the name only when nothing matches as typed, and says how it read the query", () => {
  const { hits, respelled } = matchNames(rows, "lnen clth", name);
  expect(hits.map((h) => h.row.id)).toEqual([1, 2, 3]);
  expect(respelled).toBe("linen cloth");
});

test("short words never read typos, and a name of null never matches", () => {
  expect(matchNames([...rows, { id: 5, n: null }], "of", name).hits.map((h) => h.row.id)).toEqual([2]);
  expect(matchNames(rows, "xq", name).hits).toEqual([]);
});

test("the hits keep the rows' order within and across ranks: the caller sorts", () => {
  const { hits } = matchNames([...rows].reverse(), "cloth", name);
  expect(hits.map((h) => h.row.id)).toEqual([4, 3, 2, 1]);
});
