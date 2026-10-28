import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { fixture } from "../../web/src/lib/talents/fixture";
import { validateOrder } from "../../web/src/lib/talents/order";
import { levelFor, pointsAtLevel, pointsSpent } from "../../web/src/lib/talents/rules";
import { decodeBuild, decodeOrder, encodeBuild, encodeOrder, resolveBuild } from "../../web/src/lib/talents/share";
import type { Ranks } from "../../web/src/lib/talents/types";
import { checkGuides, type GuideCheckContext, type GuideFile, type Problem } from "../src/guides/check.js";
import { loadGuideCheckContext, readGuideFiles } from "../src/guides/data.js";
import { GUIDE_SECTIONS } from "../src/guides/guide.js";
import { siteCatalog } from "../src/talents/site-catalogs.js";
import { MIN_PROSE_WORDS } from "../src/wiki/check.js";
import { loadPrivatePathPattern } from "../src/wiki/data.js";

// The made-up test tree: Talent 11 sits on the first row, Talent 21 on the second, which opens at 5 points above.
const RANKS: Ranks = { 11: { rank: 5 }, 21: { rank: 1 } };
const code = (ranks: Ranks, classSlug = "mage") => encodeBuild({ classSlug, specId: fixture.specId, build: fixture.build, ranks });
const CODE = code(RANKS);
const PLANNED = encodeOrder(RANKS, [11, 11, 11, 11, 11, 21], "planned")!;
const PROVISIONAL = encodeOrder(RANKS, [11, 11, 11, 11, 11, 21], "provisional")!;
const OUT_OF_ORDER = encodeOrder(RANKS, [21, 11, 11, 11, 11, 11], "planned")!;

const ctx: GuideCheckContext = {
  catalogs: new Map([["mage", fixture]]),
  wikiPages: new Map([["deadmines", "published"], ["stockades", "draft"]]),
  known: { items: new Set([2589]), zones: new Set([1436]) },
  privatePaths: loadPrivatePathPattern(),
  today: "2026-10-26",
};

const SOURCE = "https://worldofwarcraft.blizzard.com/en-us/news/24302498";
const filler = (n: number) => Array.from({ length: n }, (_, i) => ["stone", "river", "road", "hill", "mine"][i % 5]).join(" ");

const V1 = `  - { version: 1, on: 2026-10-20, by: Kai, build: 1.0.0.1, note: "First published version." }`;

const FRONT = `---
id: 1
slug: frost-leveling
version: 1
status: published
title: Frost leveling
summary: "A plan for leveling a mage on your own, in the order we spend each point."
classSlug: mage
activity: leveling
roles: [damage]
levels: { from: 10, to: 60 }
code: ${CODE}
order: ${PLANNED}
author: Robin
reviewed: { by: Kai, on: 2026-10-20, build: 1.0.0.1 }
sources:
  - { title: "Blizzard's announcement", url: "${SOURCE}", checkedOn: 2026-10-19 }
history:
${V1}
---`;

const BODY = `
## Who it is for

Players who level a mage on their own and want every point placed before the next level arrives. ${filler(30)}

## Why this plan

Blizzard [named the class changes](${SOURCE}) that shape this plan. ${filler(40)}

## How to play it

At level 10, put 5 points in Talent 11, then take Talent 21 at level 15. The [[deadmines]] drop {item:2589} on the way. ${filler(40)}

## What we do not know yet

Whether the point levels hold in the live game is not confirmed. ${filler(20)}
`;

const GUIDE = `${FRONT}\n${BODY}`;
const PATH = "guides/frost-leveling.md";

const file = (source: string, path = PATH): GuideFile => ({ path, source });
const problemsOf = (files: GuideFile[], c: GuideCheckContext = ctx): Problem[] => checkGuides(files, c).problems;
const messagesOf = (source: string, c: GuideCheckContext = ctx) => problemsOf([file(source)], c).map((p) => p.message);
/** The line a problem should point at: the first line of the file that starts with `start`. */
const lineOf = (source: string, start: string) => source.split("\n").findIndex((l) => l.startsWith(start)) + 1;
const at = (source: string, start: string, message: string): Problem => ({ file: PATH, line: lineOf(source, start), message: expect.stringContaining(message) });

/** The same guide as a draft that was never published: no review, no history. */
const asDraft = (source: string) =>
  source.replace("status: published", "status: draft").replace(/^reviewed: .*$/m, "reviewed: null").replace(`history:\n${V1}`, "history: []");

