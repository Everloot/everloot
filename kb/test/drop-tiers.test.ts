import { expect, test } from "vitest";
import { dropTierLabel, publicDropRate, publicMeasuredZero, rollupDrops } from "../src/drop-rollup.js";
import { agreedLabelsById } from "../src/world-pages.js";

test.each([1, 2, 3, 4])("%i distinct installs set the tier without promoting confirmation", (n) => {
  const windows = Array.from({ length: n }, (_, i) => ({ installId: `fixture-${i}`, sourceNpcId: 7001, items: [{ itemId: 8001, count: 1 }] }));
  const tier = n === 1 ? "reported" : n === 2 ? "verified" : "confirmed";
  const rate = rollupDrops([...windows, windows[0]!]).rates[0]!;
  const zero = rollupDrops(windows.map((w) => ({ ...w, items: [] }))).measuredZeros[0]!;
  expect(publicDropRate(rate)).toMatchObject({ tier, reporters: n, public: n >= 3 });
  expect(publicMeasuredZero(zero)).toMatchObject({ tier, reporters: n, public: n >= 3 });
  expect(dropTierLabel(n)).toBe(`${tier} by ${n} ${n === 1 ? "player" : "players"}`);
  expect(publicDropRate(rate)).not.toHaveProperty("units");
});

test("drop names require unanimity even when a majority is confirmed", () => {
  const rows = ["fixture-a", "fixture-b", "fixture-c"].map((installId) => ({ id: 7001, installId, label: "Fixture Source" }));
  expect(agreedLabelsById(rows.slice(0, 1), undefined, true).get(7001)).toEqual({ name: "Fixture Source", tier: "reported" });
  expect(agreedLabelsById([...rows, { id: 7001, installId: "fixture-d", label: "Fixture Other" }], undefined, true).has(7001)).toBe(false);
});

test("repeated own-install reports stay reported and confirmed names come first", () => {
  const solo = { id: 7001, installId: "fixture-own", label: "Fixture Solo" };
  const rows = [solo, solo, ...["fixture-a", "fixture-b", "fixture-c"].map((installId) => ({ id: 7002, installId, label: "Fixture Confirmed" }))];
  const names = agreedLabelsById(rows, undefined, true);
  expect([...names.keys()]).toEqual([7002, 7001]);
  expect(names.get(7001)).toEqual({ name: "Fixture Solo", tier: "reported" });
});
