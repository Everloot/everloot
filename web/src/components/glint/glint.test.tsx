// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import { MOTION, tokens } from "@/design/tokens";
import { LAUNCH_AT } from "@/data/wow-forever";
import Glint from "./Glint";
import GlintHero from "./GlintHero";
import { FOOTER_LINES, heroLines, lineText } from "./lines";

const at = Date.parse(LAUNCH_AT);
const H = 3_600_000;

describe("the drawing", () => {
  test("decorative by default: hidden from screen readers, never focusable", () => {
    const svg = renderToStaticMarkup(<Glint />);
    expect(svg).toMatch(/^<svg[^>]*aria-hidden="true"/);
    expect(svg).toContain('focusable="false"');
    expect(svg).not.toContain("role=");
  });

  test("labelled when it carries meaning", () => {
    const svg = renderToStaticMarkup(<Glint label="Glint, the loot raven" />);
    expect(svg).toMatch(/^<svg[^>]*role="img"[^>]*aria-label="Glint, the loot raven"/);
    expect(svg).not.toContain("aria-hidden");
  });

  test("every part is its own group, so it can move on its own", () => {
    const svg = renderToStaticMarkup(<Glint />);
    for (const part of ["feet", "body", "wing", "satchel", "gem", "head", "beak", "eye"]) expect(svg, part).toContain(`data-part="${part}"`);
    for (const cls of ["glint-bob", "glint-head", "glint-wing-l", "glint-wing-r", "glint-lid", "glint-sparkle"]) expect(svg, cls).toContain(cls);
  });

  test("the gem is Everloot green unless a quality is asked for; sad Glint's satchel is empty", () => {
    expect(renderToStaticMarkup(<Glint />)).toContain(`fill="${tokens.dark.accent}"`);
    expect(renderToStaticMarkup(<Glint gem="epic" />)).toContain(`fill="${tokens.dark["q-epic"]}"`);
    const sad = renderToStaticMarkup(<Glint pose="sad" />);
    expect(sad).toContain('data-pose="sad"');
    expect(sad).not.toContain('data-part="gem"');
  });

  test("each Glint on a page has its own sticker filter", () => {
    const two = renderToStaticMarkup(<><Glint /><Glint /></>);
    const ids = [...two.matchAll(/<filter id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("glint.css", () => {
  // jsdom gives import.meta.url an http scheme, so the path starts at web/, where vitest runs.
  const css = readFileSync(join(process.cwd(), "src/components/glint/glint.css"), "utf8");

  test("holds still under prefers-reduced-motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.glint \*,\s*\.glint-line\s*\{\s*animation: none !important;\s*transition: none !important;/);
  });

  test("takes every duration and curve from the motion variables, and moves only transforms", () => {
    const rules = css.match(/^\s*animation:[^;]*;/gm) ?? [];
    expect(rules.length).toBeGreaterThan(4);
    for (const rule of rules) expect(rule).toMatch(/none|var\(--dur-glint-[a-z]+\) var\(--ease-(?:glint|out)\)/);
    const keyframeProps = [...css.matchAll(/@keyframes[^{]+\{([\s\S]*?\n)\}/g)].flatMap((m) => [...m[1].matchAll(/^\s*([a-z-]+):/gm)].map((p) => p[1]));
    expect(new Set(keyframeProps)).toEqual(new Set(["transform"]));
  });

  test("pauses the loops when Glint is off-screen or the tab is hidden", () => {
    expect(css).toMatch(/\.glint\[data-paused\] \*\s*\{\s*animation-play-state: paused;/);
  });
});

describe("the lines", () => {
  test("before launch the first line counts down, by days and then by hours", () => {
    expect(lineText(heroLines(at - (17 * 24 + 16) * H)[0])).toBe("17 days, 16 hours until Forever. My satchel's ready!");
    expect(lineText(heroLines(at - 5 * H - 60_000)[0])).toBe("5 hours, 1 minute until Forever. My satchel's ready!");
    expect(heroLines(at - H).map((l) => l.id)).toEqual(["countdown", "drops", "addon"]);
  });

  test("without a clock (the server) before launch the first line names the date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at - H);
    try {
      expect(lineText(heroLines(null)[0])).toBe("Forever launches November 4, 2026, 3:00 p.m. PST. My satchel's ready!");
    } finally {
      vi.useRealTimers();
    }
  });

  test("without a clock (the server) after launch the lines are the live ones, never the countdown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at + 3 * 24 * H);
    try {
      const lines = heroLines(null);
      expect(lines.map((l) => l.id)).not.toContain("countdown");
      expect(lineText(lines[0])).toBe("Forever is live. Show me what you looted!");
      expect(lines.map(lineText).join(" ")).not.toMatch(/launches|until Forever/);
    } finally {
      vi.useRealTimers();
    }
  });

  test("from launch on, the lines are about looting Forever", () => {
    for (const now of [at, at + 30 * 24 * H]) {
      const lines = heroLines(now);
      expect(lines.map((l) => l.id)).not.toContain("countdown");
      expect(lineText(lines[0])).toBe("Forever is live. Show me what you looted!");
    }
  });

  test("the footer starts with Loot get!", () => {
    expect(lineText(FOOTER_LINES[0])).toBe("Loot get!");
  });
});

describe("Glint on the home hero", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(at - (10 * 24 + 3) * H);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const shown = () => [...container.querySelectorAll("[data-glint-lines] > span:not([aria-hidden])")].map((s) => s.textContent);
  const live = () => container.querySelector('[aria-live="polite"]')!.textContent;
  const wait = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });

  test("the server render names the date inside a link to /wow-forever, in a <time>", () => {
    const html = renderToStaticMarkup(<GlintHero />);
    expect(html).toMatch(/Forever launches <a href="\/wow-forever"[^>]*><time dateTime="2026-11-04T23:00:00Z">November 4, 2026, 3:00 p\.m\. PST<\/time><\/a>/);
  });

  test("every line sits in one grid cell, so the bubble never changes height", async () => {
    await act(async () => root.render(<GlintHero />));
    const lines = container.querySelectorAll("[data-glint-lines] > span");
    expect(lines.length).toBe(4);
    for (const line of lines) expect(line.className).toContain("[grid-area:1/1]");
    expect(shown()).toEqual(["10 days, 3 hours until Forever. My satchel's ready!"]);
  });

  test("lines take turns every MOTION.glint.duration.line, quietly", async () => {
    await act(async () => root.render(<GlintHero />));
    await wait(MOTION.glint.duration.line);
    expect(shown()).toEqual(["Haven't seen a single drop yet. Help me find them?"]);
    await wait(MOTION.glint.duration.line);
    expect(shown()).toEqual(["Install the addon and every drop you see lands here."]);
    await wait(MOTION.glint.duration.line);
    expect(shown()[0]).toMatch(/until Forever/);
    // The turns are not announced.
    expect(live()).toBe("");
  });

  test("the turns wait while keyboard focus is on Glint", async () => {
    await act(async () => root.render(<GlintHero />));
    await act(async () => container.querySelector("button")!.focus());
    await wait(MOTION.glint.duration.line * 2);
    expect(shown()[0]).toMatch(/until Forever/);
  });

  test("a click moves to the next line and announces it", async () => {
    await act(async () => root.render(<GlintHero />));
    await act(async () => container.querySelector("button")!.click());
    expect(shown()).toEqual(["Haven't seen a single drop yet. Help me find them?"]);
    expect(live()).toBe("Haven't seen a single drop yet. Help me find them?");
  });

  test("after launch the bubble carries the post-launch lines", async () => {
    vi.setSystemTime(at + H);
    await act(async () => root.render(<GlintHero />));
    expect(shown()).toEqual(["Forever is live. Show me what you looted!"]);
  });

  test("unmounting clears every timer: the turns, the clock and the blinks", async () => {
    await act(async () => root.render(<GlintHero />));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await act(async () => root.render(<p>gone</p>));
    expect(vi.getTimerCount()).toBe(0);
  });
});