/** The guide as version 2, reviewed again, with the version-2 entry added to its history. */
const asVersion2 = (source: string, note = "Reworded what is not known.") =>
  source
    .replace("version: 1\n", "version: 2\n")
    .replace(/^reviewed: .*$/m, "reviewed: { by: Kai, on: 2026-10-25, build: 1.0.0.1 }")
    .replace(V1, `${V1}\n  - { version: 2, on: 2026-10-25, by: Kai, build: 1.0.0.1, note: "${note}" }`);

test("a reviewed guide with a planned order, its history and its sources passes", () => {
  const result = checkGuides([file(GUIDE)], ctx);
  expect(result.problems).toEqual([]);
  expect(result.guides.map((g) => [g.fm.slug, g.fm.version, g.fm.status])).toEqual([["frost-leveling", 1, "published"]]);
});

test("a never-published draft passes without a review or a history", () => {
  expect(problemsOf([file(asDraft(GUIDE))])).toEqual([]);
});

describe("review", () => {
  test("a published guide without a review fails on its reviewed line", () => {
    const unreviewed = GUIDE.replace(/^reviewed: .*$/m, "reviewed: null");
    expect(problemsOf([file(unreviewed)])).toEqual([at(unreviewed, "reviewed:", "a published guide needs reviewed: { by, on, build }")]);
  });

  test("the person who wrote a guide may be the one who reviewed it: reviewed names who actually did", () => {
    expect(problemsOf([file(GUIDE.replace("author: Robin", "author: Kai"))])).toEqual([]);
  });

  test("a review or a source cannot be dated after today", () => {
    const ahead = GUIDE.replace("on: 2026-10-20, build: 1.0.0.1 }\nsources", "on: 2026-10-30, build: 1.0.0.1 }\nsources").replace("{ version: 1, on: 2026-10-20", "{ version: 1, on: 2026-10-30");
    expect(problemsOf([file(ahead)])).toContainEqual(at(ahead, "reviewed:", "after today (2026-10-26)"));
    const checked = GUIDE.replace("checkedOn: 2026-10-19", "checkedOn: 2026-11-02");
    expect(problemsOf([file(checked)])).toContainEqual(at(checked, "  - { title:", "after today (2026-10-26)"));
  });
});

describe("unknown fields", () => {
  test("a field the contract does not define fails on its own line", () => {
    // Freshness is worked out by the site from the live data; a file cannot declare it.
    const extra = GUIDE.replace("author: Robin", "author: Robin\nfreshness: stale");
    expect(problemsOf([file(extra)])).toEqual([at(extra, "freshness:", 'front matter: unknown field "freshness"')]);
  });

  test("a nested unknown field names where it sits", () => {
    const nested = GUIDE.replace("build: 1.0.0.1 }\nsources", "build: 1.0.0.1, rating: 5 }\nsources");
    expect(problemsOf([file(nested)])).toEqual([at(nested, "reviewed:", 'front matter reviewed: unknown field "rating"')]);
  });

  test("a field of the wrong shape fails on its line", () => {
    const role = GUIDE.replace("roles: [damage]", "roles: [damage, support]");
    expect(problemsOf([file(role)])).toEqual([at(role, "roles:", "front matter roles.1")]);
  });

  test("a missing field points at the opening ---, and a YAML error at its own line", () => {
    const missing = GUIDE.replace("author: Robin\n", "");
    expect(problemsOf([file(missing)])).toEqual([{ file: PATH, line: 1, message: expect.stringContaining("front matter author:") }]);
    const twice = GUIDE.replace("author: Robin", "author: Robin\nauthor: Sam");
    expect(problemsOf([file(twice)])).toEqual([{ file: PATH, line: lineOf(twice, "author: Sam"), message: expect.stringContaining("unique") }]);
  });
});

