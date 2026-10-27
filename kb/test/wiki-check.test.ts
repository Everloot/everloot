import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { stringify } from "yaml";
import { checkWiki, MIN_PROSE_WORDS, typedNumber, type CheckContext, type CheckedPage, type KnownData, type WikiFile } from "../src/wiki/check.js";
import { loadCategories, loadKnownData, loadPrivatePathPattern, parseCategories, readWikiPages } from "../src/wiki/data.js";
import { inlineText, PREP_SECTION } from "../src/wiki/page.js";

const known: KnownData = {
  items: new Set([2589, 24999, 30000]),
  zones: new Set([1436]),
  entrances: new Map([["deadmines", { raid: false }], ["molten-core", { raid: true }]]),
  itemSets: new Set([1]),
  changes: new Set(["us:12:3"]),
};
const ctx: CheckContext = {
  categories: new Set(["dungeons", "raids", "zones", "concepts", "eastern-kingdoms", "westfall"]),
  known,
  privatePaths: loadPrivatePathPattern(),
};

/** Enough plain words to clear the index bar, with no numbers in them. */
const PROSE = Array.from({ length: MIN_PROSE_WORDS }, (_, i) => ["stone", "river", "road", "hill", "mine"][i % 5]).join(" ");

const DUNGEON_BODY = `
## Overview

${PROSE}

## Getting there

The entrance is in {zone:1436}. See [[westfall]].

## History

Written from Blizzard's posts.

## In WoW: Forever

Nothing announced yet.
`;

const ZONE_BODY = `
## Overview

${PROSE}

## History

Written from Blizzard's posts.

## In WoW: Forever

Nothing announced yet.
`;

function front(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1, slug: "deadmines", title: "Deadmines", type: "dungeon", binds: { entrance: "deadmines", zone: 1436 },
    summary: "A dungeon in the Eastern Kingdoms whose entrance lies in Westfall.", categories: ["dungeons", "westfall"],
    origin: "original", adaptedFrom: [], sources: [], status: "published", reviewed: { by: "carlos", on: "2026-10-27" }, ...over,
  };
}

function file(over: Record<string, unknown> = {}, body = DUNGEON_BODY): WikiFile {
  const fm = front(over);
  return { path: `wiki/${String(fm.slug)}.md`, source: `---\n${stringify(fm)}---\n${body}` };
}

const westfall = (over: Record<string, unknown> = {}, body = ZONE_BODY) =>
  file({ id: 2, slug: "westfall", title: "Westfall", type: "zone", binds: { zone: 1436 }, summary: "A zone in the Eastern Kingdoms.", categories: ["zones"], ...over }, body);

/** The problems of a dungeon page checked beside a good Westfall page. */
function problemsOf(over: Record<string, unknown> = {}, body = DUNGEON_BODY): string[] {
  return checkWiki([file(over, body), westfall()], ctx).problems.map((p) => p.message);
}

const withSection = (section: string, text: string) => DUNGEON_BODY.replace(`## ${section}\n\n`, `## ${section}\n\n${text}\n\n`);

/** The first dungeon pages prepared for review. Each is published on its own, by the person who reviewed it. */
const DUNGEON_PILOTS = ["ragefire-chasm", "deadmines", "wailing-caverns"];

test("a good published page and its linked page pass", () => {
  const result = checkWiki([file(), westfall()], ctx);
  expect(result.problems).toEqual([]);
  expect(result.pages.map((p) => p.fm.slug)).toEqual(["deadmines", "westfall"]);
});

describe("front matter", () => {
  test("a missing field, an unknown field and an unknown type fail", () => {
    const { summary: _, ...noSummary } = front({});
    const missing = { path: "wiki/deadmines.md", source: `---\n${stringify(noSummary)}---\n${DUNGEON_BODY}` };
    expect(checkWiki([missing], ctx).problems.map((p) => p.message)).toEqual([expect.stringMatching(/^front matter summary:/)]);
    expect(problemsOf({ author: "someone" })).toEqual([expect.stringMatching(/^front matter: .*author/)]);
    expect(problemsOf({ type: "item" })).toEqual([expect.stringMatching(/^front matter type:/)]);
  });

  test("the slug must match the file name", () => {
    const f = { ...file(), path: "wiki/the-deadmines.md" };
    expect(checkWiki([f, westfall()], ctx).problems.map((p) => p.message)).toEqual([expect.stringContaining('slug "deadmines" must match the file name')]);
  });

  test("ids and slugs are unique", () => {
    const sameId = checkWiki([file(), westfall({ id: 1 })], ctx).problems.map((p) => p.message);
    expect(sameId).toEqual([expect.stringContaining("id 1 is already used by wiki/deadmines.md")]);
    const twin = { ...file({ id: 3 }), path: "wiki/copy/deadmines.md" };
    expect(checkWiki([file(), twin, westfall()], ctx).problems.map((p) => p.message)).toEqual([expect.stringContaining('slug "deadmines" is already used')]);
  });

  test("categories come from the list", () => {
    expect(problemsOf({ categories: ["dungeons", "westfal"] })).toEqual(['category "westfal" is not in categories.yaml']);
  });
});

