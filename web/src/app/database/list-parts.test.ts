import { expect, test } from "vitest";
import { byRank, nameMatches } from "./list-parts";

const rows = [{ id: 7, name: "Box 55" }, { id: 55, name: "Chest" }, { id: 9, name: "Linen Box" }, { id: 3, name: "Box" }];
const name = (r: { name: string }) => r.name;

test("a text ranks every row it names; an id typed with it reads no typo", () => {
  const { ranked, respelled } = nameMatches(rows, "box", null, name);
  expect([...ranked!].map(([r, rank]) => [r.id, rank])).toEqual([[7, 1], [9, 2], [3, 0]]);
  expect(respelled).toBeUndefined();
  expect(nameMatches(rows, undefined, null, name).ranked).toBeNull();
  expect(nameMatches(rows, "lnen box", null, name).respelled).toBe("linen box");
  expect(nameMatches(rows, "55", 55, name).respelled).toBeUndefined();
});

test("byRank puts the best match first unless a sort was asked for, and a row the text never ranked (an id hit) leads", () => {
  const { ranked } = nameMatches(rows, "box", null, name);
  const sorted = [rows[0], rows[2], rows[3]];
  expect(byRank(sorted, ranked, false).map((r) => r.id)).toEqual([3, 7, 9]);
  expect(byRank(sorted, ranked, true).map((r) => r.id)).toEqual([7, 9, 3]);
  expect(byRank(sorted, null, false)).toBe(sorted);
  // The objects list keeps an id hit beside the names that contain the digits: the id leads, as on /search.
  const byId = nameMatches(rows, "55", 55, name);
  expect(byRank([rows[0], rows[1]], byId.ranked, false).map((r) => r.id)).toEqual([55, 7]);
});
