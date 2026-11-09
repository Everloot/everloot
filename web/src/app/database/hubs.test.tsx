import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus, loadCompletion: async () => ({ state: null, dataAsOf: null, unreachable: true }) },
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
// A hub a later lane might add, with no count of its own.
vi.mock("@/lib/database-hubs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/database-hubs")>();
  return { ...real, DATABASE_HUBS: [...real.DATABASE_HUBS, { href: "/database/example", label: "Example hub", source: "players" as const }] };
});

import { DATABASE_HUBS } from "@/lib/database-hubs";
import { instanceRows } from "@/lib/instances";
import DatabasePage from "./(hub)/page";

beforeEach(() => store.loadCorpus.mockReset());

/** The text inside the browse index's link to `href`. */
const row = (page: string, href: string) => new RegExp(`<a href="${href}"[^>]*>(.*?)</a>`).exec(page)?.[1];

test("the database page links every hub in the list, the dungeon and raid index among them, with the number of instances", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z", records: [] });
  const page = renderToStaticMarkup(await DatabasePage());
  for (const hub of DATABASE_HUBS) expect(row(page, hub.href), hub.href).toContain(hub.label);
  const total = instanceRows().size;
  expect(total).toBeGreaterThan(0);
  expect(row(page, "/database/instances")).toContain(`Dungeons and raids</span><span class="shrink-0 tabular-nums text-muted">${total}</span>`);
});

/** The links inside the block under `heading`, up to the next block. */
const block = (page: string, heading: string) => {
  const start = page.indexOf(`>${heading}</h2>`);
  expect(start, heading).toBeGreaterThan(-1);
  const end = page.indexOf("</section>", start);
  return page.slice(start, end);
};

test("the page has one H1, Database, ahead of the browse blocks", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z", records: [] });
  const page = renderToStaticMarkup(await DatabasePage());
  expect(page.match(/<h1[ >]/g)).toHaveLength(1);
  expect(/<h1[^>]*>Database<\/h1>/.test(page)).toBe(true);
  expect(page.indexOf("<h1")).toBeLessThan(page.indexOf(">Seen by players</h2>"));
});

test("game-file lists sit under From the game files, player-fed lists under Seen by players, and the Guilds lookup is not a row", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z", records: [] });
  const page = renderToStaticMarkup(await DatabasePage());
  const files = block(page, "From the game files");
  for (const href of ["spells", "achievements", "factions", "titles", "quest-chains", "zones", "instances"]) expect(files, href).toContain(`<a href="/database/${href}"`);
  expect(files.match(/<a href=/g)).toHaveLength(7);
  const players = block(page, "Seen by players");
  for (const href of ["npcs", "quests", "vendors", "objects", "drops"]) expect(players, href).toContain(`<a href="/database/${href}"`);
  expect(players).not.toContain('href="/database/spells"');
  expect(page).not.toContain("look up");
  expect(page).not.toContain('href="/tools/guild-board"');
});

test("a class whose only subclass repeats its own name lists no subclass under it", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z", records: [] });
  const page = renderToStaticMarkup(await DatabasePage());
  expect(page).toContain('<a href="/database/items/quest"');
  expect(page).not.toContain('<a href="/database/items/quest/quest"');
});

test("a hub with no count of its own is linked without one, not with a blank or a zero", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z", records: [] });
  const page = renderToStaticMarkup(await DatabasePage());
  expect(row(page, "/database/example")).toBe('<span class="min-w-0 truncate">Example hub</span>');
});

test("with storage down the instance index is still counted from the game files, never as zero", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const page = renderToStaticMarkup(await DatabasePage());
  expect(row(page, "/database/instances")).toContain(`>${instanceRows().size}<`);
});

test("before launch the players column says when recording starts; after launch it says a row fills at 3 installs, with the addon link", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, dataAsOf: null, records: [] });
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
    expect(renderToStaticMarkup(await DatabasePage())).toContain("The addon starts recording when the game launches on November 4, 2026.");
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    const after = renderToStaticMarkup(await DatabasePage());
    expect(after).not.toContain("The addon starts recording");
    expect(block(after, "Seen by players")).toContain("A row fills when 3 installs agree.");
    expect(block(after, "Seen by players")).toContain('<a href="/addon"');
  } finally {
    vi.useRealTimers();
  }
});
