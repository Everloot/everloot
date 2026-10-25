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
  return { ...real, DATABASE_HUBS: [...real.DATABASE_HUBS, { href: "/database/example", label: "Example hub" }] };
});

import { DATABASE_HUBS } from "@/lib/database-hubs";
import { instanceRows } from "@/lib/instances";
import DatabasePage from "./page";

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

test("before launch the players column says when recording starts; after launch the line is gone", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, dataAsOf: null, records: [] });
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
    expect(renderToStaticMarkup(await DatabasePage())).toContain("The addon starts recording when the game launches on November 4, 2026.");
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    expect(renderToStaticMarkup(await DatabasePage())).not.toContain("The addon starts recording");
  } finally {
    vi.useRealTimers();
  }
});