describe("codes", () => {
  const withCode = (bad: string) => GUIDE.replace(`code: ${CODE}`, `code: ${bad}`).replace(`order: ${PLANNED}\n`, "");

  test("a code the calculator cannot read fails", () => {
    const g = withCode("EL1-mage-1482-1.0.0.1-***");
    expect(problemsOf([file(g)])).toEqual([at(g, "code:", "code is not a share code the calculator reads (not-base64url)")]);
  });

  test("a code for another class fails", () => {
    const g = withCode(code(RANKS, "warrior"));
    expect(problemsOf([file(g)])).toEqual([at(g, "code:", "code is a warrior plan; this guide is for mage")]);
  });

  test("a code must place exactly on the class's tree", () => {
    const cases: [Ranks, string][] = [
      [{ ...RANKS, 99: { rank: 1 } }, "the Mage tree does not have node 99"],
      [{ 11: { rank: 6 }, 21: { rank: 1 } }, "Talent 11 is at rank 6, and the tree allows 5"],
      [{ 21: { rank: 1 } }, "Talent 21 cannot be placed: Needs 5 points spent in Left on rows above."],
    ];
    for (const [ranks, message] of cases) {
      const g = withCode(code(ranks));
      expect(problemsOf([file(g)])).toEqual([at(g, "code:", message)]);
    }
  });

  test("a plan cannot spend more points than the levels give", () => {
    const capped = { ...fixture, rules: { ...fixture.rules, maxLevel: 12 } };
    const g = withCode(CODE).replace("levels: { from: 10, to: 60 }", "levels: { from: 10, to: 12 }");
    expect(problemsOf([file(g)], { ...ctx, catalogs: new Map([["mage", capped]]) })).toEqual([at(g, "code:", "spends 6 points, and the tree gives 3 by level 12")]);
  });

  test("the second set is checked like the first", () => {
    const g = GUIDE.replace(`order: ${PLANNED}`, `order: ${PLANNED}\ncode2: ${code({ 21: { rank: 1 } })}`);
    expect(problemsOf([file(g)])).toEqual([at(g, "code2:", "Talent 21 cannot be placed")]);
  });
});

describe("orders", () => {
  test("a published guide carries only an order a player planned", () => {
    const g = GUIDE.replace(PLANNED, PROVISIONAL);
    expect(problemsOf([file(g)])).toEqual([at(g, "order:", "order is provisional (O1g)")]);
  });

  test("a draft may hold a provisional order while it is written", () => {
    expect(problemsOf([file(asDraft(GUIDE.replace(PLANNED, PROVISIONAL)))])).toEqual([]);
  });

  test("an order that does not read with its code fails with the reader's reason", () => {
    const cases: [string, string][] = [
      ["O1p-AAAAA", "missing-points"],
      ["O1p-AAAAABB", "extra-points"],
      ["O2p-AAAAAB", "newer-version"],
      ["O1x-AAAAAB", "unsupported-mode"],
      ["O1p AAAAAB", "malformed"],
    ];
    for (const [token, reason] of cases) {
      const g = GUIDE.replace(`order: ${PLANNED}`, `order: "${token}"`);
      expect(problemsOf([file(g)])).toEqual([at(g, "order:", `order cannot be read with its code (${reason})`)]);
    }
  });

  test("an order must be legal on the tree, point by point", () => {
    const g = GUIDE.replace(PLANNED, OUT_OF_ORDER);
    expect(problemsOf([file(g)])).toEqual([at(g, "order:", "order: Talent 21 at level 10: Needs 5 points spent in Left on rows above.")]);
  });

  test("order2 needs code2, and a second set's order is held to the same rules", () => {
    const orphan = GUIDE.replace(`order: ${PLANNED}`, `order: ${PLANNED}\norder2: ${PLANNED}`);
    expect(problemsOf([file(orphan)])).toEqual([at(orphan, "order2:", "order2 has no code2 to order")]);
    const second = GUIDE.replace(`order: ${PLANNED}`, `order: ${PLANNED}\ncode2: ${CODE}\norder2: ${PROVISIONAL}`);
    expect(problemsOf([file(second)])).toEqual([at(second, "order2:", "order2 is provisional (O1g)")]);
    const both = GUIDE.replace(`order: ${PLANNED}`, `order: ${PLANNED}\ncode2: ${CODE}\norder2: ${PLANNED}`);
    expect(problemsOf([file(both)])).toEqual([]);
  });

  test("a guide may leave its order out; readers then show the order as unknown", () => {
    expect(problemsOf([file(GUIDE.replace(`order: ${PLANNED}\n`, ""))])).toEqual([]);
  });

  test("the plan lives in the front matter: a link in the body carries none", () => {
    const g = GUIDE.replace("[[deadmines]]", `[[deadmines]] ([the plan](/tools/talents/mage#plan=${CODE}&order=${PROVISIONAL}))`);
    expect(problemsOf([file(g)])).toEqual([at(g, "At level 10", "carries a talent plan")]);
    expect(problemsOf([file(GUIDE.replace("[[deadmines]]", "[[deadmines]] ([the calculator](/tools/talents/mage))"))])).toEqual([]);
  });

  test("build links open a plan too, so the body carries none of them either", () => {
    // The calculator's Copy link, with one set or two, and a saved build's short link.
    for (const link of [`[the plan](/tools/talents/mage/b/${CODE})`, `[both sets](https://everloot.app/tools/talents/mage/b/${CODE}/${CODE})`, "[a build](/b/abcd1234)"]) {
      const g = GUIDE.replace("[[deadmines]]", `[[deadmines]] (${link})`);
      expect(problemsOf([file(g)])).toEqual([at(g, "At level 10", `${link} carries a talent plan`)]);
    }
  });
});

