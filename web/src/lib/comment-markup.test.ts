import { describe, expect, it } from "vitest";
import { COMMENT_LINK_HOSTS, commentHref, parseComment, type Inline } from "./comment-markup";

const texts = (nodes: Inline[]): string =>
  nodes.map((n) => (n.kind === "text" || n.kind === "code" ? n.text : n.kind === "br" ? "\n" : texts(n.children))).join("");

describe("commentHref", () => {
  it("allows https links to everloot.app and the listed WoW sites, and this site's own paths", () => {
    expect(commentHref("https://everloot.app/database/items/19019")).toBe("https://everloot.app/database/items/19019");
    expect(commentHref("https://www.wowhead.com/item=19019")).toBe("https://www.wowhead.com/item=19019");
    expect(commentHref("https://worldofwarcraft.blizzard.com/en-us/news")).toBe("https://worldofwarcraft.blizzard.com/en-us/news");
    expect(commentHref("https://warcraft.wiki.gg/wiki/Ragnaros")).toBe("https://warcraft.wiki.gg/wiki/Ragnaros");
    expect(commentHref("/database/quests/7")).toBe("/database/quests/7");
    expect(COMMENT_LINK_HOSTS).toContain("everloot.app");
  });

  it("refuses every other address, look-alikes and schemes included", () => {
    for (const bad of [
      "https://evil.example", "http://everloot.app/", "https://everloot.app.evil.example/", "https://evileverloot.app/",
      "https://everloot.app@evil.example/", "https://user:pw@everloot.app/", "https://everloot.app:8443/", "javascript:alert(1)",
      "JAVASCRIPT:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "//evil.example/", "/\\evil.example/",
      "\\\\evil.example", "ftp://everloot.app/", "https://evil.example\\@everloot.app/", "/database/items/1\"onmouseover=\"x",
      "mailto:a@everloot.app", "", " https://everloot.app/",
    ]) expect(commentHref(bad), bad).toBeNull();
  });
});

describe("parseComment", () => {
  it("reads paragraphs, line breaks, bold, italic, code and spoilers", () => {
    const { blocks, rejected } = parseComment("**Bold** and *soft* and `/cast Fireball`\nnext line\n\n||Ragnaros dies||");
    expect(rejected).toEqual([]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].map((n) => n.kind)).toEqual(["strong", "text", "em", "text", "code", "br", "text"]);
    expect(blocks[1][0]).toMatchObject({ kind: "spoiler" });
    expect(texts(blocks[1])).toBe("Ragnaros dies");
  });

  it("links allowed addresses, bare or in [text](url), and leaves trailing punctuation out of a bare one", () => {
    const { blocks, rejected } = parseComment("See [the item](https://www.wowhead.com/item=1) or https://everloot.app/map.");
    expect(rejected).toEqual([]);
    const links = blocks[0].filter((n) => n.kind === "link");
    expect(links).toEqual([
      { kind: "link", href: "https://www.wowhead.com/item=1", children: [{ kind: "text", text: "the item" }] },
      { kind: "link", href: "https://everloot.app/map", children: [{ kind: "text", text: "https://everloot.app/map" }] },
    ]);
    expect(texts(blocks[0]).endsWith(".")).toBe(true);
  });

  it("never links a refused address and names it, so the server can refuse the comment", () => {
    const { blocks, rejected } = parseComment("[x](javascript:alert(1)) and [y](https://evil.example/) and https://evil.example/z");
    expect(blocks[0].some((n) => n.kind === "link")).toBe(false);
    expect(rejected).toEqual(["javascript:alert(1", "https://evil.example/", "https://evil.example/z"]);
  });

  it("keeps markup characters that close nothing as text", () => {
    const { blocks } = parseComment("2 * 3 ** 4 || not a spoiler and `open");
    expect(blocks[0]).toEqual([{ kind: "text", text: "2 * 3 ** 4 || not a spoiler and `open" }]);
  });

  it("draws no image: ![alt](url) is an exclamation mark and a link", () => {
    const { blocks } = parseComment("![map](https://everloot.app/map.png)");
    expect(blocks[0][0]).toEqual({ kind: "text", text: "!" });
    expect(blocks[0][1]).toMatchObject({ kind: "link" });
  });

  it("does not nest a spoiler in a spoiler or anything inside code", () => {
    const { blocks } = parseComment("`**not bold** ||x||`");
    expect(blocks[0]).toEqual([{ kind: "code", text: "**not bold** ||x||" }]);
  });
});
