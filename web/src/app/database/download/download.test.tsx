import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { OpenDataState } from "@/lib/open-data";

const loader = vi.hoisted(() => ({ loadOpenData: vi.fn() }));
vi.mock("@/lib/open-data", () => loader);
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));

import DownloadPage, { metadata } from "./page";
import { DESCRIPTION_MAX, DESCRIPTION_MIN } from "@/lib/seo";
import { DATABASE_HUBS } from "@/lib/database-hubs";
import { OpenDataManifest } from "../../../../../kb/src/open-data/manifest";
import { OPEN_DATA_EXCLUDED, OPEN_DATA_VERIFY } from "../../../../../kb/src/open-data/text";

const sha = (c: string) => c.repeat(64);
/** The text as React writes it into markup. */
const escaped = (s: string) => renderToStaticMarkup(<>{s}</>);
const manifest = OpenDataManifest.parse({
  schema: "everloot.open-data/1", generatedAt: "2026-10-22T04:57:00.000Z", dataAsOf: "2026-10-22T01:30:00.000Z",
  method: { agreement: 3, text: "3 or more installs agree." }, source: { records: 5120, installs: 41, kinds: ["npc_sighting"] },
  gameFiles: { version: "1.60.1.70450", extractedAt: "2026-10-18T00:00:00.000Z", label: "Found in game files, unconfirmed" },
  licence: {
    observed: { folder: "observed/", name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/", credit: "Data from Everloot (https://everloot.app), CC BY-SA 4.0." },
    gameFiles: { folder: "game-files/", name: "Blizzard's data, not under Everloot's licence", credit: "Game data (c) Blizzard Entertainment, Inc." },
  },
  excluded: [], notYet: [], verify: [],
  files: [
    { path: "observed/npcs.ndjson", layer: "observed", dataset: "npcs", about: "NPCs", schema: "schema/observed-npcs.schema.json", rows: 312, candidates: 1204, candidatesAre: "NPCs that at least one install reported", bytes: 90_000, sha256: sha("a") },
    { path: "game-files/zones.ndjson", layer: "game-files", dataset: "zones", about: "Zones", schema: "schema/game-files-zones.schema.json", rows: 46, candidates: null, candidatesAre: "zones in the files", bytes: 800, sha256: sha("b") },
  ],
});

const html = async (state: OpenDataState) => {
  loader.loadOpenData.mockResolvedValue(state);
  return renderToStaticMarkup(await DownloadPage());
};
beforeEach(() => loader.loadOpenData.mockReset());

test("with an export, the page prints what its manifest says: dates, counts with their denominators, sizes and hashes", async () => {
  const page = await html({ state: "ok", manifest, stamp: "2026-10-22T04-57-00-000Z", base: "https://data.example.test/open-data/2026-10-22T04-57-00-000Z" });
  expect(page).toContain("Made 2026-10-22 04:57 UTC");
  expect(page).toContain("data as of 2026-10-22 01:30 UTC");
  expect(page).toContain("5,120 public records from 41 installs");
  expect(page).toContain("1.60.1.70450");
  expect(page).toContain('href="https://data.example.test/open-data/2026-10-22T04-57-00-000Z/observed/npcs.ndjson"');
  expect(page).toContain("312");
  expect(page).toContain("1,204");
  expect(page).toContain("NPCs that at least one install reported");
  // A denominator the layer does not have is [?], never a made-up number.
  const zones = page.split("<tr").find((r) => r.includes("game-files/zones.ndjson"))!;
  // The phone's one-line summary under the name, then the rows, of how many and what that counts cells.
  expect(zones).toContain("46 of [?] · 800 B");
  expect(zones).toMatch(/>46<\/td><td[^>]*>\[\?\]<\/td><td[^>]*>zones in the files<\/td>/);
  expect(page).toContain("87.9 KB");
  expect(page).toContain(sha("a").slice(0, 12));
  expect(page).toContain("manifest.json");
});

test("every state states the licence, the credit line, the method, what is left out and how to verify", async () => {
  for (const state of [{ state: "ok", manifest, stamp: "x", base: "https://data.example.test/open-data/x" }, { state: "none" }, { state: "unreachable" }] as OpenDataState[]) {
    const page = await html(state);
    expect(page).toContain("CC BY-SA 4.0");
    expect(page).toContain("Data from Everloot (https://everloot.app), CC BY-SA 4.0.");
    expect(page).toContain("not under that licence");
    expect(page).toContain("3 or more installs agree");
    expect(page).toContain("not affiliated with or endorsed by Blizzard");
    expect(page).toContain("How to verify a count");
    for (const line of OPEN_DATA_EXCLUDED) expect(page).toContain(escaped(line));
    for (const line of OPEN_DATA_VERIFY) expect(page).toContain(escaped(line));
    expect(page).not.toContain('aria-label="Breadcrumb"');
  }
});

test("with no export the page says so and prints no count; unreachable reads [?]", async () => {
  const none = await html({ state: "none" });
  expect(none).toContain("There is no published export yet");
  expect(none).not.toContain("<table");
  expect(none).toContain("No export to download yet");
  const down = await html({ state: "unreachable" });
  expect(down).toContain("could not be read just now");
  expect(down).toContain("[?]");
  expect(down).not.toContain("<table");
});

test("the page is listed with the other data surfaces and asks to be indexed", () => {
  expect(DATABASE_HUBS).toContainEqual({ href: "/database/download", label: "Download the data", source: "players" });
  const description = metadata.description as string;
  expect(description.length).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
  expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  expect(metadata.robots).toBeUndefined();
  expect(metadata.alternates?.canonical).toBe("/database/download");
});
