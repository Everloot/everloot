import { describe, expect, test } from "vitest";
import { fixture } from "./fixture";
import { extractCode, importCode, importPlan, planHash, readPlanHash } from "./import";
import { encodeBuild } from "./share";
import type { Ranks } from "./types";

// Links into the calculator, read a whole value at a time: the class page's address (#plan=, &plan2=, &order=,
// &order2=), the build link the calculator hands out (/tools/talents/<class>/b/<code>[/<code>], orders after #), and a
// saved build's short link (/b/<slug>). On the made-up test tree (fixture.ts), 11 is A and 12 is B in a token.

const code = (ranks: Ranks) => encodeBuild({ classSlug: "mage", specId: 1482, build: "1.0.0.1", ranks });
const P: Ranks = { 11: { rank: 2 }, 12: { rank: 1 } };
const Q: Ranks = { 11: { rank: 1 }, 12: { rank: 1 } };
const [p, q] = [code(P), code(Q)];
const [t, u] = ["O1p-AAB", "O1g-BA"];
const link = (fragment: string) => `https://everloot.app/tools/talents/mage#${fragment}`;
const build = (path: string) => `https://everloot.app/tools/talents/mage/b/${path}`;

const notACode = "That is not a share code. Codes start with EL1 and use letters, digits, - and _ only.";
const damagedOrder = "The plan's spend order is damaged, so the order is unknown. The talents still loaded.";
const otherClass = "That code is for a different class. Open this class's calculator to load it.";
const savedLink = "That link names a saved build, not its talents, so it cannot load here. Open the link, then choose Open in the calculator.";

describe("the class page's address", () => {
  test("is read a whole value at a time: damage after a valid start is not cut away", () => {
    expect(readPlanHash(`#plan=${p}!damaged&plan2=${q}&order=${t}&order2=${u}!damaged`)).toEqual({
      first: `${p}!damaged`, second: q, firstOrder: t, secondOrder: `${u}!damaged`,
    });
  });

  test("a code that does not read whole is refused with the importer's words, even with a valid code inside it", () => {
    for (const fragment of [`#plan=${p}!damaged&order=${t}`, `#plan=${p}!damaged?plan=${p}!tail`, `#plan=${p}!damaged#plan=${p}`, `#plan2=${q}!damaged`]) {
      const sent = readPlanHash(fragment);
      const [value, token] = sent.first ? [sent.first, sent.firstOrder] : [sent.second!, sent.secondOrder];
      expect(importPlan(fixture, value, token ?? null), fragment).toEqual({ ok: false, message: notACode });
    }
  });

  test("a damaged order keeps the talents, and the order is unknown with the import's reason", () => {
    const sent = readPlanHash(`#plan=${p}&order=${t}!damaged`);
    expect(importPlan(fixture, sent.first!, sent.firstOrder)).toMatchObject({
      ok: true, set: { ranks: P, order: null, orderOrigin: null }, token: `${t}!damaged`, report: { problems: [damagedOrder] },
    });
  });

  test("keeps a value as it came: written escaped where a fragment needs it, read back the same", () => {
    const odd = "O1p-A&B%41#x";
    const hash = planHash(p, null, odd);
    expect(hash).toBe(`#plan=${p}&order=O1p-A%26B%2541%23x`);
    expect(readPlanHash(hash)).toEqual({ first: p, second: null, firstOrder: odd, secondOrder: null });
    // A stray % that is not an escape is kept as it is.
    expect(readPlanHash(`#plan=${p}&order=O1p-50%off`).firstOrder).toBe("O1p-50%off");
  });
});

