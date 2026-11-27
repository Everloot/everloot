import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

// The spell names sit in private storage and the icons in the asset folder; both are stood in for here.
const store = vi.hoisted(() => ({ names: null as Map<number, string> | null, icons: new Map<number, string>() }));
vi.mock("@/lib/game-assets", async (original) => ({
  ...(await original<typeof import("@/lib/game-assets")>()),
  loadSpellNames: async () => (store.names ? { version: "x", names: store.names } : null),
  loadSiteAssets: async () => ({ spellIcons: store.icons }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

import ClassSpellsPage, * as route from "./page";
import { classSpellLevels } from "@/lib/class-hub";

const params = (value: string) => ({ params: Promise.resolve({ class: value }) });
const render = async (value = "mage") => renderToStaticMarkup(await ClassSpellsPage(params(value)));
const { levels, unleveled } = classSpellLevels("mage");
const first = levels[0]!, last = levels.at(-1)!;

beforeEach(() => { store.names = new Map(); store.icons = new Map(); });

test("the page reads the names on each request, and only a catalog class has one", async () => {
  expect(route.dynamic).toBe("force-dynamic");
  await expect(render("class-0")).rejects.toThrow("NEXT_NOT_FOUND");
  const meta = await route.generateMetadata(params("mage"));
  expect(meta.title).toBe("WoW Forever Mage Spells by Level");
  expect(meta.alternates?.canonical).toBe("/classes/mage/spells");
  expect(meta.robots).toEqual({ index: false, follow: true });
});

test("every spell with a level is listed under it, lowest level first, linking its page with its icon and the unconfirmed mark", async () => {
  const id = first.spells[0]!;
  store.names = new Map([[id, "A made-up spell"]]);
  store.icons = new Map([[id, "https://assets.test/icons/spell.webp"]]);
  const html = await render();
  expect(html).toContain(`href="/database/spells/${id}"`);
  expect(html).toContain("A made-up spell");
  expect(html).toContain('src="https://assets.test/icons/spell.webp"');
  expect(html).toContain('data-badge="files"');
  for (const { spells } of levels) for (const s of spells) expect(html, String(s)).toContain(`href="/database/spells/${s}"`);
  // Level headings in order, the lowest first.
  const at = (level: number) => html.indexOf(`id="level-${level}"`);
  expect(at(first.level)).toBeGreaterThan(-1);
  expect(at(first.level)).toBeLessThan(at(last.level));
  // A spell the names file does not name keeps its number, never a guessed name.
  const unnamed = first.spells[1] ?? levels[1]!.spells[0]!;
  expect(html).toMatch(new RegExp(`href="/database/spells/${unnamed}"[^>]*>Spell ${unnamed}<`));
  expect(html).toContain(`${unleveled} more Mage spells have no level in the files`);
  expect(html).toContain('href="/database/spells?class=mage"');
  expect(html).toContain('href="/classes/mage"');
});

test("names that cannot be read are said so, and the spells still list by number", async () => {
  store.names = null;
  const html = await render();
  expect(html).toContain("The spell names could not be read");
  const id = first.spells[0]!;
  expect(html).toMatch(new RegExp(`href="/database/spells/${id}"[^>]*>Spell ${id}<`));
});

test("talents and runes have no trainer level: they sit in their own group, not under Level 1, and a name shows once there", async () => {
  // Real mage spell ids (build 71139): Ignite is a talent, 401722 engraves Arcane Barrage, 400610 is Arcane Barrage,
  // 400613 and 400614 are both Living Bomb (engraved by 415936), 29074 is the Master of Elements talent and 29077 its
  // proc. Fireball (133) is a trainer spell at level 1.
  store.names = new Map([
    [133, "Fireball"], [11119, "Ignite"], [401722, "Engrave Cloak - Arcane Barrage"], [400610, "Arcane Barrage"],
    [415936, "Engrave Gloves - Living Bomb"], [400613, "Living Bomb"], [400614, "Living Bomb"],
    [29074, "Master of Elements"], [29077, "Master of Elements"],
  ]);
  const html = await render();
  const group = html.slice(html.indexOf('id="talents-runes"'));
  const level1 = html.slice(html.indexOf('id="level-1"'), html.indexOf('id="talents-runes"'));
  expect(html).toContain("Talents and runes (no trainer level)");
  expect(level1).toContain('href="/database/spells/133"');
  for (const id of [11119, 401722, 400610, 400613, 29074]) {
    expect(level1, String(id)).not.toContain(`href="/database/spells/${id}"`);
    expect(group, String(id)).toContain(`href="/database/spells/${id}"`);
  }
  // Same name twice: shown once.
  expect(html.match(/>Living Bomb</g)?.length).toBe(1);
  expect(html.match(/>Master of Elements</g)?.length).toBe(1);
});

test("the page counts the same spells as the class hub and says where each one is", async () => {
  const placed = levels.reduce((n, l) => n + l.spells.length, 0);
  const html = await render();
  const m = new RegExp(`${placed} Mage spells have a level in the game files: (\\d+) listed by level, lowest first, (\\d+) talents and runes apart(?:, and (\\d+) that repeat a name and rank at one level, shown once)?\\.`).exec(html);
  expect(m).not.toBeNull();
  expect(Number(m![1]) + Number(m![2]) + Number(m![3] ?? 0)).toBe(placed);
  // A name repeated at one level is counted, not dropped silently.
  store.names = new Map(first.spells.slice(0, 2).map((id) => [id, "Twin"]));
  expect(await render()).toMatch(/, and 1 that repeat a name and rank at one level, shown once\./);
});

test("ranks of one spell say which rank each is, so a name never repeats without one", async () => {
  // Real warlock ids (build 71139): Shadow Bolt rank 1 (686, level 1) and rank 2 (695, level 6).
  store.names = new Map([[686, "Shadow Bolt"], [695, "Shadow Bolt"]]);
  const html = await renderToStaticMarkup(await ClassSpellsPage(params("warlock")));
  expect(html).toMatch(/href="\/database\/spells\/686"[^>]*>Shadow Bolt<(?:\/[^>]+>)*(?:<[^>]+>)*\s*Rank 1</);
  expect(html).toMatch(/href="\/database\/spells\/695"[^>]*>Shadow Bolt<(?:\/[^>]+>)*(?:<[^>]+>)*\s*Rank 2</);
});
