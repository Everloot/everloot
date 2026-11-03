import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// The page's own files, read as text: the CSP line and the font declarations are contracts the build relies on.
const html = readFileSync(new URL("../src/renderer/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

test("the page may load its own fonts and nothing else", () => {
  expect(html).toMatch(/font-src 'self'/);
  expect(html).not.toMatch(/font-src [^;]*https?:/);
});

test("Geist and Geist Mono are declared from the bundled files", () => {
  expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*"Geist"[^}]*url\("fonts\/Geist-Variable\.woff2"\)/);
  expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*"Geist Mono"[^}]*url\("fonts\/GeistMono-Variable\.woff2"\)/);
});