describe("levels", () => {
  test("levels run from low to high, within the tree's levels, and reach the level the plan needs", () => {
    const backwards = GUIDE.replace("levels: { from: 10, to: 60 }", "levels: { from: 40, to: 20 }");
    expect(messagesOf(backwards)).toContainEqual(expect.stringContaining("levels.from (40) is above levels.to (20)"));
    const high = GUIDE.replace("levels: { from: 10, to: 60 }", "levels: { from: 10, to: 70 }");
    expect(problemsOf([file(high)])).toEqual([at(high, "levels:", "levels.to (70) is above the tree's last level (60)")]);
    const low = GUIDE.replace("levels: { from: 10, to: 60 }", "levels: { from: 10, to: 12 }");
    expect(problemsOf([file(low)])).toEqual([at(low, "levels:", "the plan needs level 15, above levels.to (12)")]);
  });
});

describe("history", () => {
  test("a published guide records its version in history", () => {
    const none = GUIDE.replace(`history:\n${V1}`, "history: []");
    expect(problemsOf([file(none)])).toEqual([at(none, "history:", "a published guide records version 1 in history")]);
    const ahead = GUIDE.replace("version: 1\n", "version: 2\n");
    expect(problemsOf([file(ahead)])).toEqual([at(ahead, "history:", "a published guide records version 2 in history")]);
  });

  test("versions count up from 1, and their dates never go back", () => {
    const skipped = asVersion2(GUIDE).replace("{ version: 2, on", "{ version: 3, on").replace("version: 2\n", "version: 3\n");
    expect(problemsOf([file(skipped)])).toContainEqual(at(skipped, "  - { version: 3", "history.1 is version 3; versions count up from 1, so it is version 2"));
    const back = asVersion2(GUIDE).replaceAll("2026-10-25", "2026-10-05");
    expect(problemsOf([file(back)])).toEqual([at(back, "  - { version: 2", "history.1 is dated 2026-10-05, before version 1 (2026-10-20)")]);
  });

  test("history's last entry is the review in reviewed", () => {
    const other = GUIDE.replace(/^reviewed: .*$/m, "reviewed: { by: Lee, on: 2026-10-20, build: 1.0.0.1 }");
    expect(problemsOf([file(other)])).toEqual([at(other, "  - { version: 1", "history.0 records a different review from reviewed")]);
  });

  test("a draft holds the last published version or the next one", () => {
    const withdrawn = GUIDE.replace("status: published", "status: draft");
    expect(problemsOf([file(withdrawn)])).toEqual([]);
    expect(problemsOf([file(withdrawn.replace("version: 1\n", "version: 2\n"))])).toEqual([]);
    const jump = withdrawn.replace("version: 1\n", "version: 3\n");
    expect(problemsOf([file(jump)])).toEqual([at(jump, "version:", "version 3 does not follow history")]);
    const fresh = asDraft(GUIDE).replace("version: 1\n", "version: 2\n");
    expect(problemsOf([file(fresh)])).toEqual([at(fresh, "version:", "version 2 does not follow history")]);
  });
});

