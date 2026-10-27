import { describe, expect, test } from "vitest";
import { fixture } from "./fixture";
import { extractCode, importCode, planHash, readPlanHash } from "./import";
import { SHARE_VERSION, decodeBuild, encodeBuild, encodeOrder, resolveBuild } from "./share";
import { previewPath, readPathCodes } from "./summary";
import type { Ranks, TalentCatalog } from "./types";

const ranks: Ranks = { 11: { rank: 5 }, 12: { rank: 5 }, 21: { rank: 2 }, 32: { rank: 1, choice: 1 } };
const shared = { classSlug: "mage", specId: 1482, build: "1.0.0.1", ranks };

describe("share code", () => {
  test("round trips the class, spec, build and every rank, including a choice", () => {
    const code = encodeBuild(shared);
    expect(code).toMatch(/^EL1-mage-1482-1\.0\.0\.1-[A-Za-z0-9_-]+$/);
    const decoded = decodeBuild(code);
    expect(decoded).toEqual({ ok: true, build: { ...shared, version: SHARE_VERSION } });
  });

  test("the same build always gives the same code, whatever order the ranks were made in", () => {
    const reversed: Ranks = Object.fromEntries(Object.entries(ranks).reverse()) as Ranks;
    expect(encodeBuild({ ...shared, ranks: reversed })).toBe(encodeBuild(shared));
  });

  test("an empty build round trips", () => {
    const decoded = decodeBuild(encodeBuild({ ...shared, ranks: {} }));
    expect(decoded).toMatchObject({ ok: true, build: { ranks: {} } });
  });

  test("zero ranks are left out", () => {
    expect(encodeBuild({ ...shared, ranks: { 11: { rank: 0 } } })).toBe(encodeBuild({ ...shared, ranks: {} }));
  });

  test("matches the addon's example exactly", () => {
    const example = "EL1-mage-1482-1.60.1.70450-OTAwMDE6Miw5MDAwMjoxOjEsOTAwMDQ6Mg";
    const decoded = decodeBuild(example);
    expect(decoded).toEqual({
      ok: true,
      build: { version: 1, classSlug: "mage", specId: 1482, build: "1.60.1.70450", ranks: { 90001: { rank: 2 }, 90002: { rank: 1, choice: 1 }, 90004: { rank: 2 } } },
    });
    expect(atob("OTAwMDE6Miw5MDAwMjoxOjEsOTAwMDQ6Mg")).toBe("90001:2,90002:1:1,90004:2");
    if (!decoded.ok) throw new Error("decode failed");
    expect(encodeBuild(decoded.build)).toBe(example);
  });

  test("reads nodes in any order", () => {
    const text = (t: string) => btoa(t).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    const payload = text("90004:2,90001:2");
    const decoded = decodeBuild(`EL1-mage-0-1.60.1.70450-${payload}`);
    expect(decoded).toMatchObject({ ok: true, build: { specId: 0, ranks: { 90001: { rank: 2 }, 90004: { rank: 2 } } } });
  });

  test("a code that is not base64url, empty, damaged or newer is refused with a reason", () => {
    const text = (t: string) => btoa(t).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    const code = (payload: string, head = "EL1-mage-1482-1.0.0.1") => `${head}-${text(payload)}`;
    expect(decodeBuild("   ")).toEqual({ ok: false, error: "empty" });
    expect(decodeBuild("not a code!")).toEqual({ ok: false, error: "not-base64url" });
    expect(decodeBuild("YWJj")).toEqual({ ok: false, error: "malformed" });
    expect(decodeBuild("XX1-mage-1482-1.0-YWJj")).toEqual({ ok: false, error: "malformed" });
    expect(decodeBuild(code("1:1", "EL2-mage-1482-1.0.0.1"))).toEqual({ ok: false, error: "newer-version" });
    expect(decodeBuild(code("1:0"))).toEqual({ ok: false, error: "malformed" });
    expect(decodeBuild(code("1:1,1:2"))).toEqual({ ok: false, error: "malformed" });
    expect(decodeBuild(code("x:1"))).toEqual({ ok: false, error: "malformed" });
    expect(decodeBuild("EL1-mage-x-1.0-YWJj")).toEqual({ ok: false, error: "malformed" });
    expect(decodeBuild("EL1-mage-1482-1.0.0.1-@@")).toEqual({ ok: false, error: "not-base64url" });
  });
});

