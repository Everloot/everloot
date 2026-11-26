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