describe("published revisions stay as they were", () => {
  const before = [file(GUIDE)];
  const edited = GUIDE.replace("Whether the point levels hold", "Whether the levels hold");

  test("an edit to a published version fails until it is a new version", () => {
    expect(problemsOf([file(edited)], { ...ctx, previous: before })).toEqual([at(edited, "version:", "version 1 is published and has changed")]);
    expect(problemsOf([file(asVersion2(edited))], { ...ctx, previous: before })).toEqual([]);
  });

  test("a new review date is a change too: no restamping without a new version", () => {
    const restamped = GUIDE.replaceAll("2026-10-20", "2026-10-24");
    expect(problemsOf([file(restamped)], { ...ctx, previous: before })).toEqual([at(restamped, "version:", "version 1 is published and has changed")]);
  });

  test("history only grows", () => {
    const rewritten = asVersion2(GUIDE).replace("First published version.", "The first version.");
    expect(problemsOf([file(rewritten)], { ...ctx, previous: before })).toEqual([at(rewritten, "  - { version: 1", "history.0 differs from version 1 as it was published")]);
  });

  test("versions never go down", () => {
    expect(problemsOf([file(GUIDE)], { ...ctx, previous: [file(asVersion2(GUIDE))] })).toContainEqual(at(GUIDE, "version:", "version 1 is below version 2"));
  });

  test("a guide that was published keeps its slug and its file", () => {
    const moved = GUIDE.replace("slug: frost-leveling", "slug: frost-levels");
    expect(problemsOf([file(moved, "guides/frost-levels.md")], { ...ctx, previous: before })).toContainEqual({
      file: "guides/frost-levels.md", line: lineOf(moved, "slug:"), message: expect.stringContaining('slug "frost-levels" was "frost-leveling"'),
    });
    expect(problemsOf([], { ...ctx, previous: before })).toEqual([{ file: PATH, message: expect.stringContaining("guide 1 (frost-leveling) was published") }]);
  });

  test("withdrawing a published guide keeps it as it was, as a draft", () => {
    expect(problemsOf([file(GUIDE.replace("status: published", "status: draft"))], { ...ctx, previous: before })).toEqual([]);
  });

  test("a copy from before the change that does not read fails, so an edit or a deletion cannot slip past it", () => {
    // As if the schema had moved: the copy before the change has a field today's schema does not know.
    const unknown = GUIDE.replace("author: Robin", "author: Robin\nrating: 5");
    const before = at(unknown, "rating:", 'as it was before this change, the file does not read, so its published versions cannot be checked: front matter: unknown field "rating"');
    expect(problemsOf([file(edited)], { ...ctx, previous: [file(unknown)] })).toEqual([before]);
    expect(problemsOf([], { ...ctx, previous: [file(unknown)] })).toEqual([before]);
    // A copy whose YAML does not parse at all.
    const twice = GUIDE.replace("author: Robin", "author: Robin\nauthor: Sam");
    expect(problemsOf([file(edited)], { ...ctx, previous: [file(twice)] })).toEqual([
      { file: PATH, line: lineOf(twice, "author: Sam"), message: expect.stringMatching(/^as it was before this change, the file does not read, so its published versions cannot be checked: .*unique/s) },
    ]);
  });

  test("a draft that was never published may change or go", () => {
    const draft = asDraft(GUIDE);
    expect(problemsOf([file(draft.replace("Whether the point levels hold", "Whether the levels hold"))], { ...ctx, previous: [file(draft)] })).toEqual([]);
    expect(problemsOf([], { ...ctx, previous: [file(draft)] })).toEqual([]);
  });
});

describe("sources and references", () => {
  test("a link to evidence is listed in sources", () => {
    const unlisted = GUIDE.replace("Whether the point levels hold", "Whether [the levels](https://worldofwarcraft.blizzard.com/en-us/news/2) hold");
    expect(problemsOf([file(unlisted)])).toEqual([at(unlisted, "Whether [the levels]", "https://worldofwarcraft.blizzard.com/en-us/news/2 is not in sources")]);
  });

  test("every source is cited next to the claim it supports", () => {
    const uncited = GUIDE.replace(`[named the class changes](${SOURCE})`, "named the class changes");
    expect(problemsOf([file(uncited)])).toEqual([at(uncited, "  - { title:", "sources.0 is not cited in the body")]);
  });

  test("sources are Blizzard's own posts, not other sites' guides", () => {
    const other = GUIDE.replaceAll(SOURCE, "https://www.wowhead.com/guide/mage");
    expect(problemsOf([file(other)])).toEqual([at(other, "  - { title:", "sources.0 is on www.wowhead.com")]);
  });

  test("an item or zone token names one the game files have", () => {
    const missing = GUIDE.replace("{item:2589}", "{item:7}");
    expect(problemsOf([file(missing)])).toEqual([at(missing, "At level 10", "{item:7} is not an item in the game files")]);
    const bad = GUIDE.replace("{item:2589}", "{spell:5}");
    expect(messagesOf(bad)).toContainEqual(expect.stringContaining('"{spell:5}" is not a token'));
  });

  test("prose may give numbers: a guide's numbers are checked in review, not refused by rule", () => {
    expect(BODY).toContain("At level 10, put 5 points");
    expect(problemsOf([file(GUIDE)])).toEqual([]);
  });
});

