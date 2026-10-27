import { describe, expect, test } from "vitest";
import { badTokensIn, inlineText, parseInline, parsePage, wikiLinkTarget } from "../src/wiki/page.js";

describe("parseInline", () => {
  test("splits text, entity tokens and wiki links", () => {
    expect(parseInline("Take {item:2589} to {npc:448} in {zone:1436}, see [[deadmines]].")).toEqual([
      { kind: "text", text: "Take " },
      { kind: "entity", entity: "item", id: 2589 },
      { kind: "text", text: " to " },
      { kind: "entity", entity: "npc", id: 448 },
      { kind: "text", text: " in " },
      { kind: "entity", entity: "zone", id: 1436 },
      { kind: "text", text: ", see " },
      { kind: "link", slug: "deadmines" },
      { kind: "text", text: "." },
    ]);
  });

  test("reads quest and faction tokens", () => {
    expect(parseInline("{quest:176}{faction:72}")).toEqual([{ kind: "entity", entity: "quest", id: 176 }, { kind: "entity", entity: "faction", id: 72 }]);
  });

  test("leaves malformed tokens as text", () => {
    expect(parseInline("{item:abc} [[Bad Slug]]")).toEqual([{ kind: "text", text: "{item:abc} [[Bad Slug]]" }]);
  });

  test("inlineText counts each token as one word", () => {
    expect(inlineText(parseInline("Go to {zone:1436} and [[deadmines]]."))).toBe("Go to X and X.");
  });
});

describe("badTokensIn", () => {
  test("finds braces and double brackets that are not valid tokens", () => {
    expect(badTokensIn("{item:abc} {spell:5} {item:} {item:0} [[Bad Slug]] [[ok-slug]] {npc:448}")).toEqual(["{item:abc}", "{spell:5}", "{item:}", "{item:0}", "[[Bad Slug]]"]);
  });

  test("plain prose has none", () => {
    expect(badTokensIn("The Deadmines lie under Westfall.")).toEqual([]);
  });
});

describe("wikiLinkTarget", () => {
  test("names the page a link into the wiki points at, with a trailing slash, query or fragment, or written out in full", () => {
    for (const href of ["/wiki/deadmines", "/wiki/deadmines/", "/wiki/deadmines?from=westfall", "/wiki/deadmines#history", "/wiki/deadmines/#history",
      "https://everloot.app/wiki/deadmines", "https://www.everloot.app/wiki/deadmines?from=westfall", "//everloot.app/wiki/deadmines"]) {
      expect(wikiLinkTarget(href)).toBe("deadmines");
    }
  });

  test("knows the site's own address as a browser does: the host in any case, the default port written or not", () => {
    for (const href of ["https://EVERLOOT.APP/wiki/deadmines#history", "https://everloot.app:443/wiki/deadmines?from=westfall", "https://EVERLOOT.APP:443/wiki/deadmines/",
      "https://WWW.Everloot.App:443/wiki/deadmines#history", "//EVERLOOT.APP:443/wiki/deadmines"]) {
      expect(wikiLinkTarget(href)).toBe("deadmines");
    }
  });

  test("reads the path as a browser does, so a dot segment or a backslash cannot hide the page", () => {
    for (const href of ["/wiki/x/../deadmines", "/wiki\\deadmines", "https://EVERLOOT.APP/wiki/./deadmines"]) expect(wikiLinkTarget(href)).toBe("deadmines");
  });

  test("keeps any other page part as written, so it names no page", () => {
    expect(wikiLinkTarget("/wiki/Deadmines")).toBe("Deadmines");
    expect(wikiLinkTarget("/wiki/deadmines/extra")).toBe("deadmines/extra");
    expect(wikiLinkTarget("/wiki/dead%2Dmines")).toBe("dead%2Dmines");
  });

  test("is null for the hub, other paths on the site and other sites", () => {
    for (const href of ["/wiki", "/wiki/", "/wiki?q=dead", "/wiki#recent", "/wikis/deadmines", "/database/zones/1436-westfall",
      "https://warcraft.wiki.gg/wiki/Deadmines", "https://worldofwarcraft.blizzard.com/en-us/news/1", "https://everloot.app.example.com/wiki/deadmines",
      "https://everloot.app:8443/wiki/deadmines", "https://everloot-git-feat.vercel.app/wiki/deadmines"]) {
      expect(wikiLinkTarget(href)).toBeNull();
    }
  });
});

describe("parsePage", () => {
  const source = [
    "---",
    "id: 1",
    "slug: deadmines",
    "---",
    "",
    "## Overview",
    "",
    "First line of a paragraph",
    "continues here with {zone:1436}.",
    "> Blizzard's words, quoted.",
    "",
    "- one item with [[westfall]]",
    "  wrapped onto a second line",
    "- another item",
    "",
    "### A subsection",
    "Bad {item:x} token.",
  ].join("\r\n");

  test("parses the front matter as YAML and the body into blocks with file line numbers", () => {
    const page = parsePage(source);
    expect(page.data).toEqual({ id: 1, slug: "deadmines" });
    expect(page.bodyLine).toBe(5);
    expect(page.blocks.map((b) => [b.type, b.line])).toEqual([["heading", 6], ["paragraph", 8], ["quote", 10], ["list", 12], ["heading", 16], ["paragraph", 17]]);
    const [h2, para, quote, list, h3] = page.blocks;
    expect(h2).toMatchObject({ type: "heading", level: 2, text: "Overview" });
    expect(h3).toMatchObject({ type: "heading", level: 3, text: "A subsection" });
    expect(para).toMatchObject({ inline: [{ kind: "text", text: "First line of a paragraph continues here with " }, { kind: "entity", entity: "zone", id: 1436 }, { kind: "text", text: "." }] });
    expect(quote).toMatchObject({ inline: [{ kind: "text", text: "Blizzard's words, quoted." }] });
    expect(list).toMatchObject({ items: [[{ kind: "text", text: "one item with " }, { kind: "link", slug: "westfall" }, { kind: "text", text: " wrapped onto a second line" }], [{ kind: "text", text: "another item" }]] });
    expect(page.badTokens).toEqual([{ text: "{item:x}", line: 17 }]);
  });

  test("a page without front matter is refused", () => {
    expect(() => parsePage("## Overview\n\nText.")).toThrow(/front matter/);
  });
});
