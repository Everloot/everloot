import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { tokens } from "./tokens";

const src = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(join(src, "app/globals.css"), "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match, selector).not.toBeNull();
  return match![1];
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) yield path;
  }
}

test(".btn is an outline pill", () => {
  const btn = rule(".btn");
  expect(btn).toContain("border-radius: 9999px");
  expect(btn).toContain("border: 1px solid rgb(var(--fg))");
  expect(btn).toContain("background: transparent");
});

test(".btn-primary is the same pill filled fel green, with canvas-coloured text", () => {
  const primary = rule(".btn-primary");
  expect(primary).toContain("background: rgb(var(--accent))");
  expect(primary).toContain("color: rgb(var(--canvas))");
  expect(primary).not.toContain("border-radius");
});

test(".btn-primary keeps a real border that forced-colours mode can paint", () => {
  expect(rule(".btn-primary")).toContain("border: 1px solid rgb(var(--accent))");
});

test("on hover and focus the primary's fill moves to the lighter accent", () => {
  // The selector list is ".btn-primary:hover,\n.btn-primary:focus-visible"; its last line opens the block.
  expect(rule(".btn-primary:focus-visible")).toContain("background: rgb(var(--accent-hover))");
  expect(css).toMatch(/\.btn-primary:hover,\s*\.btn-primary:focus-visible\s*\{/);
});

test("the primary fill's text reads at 4.5:1 or better, at rest and on hover", () => {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  for (const mode of ["dark", "light"] as const)
    for (const fill of ["accent", "accent-hover"] as const)
      expect(ratio(tokens[mode].canvas, tokens[mode][fill]), `${mode} ${fill}`).toBeGreaterThanOrEqual(4.5);
});

test("no gradient ring is left on the primary", () => {
  expect(css).not.toContain(".btn-primary::before");
  expect(css).not.toContain("--grad-");
});

test("in forced colours the primary pill has a thicker edge than the outline pill", () => {
  const block = /@media \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  expect(block).toMatch(/\.btn-primary\s*\{[^}]*border-width:\s*3px/);
});

test("the focus ring follows each element's own corners", () => {
  expect(rule(":focus-visible")).not.toContain("border-radius");
});

const PRIMARY = [
  "app/tools/collections/page.tsx",
  "app/tools/gold-ledger/page.tsx",
  "app/tools/guild-board/page.tsx",
  "app/tools/professions/[profession]/page.tsx",
  "app/upload/UploadClient.tsx",
  "app/not-found-parts.tsx",
  "app/page.tsx",
  "components/BrowseFilters.tsx",
  "components/CookieConsent.tsx",
  "components/EmailCapture.tsx",
  "components/IdLookup.tsx",
  "components/LoreSearchForm.tsx",
];

test.each(PRIMARY)("%s uses the primary pill", (file) => {
  expect(readFileSync(join(src, file), "utf8")).toContain("btn btn-primary");
});

test("no filled gold buttons remain", () => {
  const offenders = [...sourceFiles(src)].filter((path) => /bg-gold-|text-parchment-950/.test(readFileSync(path, "utf8")));
  expect(offenders).toEqual([]);
});

test("links in running text are underlined at rest, so colour is not their only cue", () => {
  const prose = rule("main p a, main .list-disc a");
  expect(prose).toContain("text-decoration-line: underline");
  expect(prose).toContain("text-underline-offset: 4px");
});

test("a disabled primary button is plainly disabled, not a dimmer green", () => {
  const off = rule('.btn-primary[aria-disabled="true"]');
  expect(off).toContain("background: rgb(var(--panel))");
  expect(off).toContain("color: rgb(var(--muted))");
  expect(off).toContain("opacity: 1");
});