describe("crosslinks", () => {
  const withLink = (link: string) => GUIDE.replace("[[deadmines]]", link);

  test("a published guide links only to published wiki pages", () => {
    for (const link of ["[[stockades]]", "[the Stockades](/wiki/stockades)", "[the Stockades](https://everloot.app/wiki/stockades/)", "[the Stockades](/beta/wiki/stockades#bosses)",
      "[the Stockades](https://everloot.app/ptr/wiki/stockades?from=guide)"]) {
      const g = withLink(link);
      expect(problemsOf([file(g)])).toEqual([at(g, "At level 10", `${link} links to a draft; a published guide links only to published pages`)]);
    }
    // A published page through a game version's prefix is still published.
    expect(problemsOf([file(withLink("[the Deadmines](/beta/wiki/deadmines?from=guide)"))])).toEqual([]);
    const g = withLink("[[nowhere]]");
    expect(problemsOf([file(g)])).toEqual([at(g, "At level 10", "[[nowhere]] links to a page that does not exist")]);
  });

  test("a published guide links only to published guides", () => {
    const other = asDraft(GUIDE).replace("id: 1", "id: 2").replace("slug: frost-leveling", "slug: fire-leveling");
    const g = withLink("[the fire guide](/guides/fire-leveling)");
    expect(problemsOf([file(g), file(other, "guides/fire-leveling.md")])).toEqual([at(g, "At level 10", "[the fire guide](/guides/fire-leveling) links to a draft")]);
    // A game version's prefix shows the same guide; a path that only starts with a prefix's letters is no guide.
    for (const href of ["/beta/guides/fire-leveling", "/ptr/guides/fire-leveling#talents", "https://everloot.app/beta/guides/fire-leveling?from=hub"]) {
      const via = withLink(`[the fire guide](${href})`);
      expect(problemsOf([file(via), file(other, "guides/fire-leveling.md")]), href).toEqual([at(via, "At level 10", `[the fire guide](${href}) links to a draft`)]);
    }
    expect(problemsOf([file(withLink("[the fire guide](/betamax/guides/fire-leveling)")), file(other, "guides/fire-leveling.md")])).toEqual([]);
    const gone = withLink("[the arcane guide](/guides/arcane-leveling)");
    expect(problemsOf([file(gone)])).toEqual([at(gone, "At level 10", "links to a page that does not exist")]);
  });

  test("a draft may link to drafts", () => {
    expect(problemsOf([file(asDraft(withLink("[[stockades]]")))])).toEqual([]);
  });
});

