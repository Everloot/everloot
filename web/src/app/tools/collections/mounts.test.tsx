import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn(), loadCompletion: vi.fn(), loadState: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus, loadCompletion: store.loadCompletion },
  sharingStore: { loadState: store.loadState },
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));

import CollectionsPage from "./page";
import { mountRows } from "./MountsView";
import { CLIENT_MOUNTS } from "@/data/game-data/client-mounts";

const text = (html: string) => html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
const page = async () => renderToStaticMarkup(await CollectionsPage({ searchParams: Promise.resolve({ view: "mounts" }) }));

test("mountRows: the mounts 3 installs report lead, the rest follow unconfirmed, both in id order", () => {
  const mounts = { "9": { name: "Ram", spellId: 900 }, "7": { name: "Horse", spellId: 700, ridingSkill: 75 }, "8": { name: "Wolf", spellId: 800 } };
  expect(mountRows(new Set([800]), mounts).map((r) => [r.id, r.name, r.reported])).toEqual([[8, "Wolf", true], [7, "Horse", false], [9, "Ram", false]]);
  expect(mountRows(new Set(), mounts).map((r) => r.id)).toEqual([7, 8, 9]);
});

test("the Mounts view lists the files' mounts marked unconfirmed when nobody has uploaded a mount collection", async () => {
  store.loadCorpus.mockResolvedValue({ unreachable: false, records: [], dataAsOf: "2026-10-27T00:00:00Z" });
  const html = await page();
  const body = text(html);
  expect(body).toContain("|Mounts|");
  expect(body).toMatch(/\|Reported by players\|0\|In the files\|unconfirmed\|\d+\|/);
  const first = Object.values(CLIENT_MOUNTS.mounts)[0]!;
  expect(html).toContain(first.name);
  const rows = html.split("<tbody")[1]?.split("<tr").slice(1) ?? [];
  expect(rows.length).toBe(Object.keys(CLIENT_MOUNTS.mounts).length);
  for (const r of rows) expect(r).toContain('data-badge="files"');
  expect(html).toContain('href="/tools/collections?view=mounts"');
});

test("a mount 3 installs list under the Mounts collection leads the table without the marker", async () => {
  const [id, mount] = Object.entries(CLIENT_MOUNTS.mounts)[5]!;
  const records = ["a", "b", "c"].map((installId, i) => ({ installId, eventId: `e:${i}`, capturedAt: "2026-10-27T00:00:00Z", kind: "collection_catalog", collection: "Mounts", source: "Vendor", itemId: mount.spellId }));
  store.loadCorpus.mockResolvedValue({ unreachable: false, records, dataAsOf: "2026-10-27T00:00:00Z" });
  const html = await page();
  expect(text(html)).toMatch(/\|Reported by players\|1\|/);
  const rows = html.split("<tbody")[1]?.split("<tr").slice(1) ?? [];
  expect(rows[0]).toContain(mount.name);
  expect(rows[0]).not.toContain('data-badge="files"');
  expect(rows[1]).toContain('data-badge="files"');
  expect(Number(id)).toBeGreaterThan(0);
});

test("with storage down the view still lists the files' mounts and says the reported count is unrecorded", async () => {
  store.loadCorpus.mockResolvedValue({ unreachable: true, records: [] });
  const body = text(await page());
  expect(body).toMatch(/\|Reported by players\|unrecorded\|/);
  expect(body).toContain("Storage unreachable");
});
