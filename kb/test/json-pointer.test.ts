import { expect, test } from "vitest";
import { MAX_ROWS, pageArray, readPointer } from "../src/json-pointer.js";

test.each([
  ["", { a: 1 }, { ok: true, value: { a: 1 } }],
  ["/a/0/b", { a: [{ b: "x" }] }, { ok: true, value: "x" }],
  ["/a~1b/~0", { "a/b": { "~": 2 } }, { ok: true, value: 2 }],
  ["/missing", { a: 1, b: 2 }, { ok: false, keys: ["a", "b"] }],
  ["/name/0", { name: "Thrall" }, { ok: false, keys: [] }],
  ["/a/9", { a: [1] }, { ok: false, keys: [] }],
  ["/a/-", { a: [1] }, { ok: false, keys: [] }],
  ["/a/01", { a: [1, 2] }, { ok: false, keys: [] }],
  ["/a/length", { a: [1, 2] }, { ok: false, keys: [] }],
  ["/__proto__", { a: 1 }, { ok: false, keys: ["a"] }],
  ["/constructor", { a: 1 }, { ok: false, keys: ["a"] }],
  ["a", { a: 1 }, { ok: false, keys: ["a"] }],
  ["/x/y", { x: { a: 1, b: 2 } }, { ok: false, keys: ["a", "b"] }],
])("readPointer(%s)", (p, root, want) => expect(readPointer(root, p)).toEqual(want));

test("a null value is a value, not a miss", () => {
  expect(readPointer({ a: null }, "/a")).toEqual({ ok: true, value: null });
  expect(readPointer({ a: null }, "/a/b")).toEqual({ ok: false, keys: [] });
});

test("pageArray slices and reports nextOffset only when rows remain", () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  expect(MAX_ROWS).toBe(48);
  expect(pageArray(arr, 0, 48)).toEqual({ value: arr.slice(0, 48), nextOffset: 48 });
  expect(pageArray(arr, 96, 48)).toEqual({ value: [96, 97, 98, 99] });
  expect(pageArray(arr, 500, 48)).toEqual({ value: [] });
  expect(pageArray(arr, 0, 1000).value).toHaveLength(48);
  expect(pageArray(arr, -5, 0)).toEqual({ value: [0], nextOffset: 1 });
  expect(pageArray("text", 0, 48)).toEqual({ value: "text" });
});
