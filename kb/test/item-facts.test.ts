import { parseRecords } from "@everloot/protocol";
import { describe, expect, test } from "vitest";
import { itemFactProgress, itemFactRowsFromRecords, reportedItemFacts } from "../src/item-facts.js";

const BUILD = "1.60.1.70450";
const asOf = new Date("2026-11-10T00:00:00Z");
const fact = (installId: string, fact: string, value: number, extra: Record<string, unknown> = {}) => ({
  kind: "item_fact", installId, eventId: `${installId}:${fact}`, capturedAt: "2026-11-05T12:00:00Z",
  itemId: 2075, fact, value, clientBuild: BUILD, ...extra,
});
const state = (records: unknown[]) => reportedItemFacts(itemFactRowsFromRecords(records).get(2075), asOf);

describe("item facts players report", () => {
  test("progress counts distinct installs per line on the newest build without exposing values", () => {
    const rows = itemFactRowsFromRecords([
      fact("install-a", "stamina", 9876), fact("install-a", "stamina", 9876),
      fact("install-b", "stamina", 1234), fact("install-a", "armor", 999), fact("install-a", "armor", 999),
      ...["a", "b", "c"].map((i) => fact(`install-${i}`, "spirit", 10)),
      fact("install-z", "stamina", 4567, { clientBuild: "1.60.2.70532" }),
    ]).get(2075);
    expect(itemFactProgress(rows)).toEqual([
      { fact: "armor", reporters: 1, build: BUILD },
      { fact: "stamina", reporters: 1, build: "1.60.2.70532" },
    ]);
    expect(itemFactProgress(undefined)).toEqual([]);
    expect(reportedItemFacts(rows).shown.map((x) => x.fact)).toEqual(["spirit"]);
  });

  test("a newer partial build does not relabel an agreed or contested line as unconfirmed", () => {
    const rows = itemFactRowsFromRecords([
      ...["a", "b", "c"].map((i) => fact(`install-${i}`, "armor", 100)),
      ...["a", "b", "c"].map((i, n) => fact(`install-${i}`, "stamina", n)),
      fact("install-d", "armor", 101, { clientBuild: "1.60.2.70532" }),
      fact("install-d", "stamina", 10, { clientBuild: "1.60.2.70532" }),
    ]).get(2075);
    expect(itemFactProgress(rows)).toEqual([]);
    expect(reportedItemFacts(rows).shown.map((f) => f.fact)).toEqual(["armor"]);
    expect(reportedItemFacts(rows).contested).toEqual(["stamina"]);
  });

  test("the rows the readers use are rows the protocol accepts", () => {
    const rows = [fact("install-a", "stamina", 5), fact("install-b", "damage_per_second", 12.4)];
    expect(parseRecords(rows).records).toHaveLength(2);
    expect(itemFactRowsFromRecords(rows).get(2075)).toHaveLength(2);
  });

  test("a number is shown when 3 installs agree, with the installs, the build and when it was last seen", () => {
    const got = state([
      fact("install-a", "stamina", 5), fact("install-b", "stamina", 5),
      fact("install-c", "stamina", 5, { capturedAt: "2026-11-07T08:00:00Z" }),
      fact("install-a", "armor", 103), fact("install-b", "armor", 103),
    ]);
    expect(got.shown).toEqual([{ fact: "stamina", value: 5, reporters: 3, build: BUILD, lastSeen: "2026-11-07T08:00:00.000Z" }]);
    expect(got.contested).toEqual([]);
  });

  test("two installs, or one install reporting three times, is not enough", () => {
    expect(state([fact("install-a", "stamina", 5), fact("install-b", "stamina", 5)]).shown).toEqual([]);
    expect(state([fact("install-a", "stamina", 5), fact("install-a", "stamina", 5), fact("install-a", "stamina", 5)]).shown).toEqual([]);
  });

  test("installs that report a line without 3 agreeing make it contested, and no number is shown", () => {
    const split = state([fact("install-a", "stamina", 5), fact("install-b", "stamina", 6), fact("install-c", "stamina", 7)]);
    expect(split).toEqual({ shown: [], contested: ["stamina"] });
    const twoWinners = state(["a", "b", "c"].map((i) => fact(`install-${i}`, "armor", 100)).concat(["d", "e", "f"].map((i) => fact(`install-${i}`, "armor", 110))));
    expect(twoWinners).toEqual({ shown: [], contested: ["armor"] });
  });

  test("one dissenting install does not hide a value 3 others agree on", () => {
    const got = state([fact("install-a", "spirit", -2), fact("install-b", "spirit", -2), fact("install-c", "spirit", -2), fact("install-d", "spirit", 3)]);
    expect(got.shown.map((f) => [f.fact, f.value, f.reporters])).toEqual([["spirit", -2, 3]]);
  });

  test("each install votes once, with its latest row", () => {
    const got = state([
      fact("install-a", "stamina", 4, { capturedAt: "2026-11-01T00:00:00Z" }), fact("install-a", "stamina", 5, { capturedAt: "2026-11-02T00:00:00Z" }),
      fact("install-b", "stamina", 5), fact("install-c", "stamina", 5),
    ]);
    expect(got.shown.map((f) => [f.value, f.reporters])).toEqual([[5, 3]]);
  });

  test("the newest build with 3 installs decides; older reports never outvote it", () => {
    const old = ["a", "b", "c", "d"].map((i) => fact(`install-${i}`, "stamina", 5));
    const patched = ["e", "f", "g"].map((i) => fact(`install-${i}`, "stamina", 6, { clientBuild: "1.60.10.71000" }));
    expect(state([...old, ...patched]).shown.map((f) => [f.value, f.build])).toEqual([[6, "1.60.10.71000"]]);
    // Two installs on the new build are not enough to decide it, so the old build's agreement stands.
    expect(state([...old, ...patched.slice(0, 2)]).shown.map((f) => [f.value, f.build])).toEqual([[5, BUILD]]);
  });

  test("damage per second agrees at one decimal; a time after the corpus is left out of last seen", () => {
    const got = state([
      fact("install-a", "damage_per_second", 12.4), fact("install-b", "damage_per_second", 12.4),
      fact("install-c", "damage_per_second", 12.4, { capturedAt: "2030-01-01T00:00:00Z" }),
    ]);
    expect(got.shown).toEqual([{ fact: "damage_per_second", value: 12.4, reporters: 3, build: BUILD, lastSeen: "2026-11-05T12:00:00.000Z" }]);
  });

  test("malformed rows and other kinds are ignored; shown lines follow the game's order", () => {
    const rows = [
      ...["a", "b", "c"].map((i) => fact(`install-${i}`, "fire_resistance", 10)),
      ...["a", "b", "c"].map((i) => fact(`install-${i}`, "armor", 103)),
      fact("install-d", "luck", 1), fact(" ", "armor", 1), fact("install-e", "armor", Number.NaN), fact("install-f", "armor", 1, { clientBuild: "beta" }),
      { kind: "item_seen", installId: "install-g", itemId: 2075, name: "Ragged Cloak", quality: "common" },
    ];
    expect(state(rows).shown.map((f) => f.fact)).toEqual(["armor", "fire_resistance"]);
    expect(reportedItemFacts(undefined)).toEqual({ shown: [], contested: [] });
  });
});