describe("bindings and tokens", () => {
  test("a bad token fails", () => {
    expect(problemsOf({}, withSection("History", "Ask {spell:5} about {item:abc}."))).toEqual([
      expect.stringContaining('"{spell:5}" is not a token'),
      expect.stringContaining('"{item:abc}" is not a token'),
    ]);
  });

  test("an item token at any id the game files have passes", () => {
    expect(problemsOf({}, withSection("History", "It drops {item:30000} and {item:2589}."))).toEqual([]);
  });

  test("an item the game files do not have fails", () => {
    expect(problemsOf({}, withSection("History", "It drops {item:1234}."))).toEqual(["{item:1234} is not an item in the game files"]);
  });

  test("a quest token at any id passes", () => {
    expect(problemsOf({}, withSection("History", "Start with {quest:176} or {quest:10000}."))).toEqual([]);
  });

  test("a zone token or binding must be a released zone", () => {
    expect(problemsOf({}, withSection("History", "Near {zone:2482}."))).toEqual(["{zone:2482} is not a released zone in the game files"]);
    expect(problemsOf({ binds: { entrance: "deadmines", zone: 2482 } })).toEqual(["binds.zone 2482 is not a released zone in the game files"]);
  });

  test("bindings fit the type and resolve", () => {
    expect(problemsOf({ binds: { entrance: "stockade" } })).toEqual(['binds.entrance "stockade" is not a dungeon or raid entrance in the game files']);
    expect(problemsOf({ binds: { entrance: "molten-core" } })).toEqual(['binds.entrance "molten-core" is a raid, but the page type is dungeon']);
    expect(problemsOf({ binds: { entrance: "deadmines", npc: 448 } })).toEqual([expect.stringMatching(/^binds: .*npc/)]);
    expect(problemsOf({ binds: {} })).toEqual([expect.stringMatching(/^binds\.entrance:/), "a published page binds at least one id, so it shows at least one live data block"]);
  });

  describe("an entrance or race id may be left out only when the page lists a Blizzard post", () => {
    const post = (url: string) => ({ sources: [{ title: "A Blizzard post", url, checkedOn: "2026-10-20" }], status: "draft", reviewed: null });
    const news = post("https://worldofwarcraft.blizzard.com/en-us/news/24301455");
    const race = (over: Record<string, unknown>) =>
      checkWiki([file({ type: "race", ...over }, "## Overview\n\nText.\n\n## In WoW: Forever\n\nText.\n"), westfall()], ctx).problems.map((p) => p.message);

    test("with a Blizzard news or US/EU forum post, a dungeon, raid or race page passes unbound", () => {
      expect(problemsOf({ binds: {}, ...news })).toEqual([]);
      expect(problemsOf({ type: "raid", binds: { zone: 1436 }, ...post("https://us.forums.blizzard.com/en/wow/t/x/1") })).toEqual([]);
      expect(race({ binds: {}, ...post("https://eu.forums.blizzard.com/en/wow/t/x/1") })).toEqual([]);
    });

    test("without one, the binding is still required", () => {
      const required = (key: string) => [`binds.${key}: required unless the page lists a Blizzard post (worldofwarcraft.blizzard.com or the US or EU forums) in sources`];
      expect(problemsOf({ binds: {}, status: "draft", reviewed: null })).toEqual(required("entrance"));
      expect(problemsOf({ binds: {}, ...post("https://www.wowhead.com/news/1") })).toEqual(required("entrance"));
      expect(problemsOf({ binds: {}, ...post("https://worldofwarcraft.blizzard.com.example.com/news/1") })).toEqual(required("entrance"));
      expect(race({ binds: {}, status: "draft", reviewed: null })).toEqual(required("race"));
    });

    test("a binding that is given must still resolve", () => {
      expect(problemsOf({ binds: { entrance: "stockade" }, ...news })).toEqual(['binds.entrance "stockade" is not a dungeon or raid entrance in the game files']);
    });
  });

  test("item sets and /changes entries resolve", () => {
    const set = (itemSet: number) => checkWiki([file({ type: "item-set", binds: { itemSet }, status: "draft" }, "## Overview\n\nText.\n\n## Who wears it\n\nText.\n"), westfall()], ctx).problems.map((p) => p.message);
    expect(set(1)).toEqual([]);
    expect(set(2)).toEqual(["binds.itemSet 2 is not an item set in the game files"]);
    const change = (id: string) => checkWiki([file({ type: "change", binds: { changes: [id] }, status: "draft" }, "## What changed\n\nText.\n\n## What it affects\n\nText.\n"), westfall()], ctx).problems.map((p) => p.message);
    expect(change("us:12:3")).toEqual([]);
    expect(change("us:99:1")).toEqual(['binds.changes "us:99:1" is not an entry on /changes']);
  });
});

