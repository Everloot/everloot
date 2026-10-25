// Keeps the old look from coming back: each rule scans every non-test .ts, .tsx and .css file
// under web/src, line by line. Exceptions: the banner's scrim (components/ui/Banner.tsx), the fade that
// lets section-hub art blend into the page (Carlos, 10/19), and the mascot (components/glint/), whose loops
// and movement are its own. The primary button is a flat fill, not a gradient.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import config from "../../tailwind.config";

type Rule = { name: string; pattern: RegExp; bites: string[]; spares: string[]; allow?: string[] };

// A class token starts the line or follows whitespace or a quote, may carry variants
// (`hover:`, `sm:`, `!`), and ends at whitespace, a quote or the end of the line.
const START = String.raw`(?:^|[\s"'\x60])(?:[a-z0-9-]+:)*!?`;
const END = String.raw`(?=[\s"'\x60]|$)`;
const REST = String.raw`[^\s"'\x60]+`;
const token = (body: string) => new RegExp(`${START}(?:${body})${END}`);
const tokenOr = (body: string, extra: string) => new RegExp(`${START}(?:${body})${END}|${extra}`);

// Arrows, keyboard keys, © ® ™ and plain shapes (sort arrows, bullets) stay allowed.
const ALLOWED_SYMBOLS = "\\u00A9\\u00AE\\u2122\\u2190-\\u21FF\\u2318\\u2325\\u2303\\u25A0\\u25A1\\u25B2\\u25B3\\u25BC\\u25BD\\u25CB\\u25CF";