describe("opening a code on a tree", () => {
  test("a build that still fits loads whole, with nothing to report", () => {
    const result = resolveBuild(fixture, { ...shared, version: 1 });
    expect(result).toEqual({ ok: true, build: { ranks, unknown: [], clamped: [], rejected: [], buildDiffers: false } });
  });

  test("talents the tree no longer has are reported, not dropped silently", () => {
    const old = { ...shared, version: 1, ranks: { ...ranks, 777: { rank: 2 }, 888: { rank: 1 } } };
    const result = resolveBuild(fixture, old);
    expect(result.ok && result.build.unknown).toEqual([{ id: 777, rank: 2 }, { id: 888, rank: 1 }]);
    expect(result.ok && result.build.ranks).toEqual(ranks);
  });

  test("a rank above the new maximum is cut back and reported", () => {
    const result = resolveBuild(fixture, { ...shared, version: 1, ranks: { 11: { rank: 9 } } });
    expect(result.ok && result.build.clamped).toEqual([{ id: 11, name: "Talent 11", what: "rank", asked: 9, got: 5 }]);
    expect(result.ok && result.build.ranks).toEqual({ 11: { rank: 5 } });
  });

  test("a choice the node does not have falls back to the first and is reported", () => {
    const result = resolveBuild(fixture, { ...shared, version: 1, ranks: { 11: { rank: 5 }, 12: { rank: 5 }, 32: { rank: 1, choice: 4 } } });
    expect(result.ok && result.build.clamped).toMatchObject([{ id: 32, what: "choice", got: 0 }]);
    expect(result.ok && result.build.ranks[32]).toEqual({ rank: 1, choice: 0 });
  });

  test("points the new rules would not allow are rejected with the reason", () => {
    // The code has a row 2 point but no row 1 points: row 2 cannot open.
    const result = resolveBuild(fixture, { ...shared, version: 1, ranks: { 21: { rank: 3 } } });
    expect(result.ok && result.build.ranks).toEqual({});
    expect(result.ok && result.build.rejected).toEqual([
      { id: 21, name: "Talent 21", rank: 3, why: "Needs 5 points spent in Left on rows above." },
    ]);
  });

  test("a prerequisite later in reading order than the talent that needs it still places", () => {
    const moved: TalentCatalog = {
      ...fixture,
      nodes: fixture.nodes.map((n) => (n.id === 51 ? { ...n, prereqs: [52], unlock: undefined } : n.id === 52 ? { ...n, unlock: undefined } : n)),
    };
    const result = resolveBuild(moved, { ...shared, version: 1, ranks: { 51: { rank: 2 }, 52: { rank: 1 } } });
    expect(result.ok && result.build.rejected).toEqual([]);
    expect(result.ok && result.build.ranks).toEqual({ 51: { rank: 2 }, 52: { rank: 1 } });
  });

  test("a build made on another game build says so", () => {
    const result = resolveBuild(fixture, { ...shared, version: 1, build: "0.9.9.9" });
    expect(result.ok && result.build.buildDiffers).toBe(true);
  });

  test("a code for another class is refused", () => {
    expect(resolveBuild(fixture, { ...shared, version: 1, classSlug: "druid" })).toEqual({ ok: false, error: "other-class" });
  });

  test("a rule that changed leaves no hidden loss: every requested point is placed or listed", () => {
    // Raise row 2's gate from 5 to 8 and reopen an old link.
    const stricter: TalentCatalog = {
      ...fixture,
      nodes: fixture.nodes.map((n) => (n.id === 21 ? { ...n, unlock: { pointsInTree: 8 } } : n)),
    };
    const asked: Ranks = { 11: { rank: 5 }, 21: { rank: 2 } };
    const result = resolveBuild(stricter, { ...shared, version: 1, ranks: asked });
    if (!result.ok) throw new Error("expected ok");
    const placed = Object.values(result.build.ranks).reduce((n, r) => n + r.rank, 0);
    const listed = result.build.rejected.reduce((n, r) => n + r.rank, 0) + result.build.unknown.reduce((n, u) => n + u.rank, 0);
    expect(placed + listed).toBe(7);
  });
});