describe("links", () => {
  test("a link to a page that does not exist fails", () => {
    expect(problemsOf({}, withSection("History", "See [[nowhere]]."))).toEqual(["[[nowhere]] links to a page that does not exist"]);
  });

  test("a published page links only to published pages; drafts may link to drafts", () => {
    const toDraft = checkWiki([file(), westfall({ status: "draft", reviewed: null })], ctx).problems.map((p) => p.message);
    expect(toDraft).toEqual(["[[westfall]] links to a draft; a published page links only to published pages"]);
    const drafts = checkWiki([file({ status: "draft", reviewed: null }), westfall({ status: "draft", reviewed: null })], ctx);
    expect(drafts.problems).toEqual([]);
  });

  describe("a Markdown link into the wiki follows the same rules", () => {
    const via = (href: string) => withSection("History", `See [the zone](${href}).`);
    const FORMS = ["/wiki/westfall", "/wiki/westfall/", "/wiki/westfall#history", "/wiki/westfall?from=deadmines", "https://everloot.app/wiki/westfall",
      "https://EVERLOOT.APP/wiki/westfall#history", "https://everloot.app:443/wiki/westfall?from=deadmines", "https://EVERLOOT.APP:443/wiki/westfall/",
      // A game version's prefix shows the same page.
      "/beta/wiki/westfall", "/beta/wiki/westfall?from=deadmines#history", "/ptr/wiki/westfall", "https://everloot.app/beta/wiki/westfall"];

    test("to a published page it passes, in every written form", () => {
      for (const href of FORMS) expect(problemsOf({}, via(href))).toEqual([]);
    });

    test("from a published page to a draft it fails, in every written form", () => {
      for (const href of FORMS) {
        const toDraft = checkWiki([file({}, via(href)), westfall({ status: "draft", reviewed: null })], ctx).problems.map((p) => p.message);
        // The first is the [[westfall]] in Getting there.
        expect(toDraft).toEqual(["[[westfall]] links to a draft; a published page links only to published pages", `[the zone](${href}) links to a draft; a published page links only to published pages`]);
      }
    });

    test("to a page that does not exist it fails, from a draft too and inside a quote", () => {
      for (const href of ["/wiki/nowhere", "/wiki/Westfall", "/wiki/westfall/extra", "https://everloot.app/wiki/nowhere?from=deadmines", "https://EVERLOOT.APP/wiki/nowhere#top", "https://EVERLOOT.APP:443/wiki/nowhere"]) {
        expect(problemsOf({}, via(href))).toEqual([`[the zone](${href}) links to a page that does not exist`]);
        expect(problemsOf({ status: "draft", reviewed: null }, via(href))).toEqual([`[the zone](${href}) links to a page that does not exist`]);
      }
      expect(problemsOf({}, withSection("History", "> Blizzard said to read [this](/wiki/nowhere)."))).toEqual(["[this](/wiki/nowhere) links to a page that does not exist"]);
    });

    test("the hub, other paths on the site and other sites are not wiki pages", () => {
      // Another port or a preview host is another site, even pointing at a page that does not exist.
      for (const href of ["/wiki", "/wiki/", "/database/zones/1436-westfall", "https://warcraft.wiki.gg/wiki/Westfall", "https://worldofwarcraft.blizzard.com/en-us/news/1",
        "https://everloot.app:8443/wiki/nowhere", "https://everloot-git-feat.vercel.app/wiki/nowhere", "/betamax/wiki/nowhere", "https://warcraft.wiki.gg/beta/wiki/nowhere"]) {
        expect(problemsOf({}, via(href))).toEqual([]);
      }
    });
  });
});