describe("sections", () => {
  const sections = GUIDE_SECTIONS.join(", ");

  test(`a guide has ${GUIDE_SECTIONS.length} sections, in order`, () => {
    const missing = GUIDE.replace(/## What we do not know yet\n\n.*\n/, "");
    expect(problemsOf([file(missing)])).toEqual([at(missing, "## Who it is for", `sections must be, in order: ${sections}; found: Who it is for, Why this plan, How to play it`)]);
    const swapped = GUIDE.replace("## Why this plan", "## Swap").replace("## How to play it", "## Why this plan").replace("## Swap", "## How to play it");
    expect(messagesOf(swapped)).toEqual([expect.stringContaining("sections must be, in order")]);
  });

  test("each section of a published guide says something in our own words", () => {
    const quoted = GUIDE.replace(/(## What we do not know yet\n\n).*\n/, "$1> Blizzard has not said.\n");
    expect(problemsOf([file(quoted)])).toContainEqual(at(quoted, "## What we do not know yet", 'the "What we do not know yet" section needs words of our own'));
  });

  test(`a published guide has at least ${MIN_PROSE_WORDS} words of its own prose, a draft may have fewer`, () => {
    const short = GUIDE.replace(/ stone river road hill mine[a-z ]*/g, "");
    expect(problemsOf([file(short)])).toEqual([at(short, "## Who it is for", `at least ${MIN_PROSE_WORDS} words of its own prose`)]);
    expect(problemsOf([file(asDraft(short))])).toEqual([]);
  });

  test("no # heading and no text before the first section", () => {
    const titled = GUIDE.replace("## Who it is for", "# Frost leveling\n\n## Who it is for");
    expect(problemsOf([file(titled)])).toEqual([at(titled, "# Frost leveling", "no # heading in the body")]);
    const lead = GUIDE.replace("## Who it is for", "An opening line.\n\n## Who it is for");
    expect(problemsOf([file(lead)])).toEqual([at(lead, "An opening line.", 'text before the first ## section; start with "Who it is for"')]);
  });
});

describe("files", () => {
  test("the slug matches the file name, and ids and slugs are not shared", () => {
    expect(problemsOf([file(GUIDE, "guides/other.md")])).toContainEqual({ file: "guides/other.md", line: lineOf(GUIDE, "slug:"), message: expect.stringContaining('slug "frost-leveling" must match the file name (other.md)') });
    const twin = GUIDE.replace("slug: frost-leveling", "slug: fire-leveling");
    expect(problemsOf([file(GUIDE), file(twin, "guides/fire-leveling.md")])).toEqual([{ file: "guides/fire-leveling.md", line: lineOf(twin, "id:"), message: expect.stringContaining("id 1 is already used by guides/frost-leveling.md") }]);
  });

  test("a file without front matter is one problem", () => {
    expect(problemsOf([file("Just words.")])).toEqual([{ file: PATH, line: 1, message: "the page must start with front matter between --- lines" }]);
  });

  test("private paths and AI credits are refused, with the pattern CI uses", () => {
    const path = ["C:", "Users", "carl" + "i", "notes.md"].join("/");
    const leaky = GUIDE.replace("is not confirmed.", `is not confirmed. See ${path}.`);
    expect(problemsOf([file(leaky)])).toEqual([at(leaky, "Whether the point levels", "names a private path")]);
    const credited = GUIDE.replace("is not confirmed.", "is not confirmed. Written with ChatGPT.");
    expect(problemsOf([file(credited)])).toEqual([at(credited, "Whether the point levels", "credits an AI tool")]);
  });

  test("the committed guides pass, and the folder's README is not a guide", () => {
    const dir = mkdtempSync(join(tmpdir(), "guides-"));
    writeFileSync(join(dir, "README.md"), "# not a guide");
    writeFileSync(join(dir, "frost-leveling.md"), GUIDE);
    expect(readGuideFiles(dir)).toEqual([{ path: PATH, source: GUIDE }]);
    const committed = checkGuides(readGuideFiles(), loadGuideCheckContext());
    expect(committed.problems).toEqual([]);
  });
});

describe("guide-check", () => {
  const KB = fileURLToPath(new URL("..", import.meta.url));
  /** The real command, as CI runs it, on folders of its own. */
  const guideCheck = (...args: string[]) => {
    const run = spawnSync(process.execPath, [join(KB, "node_modules", "tsx", "dist", "cli.mjs"), join(KB, "src", "cli.ts"), "guide-check", ...args], { cwd: KB, encoding: "utf8" });
    return { code: run.status, stdout: run.stdout, stderr: run.stderr };
  };
  const folder = (files: Record<string, string> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "guide-check-"));
    for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source);
    return dir;
  };

  test("a --previous that is not a folder fails before anything is checked", { timeout: 60_000 }, () => {
    const missing = join(folder(), "gone");
    expect(guideCheck("--dir", folder(), "--previous", missing)).toMatchObject({ code: 1, stdout: "", stderr: expect.stringContaining(`--previous ${missing} is not a folder; nothing was checked`) });
    expect(guideCheck("--dir", folder(), "--previous")).toMatchObject({ code: 1, stdout: "", stderr: expect.stringContaining("--previous needs a folder") });
  });

  test("published guides are held to the copy from before the change", { timeout: 60_000 }, () => {
    expect(guideCheck("--dir", folder(), "--previous", folder({ "README.md": "# not a guide" }))).toMatchObject({ code: 0, stdout: expect.stringContaining("compared with 0 guides") });
    const deleted = guideCheck("--dir", folder(), "--previous", folder({ "frost-leveling.md": GUIDE }));
    expect(deleted).toMatchObject({ code: 1, stderr: expect.stringContaining(`${PATH}: guide 1 (frost-leveling) was published and is gone`) });
    const unreadable = GUIDE.replace("author: Robin", "author: Robin\nrating: 5");
    expect(guideCheck("--dir", folder(), "--previous", folder({ "frost-leveling.md": unreadable }))).toMatchObject({
      code: 1,
      stderr: expect.stringContaining(`${PATH}:${lineOf(unreadable, "rating:")}: as it was before this change, the file does not read`),
    });
  });

  test("without --previous it says the comparison was not made", { timeout: 60_000 }, () => {
    expect(guideCheck("--dir", folder())).toMatchObject({ code: 0, stdout: expect.stringContaining("0 guides (0 published, 0 draft), 0 problems\nnot compared") });
  });
});