describe("a link pasted into the calculator", () => {
  test("is read whole: its damaged code is refused, its damaged order is unknown", () => {
    for (const text of [link(`plan=${p}!damaged&order=${t}`), link(`plan2=${q}!damaged&order2=${u}`), link(`plan=${p}!damaged?plan=${p}!tail`), `${p}!damaged?plan=${p}!tail`]) {
      expect(importPlan(fixture, text), text).toEqual({ ok: false, message: notACode });
    }
    expect(importPlan(fixture, link(`plan=${p}&order=${t}!damaged`))).toMatchObject({ ok: true, set: { ranks: P, order: null }, report: { problems: [damagedOrder] } });
    expect(importPlan(fixture, link(`plan2=${q}&order2=${u}!damaged`))).toMatchObject({ ok: true, set: { ranks: Q, order: null }, report: { problems: [damagedOrder] } });
  });

  test("copied with spaces or a line break around it still reads", () => {
    expect(readPlanHash(`  ${link(`plan=${p}&order=${t}`)}\n`)).toEqual({ first: p, second: null, firstOrder: t, secondOrder: null });
    expect(importPlan(fixture, `  ${link(`plan=${p}&order=${t}`)}\n`)).toMatchObject({ ok: true, set: { ranks: P, order: [11, 11, 12] }, token: t });
    expect(importPlan(fixture, `\r\n${build(`${p}#order=${t}`)} `)).toMatchObject({ ok: true, set: { ranks: P, order: [11, 11, 12] }, token: t });
  });

  test("a build link loads: the first set's code and order, or the second's when the first is empty", () => {
    expect(importPlan(fixture, build(p))).toMatchObject({ ok: true, set: { ranks: P, order: null }, token: null, report: { problems: [] } });
    expect(importPlan(fixture, build(`${p}/${q}#order=${t}&order2=${u}`))).toMatchObject({ ok: true, set: { ranks: P, order: [11, 11, 12], orderOrigin: "planned" }, token: t });
    expect(importPlan(fixture, build(`-/${q}#order2=${u}`))).toMatchObject({ ok: true, set: { ranks: Q, order: [12, 11], orderOrigin: "provisional" }, token: u });
    expect(importPlan(fixture, `/tools/talents/mage/b/${p}`)).toMatchObject({ ok: true, set: { ranks: P } });
    // A code in the fragment wins over the path, as it does when the link opens.
    expect(importPlan(fixture, build(`${p}#plan=${q}`))).toMatchObject({ ok: true, set: { ranks: Q } });
  });

  test("a build link is read whole too: a damaged code is refused, a damaged order is unknown", () => {
    expect(importPlan(fixture, build(`${p}!damaged`))).toEqual({ ok: false, message: notACode });
    expect(importPlan(fixture, build(`${p}!damaged?plan=${p}`))).toEqual({ ok: false, message: notACode });
    // Three sets is not a link the site makes, so the text is read as a code.
    expect(importPlan(fixture, build(`${p}/${q}/${p}`))).toEqual({ ok: false, message: "That share code is damaged or cut short." });
    expect(importPlan(fixture, build(`${p}#order=${t}!damaged`))).toMatchObject({ ok: true, set: { ranks: P, order: null }, report: { problems: [damagedOrder] } });
  });

  test("a build link for another class is refused with the other-class message", () => {
    const druid = encodeBuild({ classSlug: "druid", specId: 0, build: "1.0.0.1", ranks: { 11: { rank: 1 } } });
    expect(importPlan(fixture, `https://everloot.app/tools/talents/druid/b/${druid}`)).toEqual({ ok: false, message: otherClass });
  });

  test("a saved build's short link is refused without a lookup, and says to open it", () => {
    for (const text of ["https://everloot.app/b/abcd1234", "  /b/abcd1234\n", `https://everloot.app/b/abcd1234#plan=${p}`]) {
      expect(importPlan(fixture, text), text).toEqual({ ok: false, message: savedLink });
    }
  });
});

describe("importCode, which the MCP server reads links with", () => {
  test("takes the first set's whole value from a link, and the text whole otherwise", () => {
    expect(extractCode(link(`plan=${p}!damaged&order=${t}`))).toBe(`${p}!damaged`);
    expect(extractCode(`  ${link(`plan=${p}&order=${t}`)}\n`)).toBe(p);
    expect(importCode(fixture, link(`plan=${p}!damaged`))).toEqual({ ok: false, message: notACode });
    expect(importCode(fixture, `${p}!damaged?plan=${p}!tail`)).toEqual({ ok: false, message: notACode });
    // The site has only ever written a plan after #; a ?plan= in the text is not read.
    expect(extractCode(`https://everloot.app/tools/talents/mage?plan=${p}`)).toBe(`https://everloot.app/tools/talents/mage?plan=${p}`);
  });
});
