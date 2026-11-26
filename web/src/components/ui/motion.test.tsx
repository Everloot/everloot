import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MOTION } from "@/design/tokens";
import { AvatarMenu, CreateMenu } from "../AccountMenu";
import FilterBar from "./FilterBar";

// The motion in globals.css against the visual identity spec, item 12 (amended 2026-10-20): fades and small
// purposeful transforms from the MOTION tokens, exits faster than entrances, transform and opacity only, and
// nothing moving under prefers-reduced-motion.

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const mapCss = readFileSync(new URL("../map/world-map.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const html = renderToStaticMarkup(
  <FilterBar
    label="Item filters"
    active={0}
    clearHref="/database/items"
    controls={[{ type: "menu", key: "quality", label: "Quality", options: [{ label: "Epic", href: "/database/items?quality=epic", on: false }] }]}
  />,
);

/** Where the block opened by `header` starts and ends (braces matched, so nested blocks come with it). */
function span(source: string, header: string, from = 0): [number, number, number] {
  const start = source.indexOf(header, from);
  expect(start, header).toBeGreaterThan(-1);
  const open = source.indexOf("{", start + header.length - 1);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return [start, open, i];
  }
  throw new Error(`unclosed ${header}`);
}
/** The inside of the block opened by `header`. */
const block = (source: string, header: string) => { const [, open, end] = span(source, header); return source.slice(open + 1, end); };
/** `source` without any block opened by `header`. */
function without(source: string, header: string): string {
  while (source.includes(header)) { const [start, , end] = span(source, header); source = source.slice(0, start) + source.slice(end + 1); }
  return source;
}
/** The declarations of the rule for exactly `selector` in `source`. */
function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[\\n}])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  expect(match, selector).not.toBeNull();
  return match![1].replace(/\s+/g, " ").trim();
}

const motionOk = block(css, "@media (prefers-reduced-motion: no-preference)");
const phone = block(css, "@media (max-width: 639.98px)");

test("filter menus and the phone filter sheet carry the menu entrance (.pop)", () => {
  expect(html).toMatch(/<ul class="pop /);
  expect(html).toMatch(/<div id="[^"]+" data-filter-sheet-panel="true" class="pop /);
});

test("each chevron points up while its own menu is open, with no animation", () => {
  const chevrons = html.match(/<svg[^>]*class="[^"]*"/g) ?? [];
  expect(chevrons.length).toBeGreaterThan(0);
  for (const svg of chevrons) {
    // A dropdown's follows its <details>; the phone sheet's follows the sheet's checkbox.
    expect(svg).toMatch(/\[\[open\]&gt;summary&gt;&amp;\]:rotate-180|\[:checked\+label&gt;&amp;\]:rotate-180/);
    expect(svg).not.toContain("transition");
  }
});

test("the + menu and the account menu stay in the page while closed (hidden), so they leave by transition; the account menu is the phone sheet", () => {
  const create = renderToStaticMarkup(<CreateMenu savedBuilds={false} />);
  const avatar = renderToStaticMarkup(<AvatarMenu name="Thrall" savedBuilds={false} accountSwitching={false} signingOut={false} onSignOut={() => {}} />);
  expect(create).toMatch(/<div id="create-menu" hidden="" class="pop /);
  expect(avatar).toMatch(/<div id="account-menu" hidden="" class="pop [^"]*\bsheet\b/);
  expect(create).not.toMatch(/\bsheet\b/);
});

test("a menu comes 4 px from its trigger's side and fades in over 150 ms, as a transition so it can turn back", () => {
  expect(rule(css, ".pop")).toBe(
    "transition: opacity var(--dur-fade) var(--ease-out), transform var(--dur-fade) var(--ease-out), display var(--dur-fade) allow-discrete;",
  );
  expect(rule(block(css, "@starting-style"), ".pop")).toBe("opacity: 0; transform: translateY(-4px);");
  expect(MOTION.duration.fade).toBe(150);
});

test("a closing menu leaves faster than it came, and takes no clicks on its way out", () => {
  expect(rule(css, ".pop[hidden]")).toBe(
    "opacity: 0; transform: translateY(-4px); pointer-events: none; transition: opacity var(--dur-exit) var(--ease-out), transform var(--dur-exit) var(--ease-out), display var(--dur-exit) allow-discrete;",
  );
  expect(MOTION.duration.exit).toBeLessThan(MOTION.duration.fade);
});

