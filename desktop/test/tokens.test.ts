import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// The stylesheet's colour tokens, read as text: every text colour must keep 4.5:1 on the canvas and on a panel,
// in the dark default and in the light scheme, as the site's tokens do (web/src/design/tokens.test.ts).
const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

type Rgb = [number, number, number];
function tokens(block: string): Record<string, Rgb> {
  const out: Record<string, Rgb> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  return out;
}
const dark = tokens(css.match(/:root\s*\{([^}]*)\}/)![1]);
const light = tokens(css.match(/prefers-color-scheme: light\)\s*\{\s*:root\s*\{([^}]*)\}/)![1]);

const lum = ([r, g, b]: Rgb) => {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: Rgb, b: Rgb) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("the dark surfaces are the neutral near-black of the spec", () => {
  expect(dark.canvas).toEqual([9, 9, 9]);
  expect(dark.panel).toEqual([17, 17, 17]);
  expect(dark.accent).toEqual([156, 240, 58]);
});

test("the light surfaces are neutral too", () => {
  expect(light.canvas).toEqual([250, 250, 250]);
  expect(light.panel).toEqual([255, 255, 255]);
});

for (const [name, t] of [["dark", dark], ["light", light]] as const) {
  test(`${name}: fg, fg-2 and muted keep 4.5:1 on the canvas and on a panel`, () => {
    for (const text of ["fg", "fg-2", "muted"]) {
      for (const surface of ["canvas", "panel"]) expect(contrast(t[text], t[surface]), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(t["accent-ink"], t.accent), "accent-ink on accent").toBeGreaterThanOrEqual(4.5);
  });
}

test("rules and edges are drawn with the alpha tokens, not the old opaque triplets", () => {
  expect(css).not.toMatch(/rgb\(var\(--line\)\)/);
  expect(css).not.toMatch(/rgb\(var\(--edge\)\)/);
  expect(css).toMatch(/--line:\s*rgb\(255 255 255 \/ 0\.08\)/);
  expect(css).toMatch(/--line:\s*rgb\(0 0 0 \/ 0\.08\)/);
});
