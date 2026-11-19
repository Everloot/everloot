import { expect, test } from "vitest";
import config from "../../tailwind.config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { channels, cssVariables, MOTION, motionVariables, RADIUS, SITE_MODE, SPACE, TEXT_TOKENS, tokens, WIDTH } from "./tokens";

// WCAG 2.x relative luminance and contrast ratio.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("the values are the spec's", () => {
  expect([tokens.dark.canvas, tokens.light.canvas]).toEqual(["#0E0F0D", "#FBF8EC"]);
  expect([tokens.dark.accent, tokens.light.accent]).toEqual(["#9CF03A", "#2F7A0A"]);
  expect(tokens.dark["q-rare"]).toBe("#4C9BFF");
  expect(tokens.light["class-rogue"]).toBe("#746500");
  expect(tokens.light["chat-whisper"]).toBe("#A3218F");
  // Blue posts: a text colour in both modes, so the text-token contrast checks below cover it.
  expect([tokens.dark["blue-post"], tokens.light["blue-post"]]).toEqual(["#00B4FF", "#006A99"]);
  expect(TEXT_TOKENS).toContain("blue-post");
  for (const m of ["dark", "light"] as const)
    expect([tokens[m].tooltip, tokens[m]["tooltip-border"], tokens[m]["tooltip-inner"]])
      .toEqual(["#080C18", "#5B6B8C", "#26324F"]);
});

test.each(["dark", "light"] as const)("every text token reaches 4.5:1 on canvas and panel (%s)", (m) => {
  for (const t of TEXT_TOKENS) for (const bg of ["canvas", "panel"] as const)
    expect(contrast(tokens[m][t], tokens[m][bg]), `${t} on ${bg}`).toBeGreaterThanOrEqual(4.5);
});

// The variables Tailwind's plugin actually emits, so the checks below follow the real config.
type Vars = Record<string, string>;
function baseStyles(): Record<string, Vars | Record<string, Vars>> {
  const styles: Record<string, Vars | Record<string, Vars>> = {};
  const plugins = config.plugins as unknown as { handler: (api: { addBase: (s: object) => void }) => void }[];
  for (const p of plugins) p.handler({ addBase: (s) => Object.assign(styles, s) });
  return styles;
}
/** The variables a page gets: the emitted :root for the site's mode, the kept token values for the other. */
function rootVars(m: "dark" | "light"): Vars {
  return m === SITE_MODE ? (baseStyles()[":root"] as Vars) : cssVariables(m);
}
const hex = (rgb: string) => "#" + rgb.split(" ").map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();

test.each(["dark", "light"] as const)("every text token reads inside the tooltip frame (%s)", (m) => {
  // The frame stays dark in both modes, so it re-declares the dark variables for its contents.
  const inside = { ...rootVars(m), ...(baseStyles()[".bg-tooltip"] as Vars) };
  for (const t of TEXT_TOKENS)
    expect(contrast(hex(inside[`--${t}`]), hex(inside["--tooltip"])), t).toBeGreaterThanOrEqual(4.5);
});

test.each(["dark", "light"] as const)("control edges reach 3:1 on canvas and panel (%s)", (m) => {
  const vars = rootVars(m);
  for (const bg of ["canvas", "panel"] as const)
    expect(contrast(hex(vars["--edge"]), hex(vars[`--${bg}`])), `edge on ${bg}`).toBeGreaterThanOrEqual(3);
});

test.each(["dark", "light"] as const)("the primary fill stands out from the canvas at rest and on hover (%s)", (m) => {
  for (const t of ["accent", "accent-hover"] as const)
    expect(contrast(tokens[m][t], tokens[m].canvas), t).toBeGreaterThanOrEqual(3);
});

test("channels", () => expect(channels("#0E0F0D")).toBe("14 15 13"));

test("css variables cover every token in both modes", () => {
  expect(cssVariables("dark")["--canvas"]).toBe("14 15 13");
  expect(Object.keys(cssVariables("light"))).toHaveLength(Object.keys(tokens.light).length);
});

test("the site is dark-only: no system setting switches it to the light values", () => {
  expect(SITE_MODE).toBe("dark");
  const base = baseStyles();
  expect(Object.keys(base).some((k) => k.includes("prefers-color-scheme"))).toBe(false);
  expect(base[":root"]).toEqual({ ...cssVariables("dark"), ...motionVariables() });
  // The light values stay in tokens.ts, complete, for a light theme to come back to.
  expect(Object.keys(tokens.light)).toEqual(Object.keys(tokens.dark));
});