const RULES: Rule[] = [
  {
    name: "old palette",
    pattern: /\b(?:text|bg|border|divide|ring|from|via|to|accent|outline|fill|stroke|placeholder|decoration|caret|shadow)-(?:gold|parchment|arcane)\b/,
    bites: ["hover:text-gold-400", "shadow-gold-500/50"],
    spares: ['href="/tools/gold-ledger"'],
  },
  {
    name: "default palette",
    pattern: /\b(?:text|bg|border|ring|divide|from|via|to|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b|\b(?:text|bg|border)-(?:white|black)\b/,
    bites: ["text-red-400", "shadow-amber-500/40"],
    spares: ["text-danger"],
  },
  {
    name: "fantasy type",
    pattern: /\bfont-display\b|Cinzel/,
    bites: ["font-display"],
    spares: ["font-mono"],
  },
  {
    // Emoji and pictographs (Extended_Pictographic covers emoji, including the ⌛ ⏳ ⌚ range),
    // the dingbat and symbol blocks (sparkles, check marks, stars) and the old ◆ separator.
    name: "pictographs",
    pattern: new RegExp(
      `(?![${ALLOWED_SYMBOLS}])[\\p{Extended_Pictographic}\\p{Emoji_Presentation}\\u{2300}-\\u{23FF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{25C6}-\\u{25C8}\\u{FE0F}]`,
      "u",
    ),
    bites: ["✦", "◆", "✓", "🪙", "⌛", "⏳", "⚡", "★", "▶", "⭐", "❤️"],
    spares: ["—", "·", "→", "↗", "×", "▲", "▼", "●", "©", "⌘K"],
  },
  {
    name: "glow, shadow and blur",
    pattern: tokenOr(
      String.raw`shadow(?!-none(?:[\s"'\x60]|$))(?:-${REST})?|(?:backdrop-)?blur(?:-${REST})?|drop-shadow(?:-${REST})?`,
      String.raw`box-shadow|text-shadow|drop-shadow|blur\(`,
    ),
    bites: ["shadow-xl", "shadow", "hover:shadow-lg", 'className="shadow-[0_0_20px_#fff]"', "shadow-accent/40", "blur-md", "backdrop-blur", "drop-shadow-lg", "filter: blur(4px)", "box-shadow: 0 0 4px"],
    spares: ["Shadowfang", "Shadow Priest", "shadow-none", "blurb"],
  },
  {
    name: "gradients",
    pattern: tokenOr(String.raw`bg-(?:gradient|linear|radial|conic)-${REST}|from-${REST}|via-${REST}`, String.raw`gradient\(`),
    bites: ["bg-gradient-to-r from-accent to-q-uncommon", "bg-linear-to-r", "hover:from-accent", "via-q-epic", "radial-gradient(", "linear-gradient(90deg"],
    spares: ["data from the wiki", "bg-panel", "to-do"],
    allow: ["components/ui/Banner.tsx"],
  },
  {
    // Letter-spaced capitals. Negative tracking (tracking-tight, tracking-[-0.035em]) is allowed.
    name: "capital labels",
    pattern: tokenOr(
      String.raw`uppercase|tracking-(?:wide|wider|widest|\[(?!-)[^\]]*\])`,
      String.raw`textTransform:\s*["']uppercase|text-transform:\s*uppercase|letterSpacing:\s*["']?(?:[1-9]|0?\.\d*[1-9])|letter-spacing:\s*(?:[1-9]|0?\.\d*[1-9])`,
    ),
    bites: ["uppercase tracking-[0.2em]", "tracking-[2px]", "sm:tracking-widest", "letterSpacing: 6", 'letterSpacing: "0.1em"', "letterSpacing: 0.5", "letter-spacing: 0.05em", 'textTransform: "uppercase"'],
    spares: ["tracking-tight", "tracking-tighter", "tracking-[-0.035em]", "letterSpacing: -4", "letterSpacing: 0", "toUpperCase()"],
  },
  {
    name: "old effects",
    pattern: /\b(?:ticker-track|aurora|cta-glow|marquee)\b/,
    bites: ["ticker-track"],
    spares: ["price ticker"],
  },
  {
    // Motion answers the visitor (spec item 12); nothing loops for decoration. Two exceptions: the chat cursor's
    // blink, and the mascot, which keeps its loops inside its own component.
    name: "decorative loops",
    pattern: tokenOr(
      String.raw`animate-(?:pulse|ping|bounce|spin)`,
      String.raw`^(?!.*caret-blink).*\banimation(?:-iteration-count)?:[^;]*\binfinite\b|iterations:\s*Infinity`,
    ),
    bites: ["animate-pulse", "motion-safe:animate-ping", "animate-bounce", "animate-spin", "animation: glow var(--dur-fade) infinite;", "animation-iteration-count: infinite;", "{ iterations: Infinity }"],
    spares: ["animate-none", "animation: caret-blink var(--dur-blink) steps(1, end) infinite;", "animation: pop-in var(--dur-fade) var(--ease-out);", "Infinity"],
    allow: ["components/glint/"],
  },
  {
    // Small transforms only (spec item 12): a press scales between 0.98 and 1, and a fixed offset moves 8 px at
    // most. A sheet slides by a percentage of itself and a FLIP move by a measured distance, so neither is a literal.
    // The world map's pins grow 1.5x while hovered or selected: a marker's state on the map, not a press.
    name: "transforms beyond item 12",
    pattern: tokenOr(
      String.raw`scale-(?!100(?:[\s"'\x60]|$))\d+|scale-\[(?!(?:0?\.9[89]\d*|1)\])[^\]]*\]`,
      String.raw`\bscale\((?!\s*(?:1|0?\.9[89]\d*)\s*\))|translate(?:[XY]|3d)?\((?:[^)]*?[\s(,])?-?(?:9|[1-9]\d+)(?:\.\d+)?px`,
    ),
    bites: ["scale-95", "hover:scale-105", "active:scale-[0.96]", "transform: scale(0.97);", "transform: scale(1.05);", "scale(0)", "transform: translateY(-12px);", "translate(0, 16px)", "translateX(9px)"],
    spares: ["scale-100", "active:scale-[0.98]", "transform: scale(0.98);", "transform: scaleX(0.1);", "transform: translateY(-4px);", "transform: translateY(100%);", "translate(${dx}px, ${dy}px)", "translate(${x + 12}px, ${y + 12}px)", "-translate-x-1/2", "translateY(8px)"],
    allow: ["components/glint/", "components/map/world-map.css"],
  },
  {
    // Durations and curves come from MOTION in design/tokens.ts: `duration-fade`, `ease-out`, the default curve,
    // and var(--dur-fade) / var(--ease-out) / var(--ease-color) in CSS. Nothing types its own.
    name: "motion outside the tokens",
    pattern: tokenOr(
      String.raw`duration-(?:\d+|\[[^\]]*\])|ease-(?:linear|in|in-out|\[[^\]]*\])|delay-${REST}`,
      String.raw`cubic-bezier\(|(?:transition|animation)(?:-duration|-delay)?:[^;]*\d+m?s\b`,
    ),
    bites: ["duration-200", "hover:duration-[250ms]", "ease-in-out", "ease-[cubic-bezier(0.4,0,0.2,1)]", "delay-75", "transition: transform 150ms;", "animation: fade-in 0.2s ease;", "transition-duration: 200ms;", "cubic-bezier(0.4, 0, 0.2, 1)"],
    spares: ["duration-fade", "ease-out", "transition: opacity var(--dur-fade) var(--ease-out);", "transition: none !important;", "animation: none !important;"],
    allow: ["design/tokens.ts"],
  },
  {
    // Only colour, opacity and the transforms already there animate: never a layout property (width, height,
    // position, spacing), and never the broad `transition` utility or `all`, which animate whatever changes.
    name: "broad or layout transitions",
    pattern: tokenOr(
      String.raw`transition|transition-all|transition-\[${REST}`,
      String.raw`transition(?:-property)?:\s*(?:all\b|[^;]*\b(?:width|height|top|left|right|bottom|inset|margin|padding)\b)`,
    ),
    bites: ["transition", "hover:text-accent transition", "transition-all", "transition-[width]", "transition: all 150ms", "transition: width var(--dur-fade)", "transition-property: height;"],
    spares: ["transition-colors", "transition-opacity", "transition-transform", "transition-none", "transition: border-color var(--dur-fade) var(--ease-color);"],
  },
  {
    name: "text opacity",
    pattern: token(String.raw`text-(?:fg|fg-2|muted|accent|danger|warning|q-[a-z]+|class-[a-z]+|chat-[a-z]+)\/(?:\d+|\[[^\]]*\])`),
    bites: ["text-muted/60", "text-fg/[.85]", "hover:text-accent/[0.5]"],
    spares: ["text-muted", "bg-canvas/60"],
  },
  {
    // The accent is a lime close to the uncommon item green (#1EFF00), so a lime link reads as an uncommon
    // item name. Links are `text-fg` with an underline; the accent stays on fills, focus rings and counts.
    name: "accent text link",
    pattern: new RegExp(`^(?=.*${START}underline${END}).*(?:^|[\\s"'\\x60])text-accent${END}`),
    bites: ['className="text-accent hover:underline underline-offset-4"', "text-accent underline", 'className="underline text-accent"'],
    spares: ["text-fg underline decoration-edge underline-offset-4 hover:decoration-fg", 'className="text-accent font-semibold"', "underline hover:text-accent"],
  },
  {
    // Opacity that dims content; disabled states and fully shown or hidden are fine.
    name: "dimmed with opacity",
    pattern: new RegExp(`(?:^|[\\s"'\\x60])(?!(?:[a-z0-9-]+:)*(?:aria-|group-|peer-)?disabled:)(?:[a-z0-9-]+:)*!?opacity-(?:[1-9]\\d?|\\[[^\\]]*\\])${END}`),
    bites: ["opacity-60", "hover:opacity-80", "opacity-[.7]", "md:opacity-50"],
    spares: ["disabled:opacity-50", "aria-disabled:opacity-40", "group-disabled:opacity-60", "opacity-0", "opacity-100", "bg-canvas/60"],
  },
];

const src = fileURLToPath(new URL("..", import.meta.url));

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.(?:tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) yield path;
  }
}