describe("hand-typed gameplay numbers", () => {
  test.each(["a level 60 dungeon", "a 40-man raid", "for 5 players", "a 25% chance", "it drops 3 bosses' loot", "at 42.5, 67.1", "costs 10g", "within 30 yards"])("%s fails", (text) => {
    expect(problemsOf({}, withSection("History", `It is ${text}.`))).toEqual([expect.stringMatching(/^hand-typed gameplay number/)]);
  });

  test("inside a quote it is allowed", () => {
    expect(problemsOf({}, withSection("History", "> Blizzard said it is a level 60 raid."))).toEqual([]);
    expect(problemsOf({}, withSection("History", 'Blizzard called it "a 40-man raid" in the post.'))).toEqual([]);
  });

  test("dates, versions and tokens are not gameplay numbers", () => {
    expect(problemsOf({}, withSection("History", "Announced on November 4, 2026, in build 1.60.1.70450, near {zone:1436}."))).toEqual([]);
  });

  test("the title and summary follow the same rule", () => {
    expect(problemsOf({ summary: "A level 18 dungeon." })).toEqual([expect.stringMatching(/^summary has a hand-typed gameplay number/)]);
  });

  test("typedNumber returns what it found", () => {
    expect(typedNumber("a level 60 zone")).toBe("level 60");
    expect(typedNumber("a quiet zone")).toBeNull();
  });
});

