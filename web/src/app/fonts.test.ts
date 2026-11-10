import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// The swap from the system face to Geist moves no text only while the fallback faces in globals.css match the
// families fonts.ts puts first in each stack, for every weight the site sets.
const fonts = readFileSync(join(__dirname, "fonts.ts"), "utf8");
const css = readFileSync(join(__dirname, "globals.css"), "utf8");

const faces = (family: string) =>
  [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)]
    .map((m) => m[1])
    .filter((body) => body.includes(`font-family: "${family}"`));
const weights = (body: string) => body.match(/font-weight:\s*([\d ]+);/)![1].trim();

describe.each([
  { family: "GeistSansFallback", used: [400, 500, 600, 700] },
  { family: "GeistMonoFallback", used: [400, 500, 600, 700] },
])("$family", ({ family, used }) => {
  const own = faces(family);

  test("fonts.ts names it in the stack", () => {
    expect(fonts).toContain(`"${family}"`);
  });

  test("every face sets size-adjust and the three metric overrides", () => {
    expect(own.length).toBeGreaterThan(0);
    for (const body of own) {
      expect(body).toMatch(/size-adjust:\s*[\d.]+%/);
      expect(body).toMatch(/ascent-override:\s*[\d.]+%/);
      expect(body).toMatch(/descent-override:\s*[\d.]+%/);
      expect(body).toMatch(/line-gap-override:\s*0%/);
      expect(body).toContain("local(");
    }
  });

  test.each(used)("covers weight %i", (weight) => {
    const covered = own.some((body) => {
      const [lo, hi = lo] = weights(body).split(" ").map(Number);
      return weight >= lo && weight <= hi;
    });
    expect(covered).toBe(true);
  });
});

test("both families stay swap, on the same variable files", () => {
  expect(fonts).toContain("Geist-Variable.woff2");
  expect(fonts).toContain("GeistMono-Variable.woff2");
  expect(fonts).not.toMatch(/display:\s*["']block["']/);
});
