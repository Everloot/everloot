import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CommentBody from "./CommentBody";

const html = (body: string) => renderToStaticMarkup(<CommentBody body={body} />);

describe("CommentBody", () => {
  it("draws the markup as elements and nothing else", () => {
    const out = html("**Bold** *soft* `code`\nnext\n\nSee [Ragnaros](https://www.wowhead.com/npc=11502)");
    expect(out).toContain("<strong>Bold</strong>");
    expect(out).toContain("<em>soft</em>");
    expect(out).toContain("<code");
    expect(out).toContain("<br/>");
    expect(out).toContain('href="https://www.wowhead.com/npc=11502"');
    expect(out).toContain('rel="ugc nofollow noopener noreferrer"');
    expect(out.match(/<p/g)).toHaveLength(2);
  });

  it("keeps a spoiler's words out of the page until it is opened", () => {
    const out = html("The end: ||Ragnaros dies||");
    expect(out).not.toContain("Ragnaros dies");
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain("Show spoiler");
  });

  it("escapes hostile input: no element, attribute or script the comment did not earn", () => {
    const hostile = [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "**<svg onload=alert(1)>**",
      "[click](javascript:alert(1))",
      "[click](JaVaScRiPt:alert(1))",
      "[x](data:text/html;base64,PHNjcmlwdD4=)",
      "[x](https://everloot.app.evil.example/)",
      "[x](https://everloot.app@evil.example/)",
      "[x](//evil.example)",
      "[a\" onmouseover=\"alert(1)](https://everloot.app/)",
      "[x](/database\" onmouseover=\"alert(1))",
      "https://evil.example/<script>",
      "||<iframe src=https://evil.example>||",
      "`</code><script>alert(1)</script>`",
      "![img](https://everloot.app/x.png)",
      "&lt;script&gt; &#x3C;script&#x3E;",
    ];
    for (const body of hostile) {
      const out = html(body);
      // React escapes text, so every "<" left in the markup opens a real element; the checks read those alone.
      const tags = (out.match(/<[^>]*>/g) ?? []).join(" ");
      expect(tags, body).not.toMatch(/<(script|img|svg|iframe|object|embed|style|form|input)\b/i);
      expect(tags, body).not.toMatch(/\son[a-z]+=/i);
      expect(tags, body).not.toMatch(/href="(?!https:\/\/(www\.)?(everloot\.app|wowhead\.com)\/|\/)/);
      expect(tags, body).not.toMatch(/javascript:|data:|evil\.example/i);
      expect(out, body).not.toContain("<script");
    }
  });

  it("shows the raw words of a refused link as text", () => {
    const out = html("[x](https://evil.example/)");
    expect(out).toContain("[x](https://evil.example/)");
    expect(out).not.toContain("<a");
  });
});