describe("importCode", () => {
  test("accepts a bare code or a whole link", () => {
    const code = encodeBuild(shared);
    const bare = importCode(fixture, code);
    const link = importCode(fixture, `https://everloot.app/tools/talents/mage#plan=${code}`);
    expect(bare).toMatchObject({ ok: true, ranks, minLevel: 10 + 13 - 1 });
    expect(link).toEqual(bare);
  });

  test("turns every kind of loss into a sentence", () => {
    const code = encodeBuild({ ...shared, build: "0.9", ranks: { 777: { rank: 1 }, 11: { rank: 9 }, 21: { rank: 1 } } });
    const result = importCode(fixture, code);
    if (!result.ok) throw new Error("expected ok");
    expect(result.report.problems).toEqual([
      "Made on game build 0.9; this tree is from build 1.0.0.1. Check each talent.",
      "1 talent in the code is not in this tree and was left out: node 777 (1 point).",
      "Talent 11: the code asked for rank 9, but the most this tree allows is 5.",
    ]);
    expect(result.ranks).toEqual({ 11: { rank: 5 }, 21: { rank: 1 } });
  });

  test("explains a bad code in plain words", () => {
    expect(importCode(fixture, "")).toEqual({ ok: false, message: "Paste a share code or a link first." });
    expect(importCode(fixture, "???")).toMatchObject({ ok: false, message: expect.stringContaining("not a share code") });
    expect(importCode(fixture, encodeBuild({ ...shared, classSlug: "druid" }))).toMatchObject({ ok: false, message: expect.stringContaining("different class") });
  });
});