// The first guide, prepared for its editor: its facts come from the game files and Blizzard's posts, its advice is
// proposed under an "Editor to confirm" label, and it is published only by a person who reviewed it.
describe("the Mage leveling pilot", () => {
  const PILOT = "guides/mage-leveling.md";
  const LABEL = "### Editor to confirm";
  const mage = siteCatalog("mage");
  const pilot = (): GuideFile => {
    const f = readGuideFiles().find((g) => g.path === PILOT);
    if (!f) throw new Error(`${PILOT} is not committed`);
    return f;
  };
  const checked = () => {
    const g = checkGuides(readGuideFiles(), loadGuideCheckContext()).guides.find((x) => x.file === PILOT);
    if (!g) throw new Error(`${PILOT} does not read`);
    return g;
  };
  /** The pilot as its editor would publish it once each proposal is confirmed as written: the labels out, the order
   *  planned by a person, and the review with its history entry. */
  const asPublished = (source: string, by = "Editor", on = "2026-10-27") =>
    source
      .replace("status: draft", "status: published")
      .replace(/^order: O1g-/m, "order: O1p-")
      .replace("reviewed: null", `reviewed: { by: ${by}, on: ${on}, build: ${mage.build} }`)
      .replace("history: []", `history:\n  - { version: 1, on: ${on}, by: ${by}, build: ${mage.build}, note: "First published version." }`)
      .replace(/^### Editor to confirm\r?\n(?:\r?\n)?/gm, "")
      .replace(/^- Proposed: /gm, "- ");

  test("its plan places exactly on the current Mage tree, spends every point the levels give and is legal point by point", () => {
    const { fm } = checked();
    const code = decodeBuild(fm.code);
    if (!code.ok) throw new Error(code.error);
    const placed = resolveBuild(mage, code.build);
    if (!placed.ok) throw new Error(placed.error);
    expect(placed.build).toMatchObject({ unknown: [], clamped: [], rejected: [] });
    expect(placed.build.ranks).toEqual(code.build.ranks);
    const spent = pointsSpent(placed.build.ranks);
    expect(spent).toBe(pointsAtLevel(mage, fm.levels.to));
    expect(levelFor(mage, spent)).toBeLessThanOrEqual(fm.levels.to);
    expect(fm.order).toBeDefined();
    const order = decodeOrder(fm.order!, code.build.ranks);
    if (!order.ok) throw new Error(order.error);
    expect(validateOrder(mage, placed.build.ranks, order.order)).toEqual({ ok: true });
    // The same points backwards would open with a talent its tree has not opened yet: the check says so on the order's line.
    const backwards = encodeOrder(placed.build.ranks, [...order.order].reverse(), order.origin)!;
    expect(validateOrder(mage, placed.build.ranks, [...order.order].reverse())).toMatchObject({ ok: false, index: 0 });
    const refused = checkGuides([{ path: PILOT, source: pilot().source.replace(fm.order!, backwards) }], loadGuideCheckContext()).problems;
    expect(refused).toEqual([{ file: PILOT, line: lineOf(pilot().source, "order:"), message: expect.stringMatching(/^order: .+ at level 10: /) }]);
  });

  test("it carries no review until a person reviews it, and the check refuses to publish it as it stands", () => {
    const { fm } = checked();
    if (fm.history.length > 0) {
      expect(fm.reviewed?.by).toBeTruthy();
      return;
    }
    expect(fm).toMatchObject({ status: "draft", version: 1, reviewed: null, history: [] });
    const asIs = checkGuides([{ path: PILOT, source: pilot().source.replace("status: draft", "status: published") }], loadGuideCheckContext());
    expect(asIs.problems.map((p) => p.message)).toEqual(expect.arrayContaining([
      expect.stringContaining("a published guide needs reviewed"),
      expect.stringContaining("a published guide records version 1 in history"),
      ...(fm.order?.startsWith("O1g-") ? [expect.stringContaining("is provisional (O1g)")] : []),
    ]));
  });

  test("published by its editor, it passes and links to no page that is not published", () => {
    const published = asPublished(pilot().source);
    expect(published).not.toContain(LABEL);
    const result = checkGuides([{ path: PILOT, source: published }], loadGuideCheckContext());
    expect(result.problems).toEqual([]);
    expect(result.guides[0].fm).toMatchObject({ status: "published", order: expect.stringMatching(/^O1p-/) });
  });

  test("proposed advice stays off the site: a published guide has no Editor to confirm label, and the unreviewed pilot labels its advice", () => {
    for (const g of checkGuides(readGuideFiles(), loadGuideCheckContext()).guides) {
      const source = readGuideFiles().find((f) => f.path === g.file)!.source;
      if (g.fm.status === "published") expect(source, g.file).not.toContain(LABEL);
    }
    const { fm, page } = checked();
    if (fm.reviewed) return;
    const labelled = new Set<string>();
    let section = "";
    for (const b of page.blocks) {
      if (b.type === "heading" && b.level === 2) section = b.text;
      if (b.type === "heading" && b.level === 3 && b.text === "Editor to confirm") labelled.add(section);
    }
    expect([...labelled]).toEqual(expect.arrayContaining(["Who it is for", "Why this plan", "How to play it"]));
  });
});
