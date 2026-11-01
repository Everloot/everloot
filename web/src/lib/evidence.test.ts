import { describe, expect, test } from "vitest";
import { asOfLine, EVIDENCE_KEY, entitySummary, evidenceLine, itemSummary, observedLine, type ItemSummaryInput } from "./evidence";
import type { Edge } from "../../../kb/src/edges";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");

const edge = (over: Partial<Edge>): Edge => ({
  fromKind: "item", fromId: 19019, rel: "dropped_by", toKind: "npc", toId: 299,
  evidence: "observed", build: null, installs: 3, firstSeen: "2026-10-01T00:00:00.000Z", lastSeen: "2026-10-20T09:00:00.000Z",
  ...over,
});

describe("the line that goes with a count", () => {
  test("an observed relation says how many installs agree and when it was last seen", () => {
    expect(evidenceLine(edge({}), NOW)).toBe("3 of 3 installs agree · last seen 3 h ago");
  });

  test("a relation from the game files names the build it came from", () => {
    expect(evidenceLine(edge({ evidence: "client", build: "1.60.1.70450", installs: null, lastSeen: null }), NOW)).toBe(
      "found in game files, build 1.60.1.70450",
    );
  });

  test("a relation with no date still says who agrees", () => {
    expect(evidenceLine(edge({ lastSeen: null }), NOW)).toBe("3 of 3 installs agree");
  });

  test("one install is not a fact yet", () => {
    expect(evidenceLine(edge({ installs: 1, lastSeen: null }), NOW)).toBe("1 of 3 installs agree");
  });
});

describe("the key", () => {
  test("every term is explained", () => {
    for (const row of EVIDENCE_KEY) expect(row.meaning.length).toBeGreaterThan(20);
  });

  test("it says that not recorded is not a measured zero", () => {
    expect(EVIDENCE_KEY.some((r) => r.meaning.includes("not a measured zero"))).toBe(true);
  });
});

describe("the page's four lines", () => {
  const base: ItemSummaryInput = {
    identity: "One-Hand sword · Legendary · Requires level 60",
    dropSources: 0, mapPositions: 0, vendors: 0, recipes: 0, uses: 0, nameFrom: "none", lastSeen: null, now: NOW,
  };

  test("an item nobody has reported says so, in four lines", () => {
    const bullets = itemSummary(base);
    expect(bullets).toHaveLength(4);
    expect(bullets[0]).toBe("One-Hand sword · Legendary · Requires level 60");
    expect(bullets[1]).toBe("No player has reported a drop source or a map position yet.");
    expect(bullets[2]).toBe("No vendor or recipe is known to carry it yet.");
    expect(bullets[3]).toBe("It has no agreed name yet: that needs three installs reporting the same one.");
  });

  test("a reported item says what players saw, and when", () => {
    const bullets = itemSummary({
      ...base, dropSources: 2, mapPositions: 1, lastSeen: "2026-10-20T09:00:00.000Z",
    });
    expect(bullets[1]).toBe("Players reported 2 drop sources and 1 map position, each with three installs agreeing, last seen 3 h ago.");
  });

  test("one drop source is singular", () => {
    expect(itemSummary({ ...base, dropSources: 1 })[1]).toBe("Players reported 1 drop source, each with three installs agreeing.");
  });

  test("a vendor and a recipe are named when they are known", () => {
    expect(itemSummary({ ...base, vendors: 2, recipes: 1 })[2]).toBe("2 vendors sell it, and 1 recipe makes it.");
  });

  test("a reagent says recipes use it, not that they make it", () => {
    expect(itemSummary({ ...base, uses: 19 })[2]).toBe("19 recipes use it.");
    expect(itemSummary({ ...base, recipes: 1, uses: 1 })[2]).toBe("1 recipe makes it, and 1 recipe uses it.");
  });

  test("the name says where it came from", () => {
    expect(itemSummary({ ...base, nameFrom: "players" })[3]).toBe("Players agree on the name.");
    expect(itemSummary({ ...base, nameFrom: "files" })[3]).toBe("The name is shown from the game files; players have not reported it yet.");
    expect(itemSummary({ ...base, nameFrom: "wiki" })[3]).toBe("The name is shown from the Warcraft Wiki; players have not reported it yet.");
  });
  test("the page never shouts that a name is unconfirmed, because the quiet badge already says it", () => {
    for (const nameFrom of ["players", "wiki", "files", "none"] as const) {
      expect(itemSummary({ ...base, nameFrom }).join(" ")).not.toMatch(/unconfirmed/i);
    }
  });
});

describe("the lines the other entity pages carry", () => {
  test("what players reported, with the count", () => {
    expect(observedLine(["2 item drops", "1 map position"], null, NOW)).toBe("Players reported 2 item drops and 1 map position.");
  });

  test("nothing reported says so", () => {
    expect(observedLine([null, null], null, NOW)).toBe("No player has reported it yet.");
  });

  test("the date rides along when there is one", () => {
    expect(observedLine(["1 map position"], "2026-10-20T09:00:00.000Z", NOW)).toBe("Players reported 1 map position, last seen 3 h ago.");
  });

  test("the three lines a page carries", () => {
    expect(entitySummary({ identity: "Seen in Elwynn Forest", observed: "Players reported 1 map position.", named: true })).toEqual([
      "Seen in Elwynn Forest",
      "Players reported 1 map position.",
      "Players agree on the name.",
    ]);
  });

  test("a name nobody agrees on says what it takes", () => {
    expect(entitySummary({ identity: "A quest", observed: "No player has reported it yet.", named: false })[2]).toBe(
      "It has no agreed name yet: that needs three installs reporting the same one.",
    );
  });
});
describe("when the numbers were current", () => {
  test("says how long ago the last upload was", () => {
    expect(asOfLine("2026-10-20T09:00:00.000Z", NOW)).toBe("last upload 3 h ago");
  });

  test("says nothing when the corpus has no moment", () => {
    expect(asOfLine(null, NOW)).toBeNull();
  });

  test("says nothing when the moment cannot be read", () => {
    expect(asOfLine("not a date", NOW)).toBeNull();
  });
});