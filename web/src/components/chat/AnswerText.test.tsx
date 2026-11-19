import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { blocks, inline, leadSentence } from "@/lib/chat/markdown";
import AnswerText from "./AnswerText";

const html = (text: string, summary = false) => renderToStaticMarkup(<AnswerText text={text} summary={summary} />);

describe("the answer's Markdown", () => {
  test("reads paragraphs, lists, fenced code and pipe tables", () => {
    expect(blocks("One.\nTwo.\n\n- a\n- b\n\n1. x\n2) y\n\n```lua\nprint(1)\n```\n\n| Item | Rate |\n|---|---:|\n| Linen | 25% |")).toEqual([
      { kind: "p", lines: ["One.", "Two."] },
      { kind: "ul", items: ["a", "b"] },
      { kind: "ol", items: ["x", "y"] },
      { kind: "code", lang: "lua", text: "print(1)" },
      { kind: "table", head: ["Item", "Rate"], rows: [["Linen", "25%"]] },
    ]);
  });

  test("an unclosed fence, as a streaming answer has midway, runs to the end", () => {
    expect(blocks("```\nline 1\nline 2")).toEqual([{ kind: "code", lang: "", text: "line 1\nline 2" }]);
  });

  test("keeps code, bold, safe links and bare links; a sentence's full stop is not part of a link", () => {
    expect(inline("Use `/who` and **this**, see [the page](/database/items/2589) or https://everloot.app/database/item/2589.")).toEqual([
      { kind: "text", text: "Use " }, { kind: "code", text: "/who" }, { kind: "text", text: " and " }, { kind: "strong", text: "this" },
      { kind: "text", text: ", see " }, { kind: "link", text: "the page", href: "/database/items/2589" }, { kind: "text", text: " or " },
      { kind: "url", href: "https://everloot.app/database/item/2589" }, { kind: "text", text: "." },
    ]);
  });

  test("a link to anything but https or this site stays as text", () => {
    expect(inline("[x](javascript:alert(1)) [y](http://a.b)").every((p) => p.kind === "text")).toBe(true);
    expect(html("[x](javascript:alert(1))")).not.toContain("<a");
  });

  test("the first sentence splits off as the summary only when more follows", () => {
    expect(leadSentence("Humanoids drop Linen Cloth. Defias Thugs drop it most often.")).toEqual({ lead: "Humanoids drop Linen Cloth.", rest: "Defias Thugs drop it most often." });
    expect(leadSentence("Humanoids drop Linen Cloth.")).toBeNull();
    expect(leadSentence("Use 1.5 stacks for it.")).toBeNull();
  });
});

describe("AnswerText", () => {
  test("draws a table with header cells inside a box that scrolls on its own", () => {
    const out = html("| Item | Rate |\n|---|---|\n| Linen | 25% |");
    expect(out).toMatch(/<div class="overflow-x-auto[^"]*"><table/);
    expect(out).toContain('<th scope="col"');
    expect(out).toContain("<td");
  });

  test("draws code blocks as preformatted text that scrolls sideways", () => {
    expect(html("```\n/run print(1)\n```")).toMatch(/<pre[^>]*overflow-x-auto[^>]*><code>\/run print\(1\)<\/code><\/pre>/);
  });

  test("reads at 16 px with a 1.6 line height", () => {
    expect(html("Hi.")).toMatch(/data-answer[^>]*class="[^"]*text-base leading-\[1\.6\]/);
  });

  test("links written next to a claim become source chips: Everloot pages by kind, cited pages in a new tab", () => {
    const out = html("Humanoids drop it (https://everloot.app/database/item/2589). The wiki agrees: https://warcraft.wiki.gg/wiki/Linen_Cloth");
    expect(out).toContain('href="/database/item/2589"');
    expect(out).toMatch(/data-source-chip[^>]*>.*Item<\/span><span[^>]*>\/database\/item\/2589</);
    expect(out).toMatch(/href="https:\/\/warcraft\.wiki\.gg\/wiki\/Linen_Cloth" target="_blank" rel="noopener noreferrer"[^>]*data-source-chip/);
    expect(out).toContain("warcraft.wiki.gg/wiki/Linen_Cloth");
  });

  test("with summary on, the first sentence stands on its own line", () => {
    const out = html("Humanoids drop Linen Cloth. Defias Thugs drop it most often.", true);
    expect(out).toContain('<p data-summary="true" class="font-medium">Humanoids drop Linen Cloth.</p>');
    expect(out).toContain("Defias Thugs drop it most often.");
    expect(html("Humanoids drop Linen Cloth.", true)).not.toContain("data-summary");
    expect(html("Two sources:\n\n- a\n- b", true)).toContain('data-summary="true" class="font-medium">Two sources:</p>');
  });

  test("answer text never becomes markup", () => {
    expect(html("<img src=x onerror=alert(1)>")).not.toContain("<img");
  });
});