test("a <details> menu enters the same way each time it opens", () => {
  expect(rule(css, "@keyframes pop-in {\n  from")).toBe("opacity: 0; transform: translateY(-4px);");
  expect(rule(css, "details > .pop")).toBe("transition: none;");
  expect(rule(css, "details[open] > .pop")).toBe("animation: pop-in var(--dur-fade) var(--ease-out);");
});

test("on phones the account sheet slides up from the bottom in 300 ms and back down in 200", () => {
  expect(rule(phone, ".pop.sheet")).toBe("transition: transform var(--dur-sheet) var(--ease-drawer), display var(--dur-sheet) allow-discrete;");
  expect(rule(block(phone, "@starting-style"), ".pop.sheet")).toBe("opacity: 1; transform: translateY(100%);");
  expect(rule(phone, ".pop.sheet[hidden]")).toBe(
    "opacity: 1; transform: translateY(100%); transition: transform var(--dur-panel) var(--ease-out), display var(--dur-panel) allow-discrete;",
  );
  expect([MOTION.duration.sheet, MOTION.duration.panel]).toEqual([300, 200]);
});

test("the navigation bar fades in, grows from 10 % towards 90 % while the page loads, then completes and fades", () => {
  expect(rule(css, ".nav-pending")).toBe("opacity: 0; transform-origin: left;");
  expect(rule(css, '.nav-pending[data-state="on"]')).toBe("opacity: 1; transition: opacity var(--dur-fade) var(--ease-out);");
  expect(rule(motionOk, ".nav-pending")).toBe("transform: scaleX(0.1);");
  expect(rule(motionOk, '.nav-pending[data-state="on"]')).toBe(
    "transform: scaleX(0.9); transition: opacity var(--dur-fade) var(--ease-out), transform var(--dur-grow) var(--ease-out);",
  );
  expect(rule(motionOk, '.nav-pending[data-state="done"]')).toBe(
    "transform: scaleX(1); transition: transform var(--dur-exit) var(--ease-out), opacity var(--dur-fade) var(--ease-out) var(--dur-exit);",
  );
  expect(MOTION.duration.grow).toBe(2000);
});

test("buttons sink to 0.98 under a press; links styled as buttons and table rows do not", () => {
  expect(rule(motionOk, 'button.btn:active:not(:disabled):not([aria-disabled="true"])')).toBe("transform: scale(0.98);");
  for (const selector of [".btn", ".btn-primary"]) expect(rule(css, selector)).toContain("transform var(--dur-press) var(--ease-out)");
  // The only :active rule that moves anything.
  expect(css.match(/:active[^{]*\{[^}]*transform/g)).toHaveLength(1);
  expect(MOTION.duration.press).toBe(100);
});

test("the filters, sort headers, pager and link tabs load through PendingLink", () => {
  for (const file of ["FilterBar", "DataTable", "Pager", "LinkTabs"]) {
    const source = readFileSync(new URL(`./${file}.tsx`, import.meta.url), "utf8");
    expect(source, file).toContain('import Link from "./PendingLink";');
    expect(source, file).not.toContain('from "next/link"');
  }
});

test("only opacity, transform and colour animate (and display, to keep a closing menu in the page), never layout", () => {
  const allowed = new Set(["opacity", "transform", "display", "color", "background-color", "border-color", "fill", "stroke", "none"]);
  for (const sheet of [css, mapCss]) {
    const lists = [...sheet.matchAll(/(?:^|[\s;{])transition:\s*([^;]+);/g)].map((m) => m[1]);
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists)
      for (const part of list.split(",")) expect(allowed, list).toContain(part.trim().split(/\s+/)[0]);
  }
});

test("under reduced motion every animation and transition is off", () => {
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*, ::before, ::after\s*\{\s*animation: none !important;\s*transition: none !important;/);
});

test("under reduced motion no transform is ever seen: the rest are states shown only mid-transition", () => {
  // Outside the no-preference block, a transform may sit only where a transition starts or ends: a hidden menu, a
  // starting style, a keyframe. With transitions and animations off, none of those is ever on screen.
  const rest = without(without(without(css, "@media (prefers-reduced-motion: no-preference)"), "@starting-style"), "@keyframes");
  const moving = [...rest.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, , body]) => /(?:^|[\s;])transform:/.test(body));
  expect(moving.length).toBeGreaterThan(0);
  for (const [, selector] of moving) expect(selector.trim()).toMatch(/\[hidden\]$/);
});