test("one spacing scale, one card radius, three content widths", () => {
  expect(SPACE).toEqual([4, 8, 12, 16, 24, 32, 48, 72]);
  expect(RADIUS).toEqual({ control: 6, card: 12 });
  expect(WIDTH).toEqual({ reading: 768, wide: 1152, data: 1440 });
  const extend = config.theme!.extend!;
  expect(extend.maxWidth).toEqual({ reading: "768px", wide: "1152px", data: "1440px", tip: "320px", prose: "65ch", lede: "75ch" });
  expect(extend.borderRadius).toEqual({ control: "6px", card: "12px" });
  expect(extend.spacing).toEqual({ 18: "4.5rem" });
});

test("the data-page scale is the density spec's", () => {
  const extend = config.theme!.extend!;
  const size = extend.fontSize as Record<string, [string, Record<string, string>]>;
  expect(size.title).toEqual(["28px", { lineHeight: "34px", fontWeight: "700", letterSpacing: "-0.01em" }]);
  expect(size["title-sm"][0]).toBe("22px");
  expect(size.h2).toEqual(["16px", { lineHeight: "24px", fontWeight: "600" }]);
  expect(size.th).toEqual(["12px", { lineHeight: "16px", fontWeight: "600" }]);
  expect([size.cell[0], size.meta[0], size["cell-2"][0], size.control[0], size.tip[0]]).toEqual(["14px", "13px", "12px", "13px", "13px"]);
  expect(extend.height).toMatchObject({ row: "36px", "row-sm": "52px", th: "32px", control: "32px", "control-sm": "40px" });
  // The compact header (account shell spec, 2026-10-20): two thirds of the old 64 px.
  expect(extend.inset).toEqual({ header: "44px" });
});

test("motion is one 150 ms fade, small quick transforms, one default curve, and the waits around it (spec item 12)", () => {
  expect(MOTION.duration).toEqual({ press: 100, exit: 100, fade: 150, panel: 200, sheet: 300, grow: 2000, pendingDelay: 150, copied: 2000 });
  expect(MOTION.ease).toEqual({
    out: "cubic-bezier(0.23, 1, 0.32, 1)",
    inOut: "cubic-bezier(0.77, 0, 0.175, 1)",
    drawer: "cubic-bezier(0.32, 0.72, 0, 1)",
    color: "ease",
  });
  // Exits are faster than entrances; nothing in the interface takes longer than the sheet, except the loading
  // bar's slow growth.
  expect(MOTION.duration.exit).toBeLessThan(MOTION.duration.fade);
  const { press, exit, fade, panel, sheet } = MOTION.duration;
  expect(Math.max(press, exit, fade, panel)).toBeLessThan(sheet);
  const extend = config.theme!.extend!;
  expect(extend.transitionDuration).toEqual({ DEFAULT: "150ms", fade: "150ms" });
  expect(extend.transitionTimingFunction).toEqual({ DEFAULT: "ease", out: MOTION.ease.out });
  expect(baseStyles()[":root"]).toMatchObject({
    "--dur-press": "100ms", "--dur-exit": "100ms", "--dur-fade": "150ms", "--dur-panel": "200ms", "--dur-sheet": "300ms",
    "--dur-grow": "2000ms", "--ease-out": MOTION.ease.out, "--ease-drawer": MOTION.ease.drawer, "--ease-color": "ease",
  });
});

test("the stylesheets take every duration and curve from the motion variables", () => {
  for (const file of ["../app/globals.css", "../components/map/world-map.css"]) {
    const css = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
    const motion = css.match(/^\s*(?:transition|animation):[^;]*;/gm) ?? [];
    expect(motion.length, file).toBeGreaterThan(0);
    for (const rule of motion) expect(rule, file).toMatch(/none|var\(--dur-[a-z]+\)/);
  }
});

test("Tailwind exposes the tokens as variables", () => {
  const colors = config.theme!.extend!.colors as Record<string, unknown>;
  expect(colors.fg).toBe("rgb(var(--fg) / <alpha-value>)");
  expect(Object.keys(colors)).toEqual(expect.arrayContaining(["canvas", "fg-2", "q-legendary", "class-druid", "chat-guild", "tooltip-border"]));
  expect(colors["accent-hover"]).toBe("rgb(var(--accent-hover) / <alpha-value>)");
  expect(colors).not.toHaveProperty("grad-from");
});