describe("sections", () => {
  test("headings must follow the type's order", () => {
    const swapped = DUNGEON_BODY.replace("## Getting there", "## TEMP").replace("## History", "## Getting there").replace("## TEMP", "## History");
    expect(problemsOf({}, swapped)).toEqual([expect.stringMatching(/^sections must be, in order: Overview, Getting there, History, In WoW: Forever \(then optionally Before you go\); found: Overview, History, Getting there/)]);
    expect(problemsOf({}, `${DUNGEON_BODY}\n## Trivia\n\nMore.\n`)).toEqual([expect.stringMatching(/^sections must be/)]);
  });

  test("optional trailing sections are allowed where the type has them", () => {
    const faction = (body: string) => checkWiki([file({ type: "faction", binds: { faction: 72 }, status: "draft" }, body), westfall()], ctx).problems.map((p) => p.message);
    const base = "## Overview\n\nText.\n\n## History\n\nText.\n\n## How players gain standing\n\nText.\n";
    expect(faction(base)).toEqual([]);
    expect(faction(`${base}\n## In WoW: Forever\n\nText.\n`)).toEqual([]);
  });

  test("a concept page has free sections, at most four", () => {
    const concept = (n: number) =>
      checkWiki([file({ type: "concept", binds: { tool: "/tools/talents" }, categories: ["concepts"], status: "draft" }, Array.from({ length: n }, (_, i) => `## Part ${"abcde"[i]}\n\nText.\n`).join("\n")), westfall()], ctx).problems.map((p) => p.message);
    expect(concept(4)).toEqual([]);
    expect(concept(5)).toEqual(["a concept page has at most 4 sections; this one has 5"]);
  });

  test("text before the first section and a # heading fail", () => {
    expect(problemsOf({}, `Intro text.\n${DUNGEON_BODY}`)).toEqual([expect.stringMatching(/^text before the first ## section/)]);
    expect(problemsOf({}, `# Deadmines\n${DUNGEON_BODY}`)).toEqual([expect.stringMatching(/^no # heading in the body/)]);
  });
});

describe("Before you go", () => {
  const advised = (text: string) => `${DUNGEON_BODY}\n## Before you go\n\n${text}\n`;
  const ADVICE = "Go with a full group and someone who can heal. The tunnels are narrow, so pull one pack at a time.";

  test("a dungeon or raid page may end with advice for a group about to go in", () => {
    expect(problemsOf({}, advised(ADVICE))).toEqual([]);
    expect(problemsOf({ type: "raid", binds: { entrance: "molten-core" } }, advised(ADVICE))).toEqual([]);
  });

  test("it comes after the Forever section, and no other type has it", () => {
    const early = DUNGEON_BODY.replace("## History", `## Before you go\n\n${ADVICE}\n\n## History`);
    expect(problemsOf({}, early)).toEqual([
      "sections must be, in order: Overview, Getting there, History, In WoW: Forever (then optionally Before you go); found: Overview, Getting there, Before you go, History, In WoW: Forever",
    ]);
    const zone = checkWiki([file(), westfall({}, `${ZONE_BODY}\n## Before you go\n\n${ADVICE}\n`)], ctx).problems.map((p) => p.message);
    expect(zone).toEqual(["sections must be, in order: Overview, History, In WoW: Forever; found: Overview, History, In WoW: Forever, Before you go"]);
  });

  test("it is original advice: an adapted page has none", () => {
    const adapted = { origin: "adapted", status: "draft", reviewed: null, adaptedFrom: [{ title: "Deadmines", url: "https://warcraft.wiki.gg/wiki/Deadmines", extId: "12345", revision: 678 }] };
    expect(problemsOf(adapted, advised(ADVICE))).toEqual(['a "Before you go" section is original advice; an adapted page has none']);
  });

  test("on a published page it needs words of its own, not only a quote or a subheading; a draft may keep the bare heading", () => {
    const refused = ["a published page's \"Before you go\" section needs advice in our own words, not only quotes; leave the heading out until there is some"];
    const empty = `${DUNGEON_BODY}\n## Before you go\n`;
    expect(problemsOf({}, empty)).toEqual(refused);
    expect(problemsOf({}, advised("> Blizzard said to bring a healer."))).toEqual(refused);
    expect(problemsOf({}, advised("### Healers"))).toEqual(refused);
    expect(problemsOf({}, advised(`> Blizzard said to bring a healer.\n\n${ADVICE}`))).toEqual([]);
    expect(problemsOf({ status: "draft", reviewed: null }, empty)).toEqual([]);
  });

  test("the advice follows the page's number and link rules", () => {
    expect(problemsOf({}, advised("Go in at level 18 or higher."))).toEqual(['hand-typed gameplay number ("level 18") outside a quote; numbers come from the infobox and data blocks']);
    // One from Getting there, one from the advice: a link to a draft is refused wherever it is written.
    const toDraft = checkWiki([file({}, advised("Read [[westfall]] before you set out.")), westfall({ status: "draft", reviewed: null })], ctx).problems.map((p) => p.message);
    expect(toDraft).toEqual(Array(2).fill("[[westfall]] links to a draft; a published page links only to published pages"));
  });
});

describe("origin and credit", () => {
  const wikiSource = { title: "Deadmines", url: "https://warcraft.wiki.gg/wiki/Deadmines", extId: "12345", revision: 678 };

  test("an adapted page without its credit fields fails", () => {
    expect(problemsOf({ origin: "adapted", status: "draft", reviewed: null })).toEqual([expect.stringMatching(/^an adapted page needs adaptedFrom/)]);
  });

  test("an adapted page credits the Warcraft Wiki only", () => {
    expect(problemsOf({ origin: "adapted", status: "draft", reviewed: null, adaptedFrom: [wikiSource] })).toEqual([]);
    expect(problemsOf({ origin: "adapted", status: "draft", reviewed: null, adaptedFrom: [{ ...wikiSource, url: "https://example.com/Deadmines" }] })).toEqual([
      expect.stringMatching(/is not a Warcraft Wiki page/),
    ]);
  });

  test("an adapted page is not published before the overlap check exists", () => {
    expect(problemsOf({ origin: "adapted", adaptedFrom: [wikiSource] })).toEqual(["an adapted page cannot be published until the overlap check against the wiki dump exists"]);
  });

  test("an original page carries no adaptedFrom", () => {
    expect(problemsOf({ adaptedFrom: [wikiSource] })).toEqual([expect.stringMatching(/^an original page has no adaptedFrom/)]);
  });
});

describe("the index bar for published pages", () => {
  test("too few words of own prose fails; quotes do not count", () => {
    const short = DUNGEON_BODY.replace(PROSE, `> ${PROSE}\n\nA short overview.`);
    expect(problemsOf({}, short)).toEqual([expect.stringMatching(new RegExp(`^a published page needs at least ${MIN_PROSE_WORDS} words of its own prose; this one has \\d+$`))]);
  });

  test("a published page needs a review and a Forever section with something in it", () => {
    expect(problemsOf({ reviewed: null })).toEqual([expect.stringMatching(/^a published page needs reviewed/)]);
    const empty = DUNGEON_BODY.replace("Nothing announced yet.\n", "");
    expect(problemsOf({}, empty)).toEqual(['a published page needs a "In WoW: Forever" section with something in it']);
  });

  test("a draft does not need to meet the bar", () => {
    expect(problemsOf({ status: "draft", reviewed: null }, DUNGEON_BODY.replace(PROSE, "Short."))).toEqual([]);
  });
});

describe("private paths and AI credits", () => {
  test("a private workspace path fails, with the same pattern CI uses", () => {
    const path = ["C:", "Users", "carl" + "i", "notes.md"].join("/");
    expect(problemsOf({}, withSection("History", `See ${path}.`))).toEqual([expect.stringMatching(/^names a private path/)]);
  });

  test.each(["Written with ChatGPT.", "This page was generated by AI.", "An AI-generated summary.", "Co-Authored-By: someone"])("%s fails", (text) => {
    expect(problemsOf({}, withSection("History", text))).toEqual([expect.stringMatching(/^credits an AI tool/)]);
  });
});

describe("files", () => {
  test("categories.yaml is three groups of slug to name, each slug once", () => {
    expect([...parseCategories("place:\n  westfall: Westfall\nkind:\n  dungeons: Dungeons\ntheme: {}\n")]).toEqual(["westfall", "dungeons"]);
    expect(() => parseCategories("places:\n  westfall: Westfall\n")).toThrow(/unknown group/);
    expect(() => parseCategories("place:\n  westfall: Westfall\nkind:\n  westfall: Westfall\n")).toThrow(/listed twice/);
    expect(() => parseCategories("place:\n  Westfall: Westfall\n")).toThrow(/not a slug/);
    expect(() => parseCategories("place:\n  - westfall\n")).toThrow(/must map each slug/);
  });

  test("the page reader skips the README and other files", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-wiki-"));
    for (const name of ["README.md", "categories.yaml", "b.md", "a.md"]) writeFileSync(join(dir, name), "x");
    expect(readWikiPages(dir).map((f) => f.path)).toEqual(["wiki/a.md", "wiki/b.md"]);
  });

  test("the committed pages pass against the committed game data", () => {
    const result = checkWiki(readWikiPages(), { categories: loadCategories(), known: loadKnownData(), privatePaths: loadPrivatePathPattern() });
    expect(result.problems).toEqual([]);
    expect(result.pages.length).toBeGreaterThan(0);
    // Nothing publishes in this phase but the dungeon pilots, each in a change of its own after its review.
    expect(result.pages.filter((p) => p.fm.status === "published" && !DUNGEON_PILOTS.includes(p.fm.slug)).map((p) => p.fm.slug)).toEqual([]);
  });

  test("the committed game data knows the fixture pages' bindings", () => {
    const data = loadKnownData();
    expect(data.zones.has(1436)).toBe(true);
    expect(data.entrances.get("deadmines")).toEqual({ raid: false });
    expect(data.entrances.get("molten-core")).toEqual({ raid: true });
    expect(data.items.size).toBeGreaterThan(0);
  });
});

// The dungeon pilots, prepared for their editor: facts from the game files, Blizzard's posts and Everloot's own pages,
// advice proposed under an "Editor to confirm" label in Before you go, and a review only from the person who gave it.
describe("the dungeon pilots", () => {
  const LABEL = "### Editor to confirm";
  const committed = (): CheckContext => ({ categories: loadCategories(), known: loadKnownData(), privatePaths: loadPrivatePathPattern() });
  /** A pilot as its editor would publish it once each proposal is confirmed as written: the label out, and the review. */
  const asPublished = (source: string) =>
    source
      .replace("status: draft", "status: published")
      .replace("reviewed: null", "reviewed: { by: Editor, on: 2026-10-27 }")
      .replace(/^### Editor to confirm\r?\n(?:\r?\n)?/gm, "")
      .replace(/^- Proposed: /gm, "- ");

  test("each is bound to its own entrance in the game files and passes the check, with no review until a person gives one", () => {
    const result = checkWiki(readWikiPages(), committed());
    const known = loadKnownData();
    for (const slug of DUNGEON_PILOTS) {
      const page = result.pages.find((p) => p.fm.slug === slug);
      if (!page) throw new Error(`wiki/${slug}.md does not read`);
      expect(result.problems.filter((p) => p.file === page.file), slug).toEqual([]);
      expect(page.fm, slug).toMatchObject({ type: "dungeon", origin: "original", binds: { entrance: slug } });
      expect(known.entrances.get(slug), slug).toEqual({ raid: false });
      if (page.fm.status === "draft") expect(page.fm.reviewed, slug).toBeNull();
    }
  });

  test("each can be published on its own: reviewed, it passes beside the other pages as they are and links to no draft", () => {
    for (const slug of DUNGEON_PILOTS) {
      const path = `wiki/${slug}.md`;
      const files = readWikiPages().map((f) => (f.path === path ? { ...f, source: asPublished(f.source) } : f));
      const result = checkWiki(files, committed());
      expect(result.problems.filter((p) => p.file === path), slug).toEqual([]);
      expect(result.pages.find((p) => p.file === path)?.fm.status, slug).toBe("published");
    }
  });

  /** A pilot's own prose as the page check reads it: the summary, then paragraphs and list items, tokens as words, no
   *  headings and no quotes. */
  const proseOf = (p: CheckedPage): string[] => [
    p.fm.summary,
    ...p.page.blocks.flatMap((b) => (b.type === "paragraph" ? [inlineText(b.inline)] : b.type === "list" ? b.items.map((i) => inlineText(i)) : [])),
  ];
  const pilots = () => checkWiki(readWikiPages(), committed()).pages.filter((p) => DUNGEON_PILOTS.includes(p.fm.slug));

  test("a pilot types no count by hand, in words either: counts come from the page's data", () => {
    const COUNT = /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|hundred|dozen)\b/i;
    for (const p of pilots()) for (const text of proseOf(p)) expect(COUNT.exec(text)?.[0], `${p.file}: ${text}`).toBeUndefined();
  });

  test("what a pilot says of Blizzard's posts is Everloot's record up to a date, and the record bears it out", () => {
    const { posts } = JSON.parse(readFileSync(new URL("../changes/blue-posts.json", import.meta.url), "utf8")) as {
      posts: { game: string; postedAt: string; title: string; excerpt?: string }[];
    };
    const newest = posts.map((x) => x.postedAt.slice(0, 10)).sort().at(-1)!;
    const SAID = /Everloot's record of Blizzard's posts, through (\d{4}-\d{2}-\d{2}), has nothing about (.+?) for WoW: Forever/;
    for (const p of pilots()) {
      const text = proseOf(p).join("\n");
      // Not the whole of what Blizzard has said: only what the record holds, and up to when.
      expect(text, p.file).not.toMatch(/Blizzard has (?:not|never) (?:announced|said)/i);
      const said = SAID.exec(text);
      if (!said) continue;
      const [, through, what] = said;
      expect(through <= newest, `${p.file}: the record runs to ${newest}`).toBe(true);
      const name = new RegExp(what.replace(/^the /i, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const naming = posts.filter((x) => x.game === "forever" && x.postedAt.slice(0, 10) <= through && name.test(`${x.title} ${x.excerpt ?? ""}`));
      expect(naming.map((x) => x.title), p.file).toEqual([]);
    }
  });

  test("proposed advice stays off the site: a published page has no Editor to confirm label, and an unreviewed pilot labels its advice", () => {
    const files = readWikiPages();
    for (const p of checkWiki(files, committed()).pages) {
      if (p.fm.status === "published") expect(files.find((f) => f.path === p.file)!.source, p.file).not.toContain(LABEL);
      if (!DUNGEON_PILOTS.includes(p.fm.slug) || p.fm.reviewed) continue;
      const prep = p.page.blocks.findIndex((b) => b.type === "heading" && b.level === 2 && b.text === PREP_SECTION);
      expect(prep, p.file).toBeGreaterThan(-1);
      expect(p.page.blocks.slice(prep + 1).some((b) => b.type === "heading" && b.level === 3 && b.text === "Editor to confirm"), p.file).toBe(true);
    }
  });
});