describe("plan links", () => {
  // The addon's own examples (addon/tests/fixtures/EverlootBuilds.lua), and an order for each.
  const first = "EL1-mage-1482-1.60.1.70450-OTAwMDE6Miw5MDAwMjoxOjEsOTAwMDQ6Mg";
  const second = "EL1-mage-0-1.60.1.70450-MToxLDI6MQ";
  const firstOrder = "O1p-AABCC";
  const secondOrder = "O1g-AB";
  const page = "https://everloot.app/tools/talents/mage";

  test("a link made before spend orders reads as it always has, with no order", () => {
    expect(readPlanHash(`#plan=${first}`)).toEqual({ first, second: null, firstOrder: null, secondOrder: null });
    expect(readPlanHash(`#plan=${first}&plan2=${second}`)).toEqual({ first, second, firstOrder: null, secondOrder: null });
    expect(readPlanHash(`#plan2=${second}`)).toEqual({ first: null, second, firstOrder: null, secondOrder: null });
    expect(readPlanHash("")).toEqual({ first: null, second: null, firstOrder: null, secondOrder: null });
  });

  test("the address of one or both sets is byte-identical when no order rides with it", () => {
    expect(planHash(first, second)).toBe(`#plan=${first}&plan2=${second}`);
    expect(planHash(first, null)).toBe(`#plan=${first}`);
    expect(planHash(null, second)).toBe(`#plan2=${second}`);
    expect(planHash(null, null)).toBe("");
    expect(planHash(first, second, null, null)).toBe(`#plan=${first}&plan2=${second}`);
  });

  test("each set's order rides after both codes, and both sets and both orders read back", () => {
    const hash = planHash(first, second, firstOrder, secondOrder);
    expect(hash).toBe(`#plan=${first}&plan2=${second}&order=${firstOrder}&order2=${secondOrder}`);
    expect(readPlanHash(hash)).toEqual({ first, second, firstOrder, secondOrder });
    expect(readPlanHash(planHash(first, second, null, secondOrder))).toEqual({ first, second, firstOrder: null, secondOrder });
    // An order without its set has nothing to order.
    expect(planHash(null, second, firstOrder, secondOrder)).toBe(`#plan2=${second}&order2=${secondOrder}`);
    expect(planHash(first, null, firstOrder, secondOrder)).toBe(`#plan=${first}&order=${firstOrder}`);
  });

  test("old readers stop at & and ignore the order: the site's reader so far and the addon's", () => {
    const link = `${page}#plan=${first}&plan2=${second}&order=${firstOrder}&order2=${secondOrder}`;
    // The site's reader until now; the MCP server reads links with extractCode.
    expect(/[#&]plan=([A-Za-z0-9_.-]+)/.exec(link)?.[1]).toBe(first);
    expect(/[#&]plan2=([A-Za-z0-9_.-]+)/.exec(link)?.[1]).toBe(second);
    expect(extractCode(link)).toBe(first);
    // The addon's planner reads #plan=([^&]+), or #plan2=([^&]+) when the first set is empty.
    expect(/^https?:\/\/[^/]+\/tools\/talents\/[A-Za-z]+[^#]*#plan=([^&]+)/.exec(link)?.[1]).toBe(first);
    const secondOnly = `${page}#plan2=${second}&order2=${secondOrder}`;
    expect(/^https?:\/\/[^/]+\/tools\/talents\/[A-Za-z]+[^#]*#plan2=([^&]+)/.exec(secondOnly)?.[1]).toBe(second);
    // Pasted into the calculator, the new link loads what the old one did.
    expect(importCode(fixture, link)).toEqual(importCode(fixture, `${page}${planHash(first, second)}`));
  });

  test("a build link's two sets survive the move from its /b/ path to the page's fragment", () => {
    const path = previewPath("mage", first, second)!;
    expect(path).toBe(`/tools/talents/mage/b/${first}/${second}`);
    const read = readPathCodes(fixture, path.split("/b/")[1].split("/"))!;
    expect(readPlanHash(planHash(read.first, read.second))).toEqual({ first, second, firstOrder: null, secondOrder: null });
  });
});

describe("importCode with a spend order", () => {
  const code = encodeBuild(shared);
  const order = [11, 12, 11, 12, 11, 12, 11, 12, 11, 12, 21, 21, 32];
  const plain = importCode(fixture, code);

  test("without an order the answer is the one it was before orders", () => {
    expect(plain).not.toHaveProperty("order");
    expect(importCode(fixture, code, null)).toEqual(plain);
  });

  test("an order that matches the code loads with the talents and says who made it", () => {
    const result = importCode(fixture, code, encodeOrder(ranks, order, "planned"));
    expect(result).toEqual({ ...plain, order: { known: true, origin: "planned", order } });
    expect(result.ok && result.report.problems).toEqual([]);
  });

  test("an unsupported, mismatched, newer or damaged order keeps the talents and reports the order unknown", () => {
    const cases: [string, string, string][] = [
      ["O1x-ABABABABABCCD", "unsupported-mode", "The plan's spend order is of a kind this tool does not read, so the order is unknown. The talents still loaded."],
      ["O2p-ABABABABABCCD", "newer-version", "The plan's spend order was made by a newer version of this tool, so the order is unknown. Reload the page to read it. The talents still loaded."],
      ["O1p-ABABABABABCCDD", "extra-points", "The plan's spend order lists points the code does not have, so the order is unknown. The talents still loaded."],
      ["O1p-ABABABABABCD", "missing-points", "The plan's spend order leaves out points the code has, so the order is unknown. The talents still loaded."],
      [`O1p-${"A".repeat(65)}`, "over-limit", "The plan's spend order is for more than 64 points, the most an order carries, so the order is unknown. The talents still loaded."],
      ["O1p-", "malformed", "The plan's spend order is damaged, so the order is unknown. The talents still loaded."],
    ];
    if (!plain.ok) throw new Error("expected ok");
    for (const [token, reason, message] of cases) {
      const result = importCode(fixture, code, token);
      if (!result.ok) throw new Error(`expected ok for ${token}`);
      expect(result.ranks, token).toEqual(plain.ranks);
      expect(result.minLevel, token).toBe(plain.minLevel);
      expect(result.order, token).toEqual({ known: false, reason });
      expect(result.report.problems, token).toEqual([message]);
    }
  });

  test("an order for points that did not all place on this tree is unknown, after the talents' own problems", () => {
    const more: Ranks = { ...ranks, 777: { rank: 1 } };
    const result = importCode(fixture, encodeBuild({ ...shared, ranks: more }), encodeOrder(more, [...order, 777], "planned"));
    if (!result.ok) throw new Error("expected ok");
    expect(result.ranks).toEqual(ranks);
    expect(result.order).toEqual({ known: false, reason: "not-placed" });
    expect(result.report.problems).toEqual([
      "1 talent in the code is not in this tree and was left out: node 777 (1 point).",
      "Not every point in the code placed on this tree, so the plan's spend order is unknown.",
    ]);
  });

  test("who made the order comes from the token, never from how it arrived", () => {
    const generated = encodeOrder(ranks, order, "provisional")!;
    const link = `https://everloot.app/tools/talents/mage${planHash(code, null, generated)}`;
    const fromLink = importCode(fixture, link, readPlanHash(link).firstOrder);
    const pasted = importCode(fixture, code, ` ${generated} `);
    expect(fromLink.ok && fromLink.order).toEqual({ known: true, origin: "provisional", order });
    expect(pasted.ok && pasted.order).toEqual({ known: true, origin: "provisional", order });
  });
});