const files = [...sourceFiles(src)].map((path) => ({ name: relative(src, path).replaceAll("\\", "/"), lines: readFileSync(path, "utf8").split(/\r?\n/) }));

/** An allow entry is a file, or a folder when it ends in "/". */
const allowed = (rule: Rule, name: string) => rule.allow?.some((a) => (a.endsWith("/") ? name.startsWith(a) : name === a)) ?? false;

function offenders(rule: Rule): string[] {
  return files.filter(({ name }) => !allowed(rule, name)).flatMap(({ name, lines }) =>
    lines.flatMap((line, i) => (rule.pattern.test(line) ? [`src/${name}:${i + 1}`] : [])));
}

describe.each(RULES)("$name", (rule) => {
  test("the rule bites what it should and spares the rest", () => {
    for (const s of rule.bites) expect(rule.pattern.test(s), s).toBe(true);
    for (const s of rule.spares) expect(rule.pattern.test(s), s).toBe(false);
  });

  test("web/src has none", () => {
    expect(offenders(rule)).toEqual([]);
  });
});

test("the scan sees the source", () => {
  expect(files.some(({ name }) => name === "app/globals.css")).toBe(true);
  expect(files.length).toBeGreaterThan(40);
});

test("no gradient at all, the primary button included (it is a flat fill)", () => {
  const css = readFileSync(join(src, "app/globals.css"), "utf8");
  const gradients = RULES.find((r) => r.name === "gradients")!.pattern;
  expect(css.split(/\r?\n/).some((line) => gradients.test(line))).toBe(false);
});

test("only Geist families", () => {
  expect(Object.keys(config.theme!.extend!.fontFamily!)).toEqual(["sans", "mono"]);
});
