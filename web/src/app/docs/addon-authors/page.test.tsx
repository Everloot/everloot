import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/script", () => ({ default: () => null }));

const store = vi.hoisted(() => ({ loadCorpus: vi.fn(), api: vi.fn() }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { loadCorpus: store.loadCorpus } }));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { api: store.api } }));

import { CREDIT_LINE, GAME_DATA_CREDIT, LOOT_TYPES, parseRecords } from "@everloot/protocol";
import { GET } from "@/app/api/corpus/public/route";
import { docsPage } from "@/lib/docs/nav";
import { llmsTxt } from "@/lib/llms";
import { countsAsKillOrGather } from "../../../../../kb/src/drop-rollup";
import AddonAuthorsPage from "./page";
import { JS, PY, ROW } from "./samples";

const run = promisify(execFile);
const decode = (html: string) => html.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
const page = () => renderToStaticMarkup(<AddonAuthorsPage />);

afterEach(() => { vi.unstubAllEnvs(); });

test("the page is in the docs nav, and llms.txt lists it", () => {
  const entry = docsPage("/docs/addon-authors");
  expect(entry?.tab.id).toBe("overview");
  expect(entry?.group.title).toBe("Build on Everloot");
  expect(llmsTxt()).toContain("https://everloot.app/docs/addon-authors");
});

test("it gives the credit line, the licences and the Blizzard credit exactly as the code has them", () => {
  const body = text(page());
  expect(body).toContain(CREDIT_LINE);
  expect(body).toContain("CC BY-SA 4.0");
  expect(body).toContain(GAME_DATA_CREDIT);
  expect(body).toContain("Found in game files, unconfirmed");
  expect(body).toContain("hello@everloot.app");
});

test("every link goes where it says: docs pages are in the nav, site pages exist, the repo links are the repository's", () => {
  const html = page();
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => decode(m[1]!));
  for (const href of hrefs.filter((h) => h.startsWith("/docs/"))) {
    expect(docsPage(href.split("#")[0]!), href).toBeDefined();
  }
  expect(existsSync(new URL("../../terms/page.tsx", import.meta.url))).toBe(true);
  expect(existsSync(new URL("../../database/download/page.tsx", import.meta.url))).toBe(true);
  expect(hrefs).toEqual(expect.arrayContaining([
    "/docs/api/corpus-public", "/docs/api/keys", "/docs/api/data-files", "/docs/licence", "/database/download", "mailto:hello@everloot.app",
    "https://github.com/Everloot/everloot/discussions", "https://github.com/Everloot/everloot/issues/new/choose",
    "https://github.com/Everloot/everloot/blob/main/docs/DATA_POLICY.md", "https://github.com/Everloot/everloot/blob/main/docs/OPEN_DATA.md",
    "https://github.com/Everloot/everloot/blob/main/kb/src/drop-rollup.ts",
  ]));
  for (const file of ["docs/DATA_POLICY.md", "docs/OPEN_DATA.md", "kb/src/drop-rollup.ts"]) {
    expect(existsSync(new URL(`../../../../../${file}`, import.meta.url)), file).toBe(true);
  }
});

test("it says the open data export may not exist, and sends the reader to the page that knows", () => {
  const body = text(page());
  expect(body).toContain("No export to download yet");
  expect(body).toContain("this page cannot say whether one exists today");
});

test("the limits are the code's with keys on, and absent with keys off", () => {
  vi.stubEnv("EVERLOOT_DATA_GUARD", "1");
  expect(text(page())).toContain("30 requests per hour for each IP address");
  expect(text(page())).toContain("500 records");
  expect(text(page())).toContain("2,000 requests per hour");
  expect(text(page())).toContain("5,000 records a page");
  vi.stubEnv("EVERLOOT_DATA_GUARD", "");
  expect(text(page())).toContain("Keys are not switched on yet");
});

test("the loot types the page lists are the protocol's, and the skinning exclusion is the rollup's", () => {
  const body = text(page());
  for (const type of LOOT_TYPES) expect(body, type).toContain(type);
  expect(countsAsKillOrGather("skinning")).toBe(false);
  for (const type of ["kill", "gather", "fishing", undefined]) expect(countsAsKillOrGather(type), String(type)).toBe(true);
  for (const type of ["pickpocket", "disenchant", "container"]) expect(countsAsKillOrGather(type), type).toBe(false);
  expect(body).toContain("never count in a kill's denominator");
  expect(body).toContain("countsAsKillOrGather");
});

test("the sample row is a valid public loot record, and every field the page names is in it", () => {
  const row = JSON.parse(ROW) as Record<string, unknown>;
  const parsed = parseRecords([row]);
  expect(parsed.receipt.rejected).toEqual([]);
  expect(parsed.records).toHaveLength(1);
  const body = text(page());
  for (const field of ["lootType", "sourceNpcId", "items", "capturedAt", "eventId", "installId", "sourceEvidence"]) {
    expect(Object.keys(row), field).toContain(field);
    expect(body, field).toContain(field);
  }
  expect(row.installId).toMatch(/^pub-[0-9a-f]{32}$/);
});

// The samples run for real, in node and python, against the corpus route served from this process. Nothing goes to everloot.app.
let server: Server;
let origin = "";
let calls = 0;
let dir = "";
const SKINNING_NPC = 1000;
const LONE_NPC = 2000;

function lootRecord(n: number, extra: Record<string, unknown>) {
  return { kind: "loot", installId: "real-install-0000", eventId: `loot:${n}`, capturedAt: "2026-11-05T19:42:10.000Z", sourceEvidence: "loot-api", items: [], ...extra };
}

beforeEach(async () => {
  vi.stubEnv("EVERLOOT_DATA_GUARD", "1");
  vi.stubEnv("EVERLOOT_CHARACTER_KEY", "k".repeat(32));
  vi.stubEnv("EVERLOOT_API_KEY", "");
  store.api.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
  const records: unknown[] = [];
  // 1,100 kill windows, so the feed needs three pages of 500, then the skinning windows the samples must find.
  for (let i = 0; i < 1100; i++) records.push(lootRecord(i, { lootType: "kill", sourceNpcId: 3000 + (i % 7), items: [{ itemId: 7, count: 1 }] }));
  // Creature 1000: five windows from three installs; two hold item 2318, one holds it twice in one window.
  const skin = (n: number, install: string, items: { itemId: number; count: number }[]) =>
    records.push(lootRecord(2000 + n, { installId: `real-install-${install}`, lootType: "skinning", sourceNpcId: SKINNING_NPC, items }));
  skin(1, "a", [{ itemId: 2318, count: 1 }]);
  skin(2, "a", [{ itemId: 2318, count: 1 }, { itemId: 2318, count: 1 }]);
  skin(3, "b", [{ itemId: 2318, count: 1 }]);
  skin(4, "c", []);
  skin(5, "c", [{ itemId: 783, count: 2 }]);
  // Creature 2000: one install, many windows. A single report, however often it repeats.
  for (let i = 0; i < 4; i++) records.push(lootRecord(3000 + i, { installId: "real-install-d", lootType: "skinning", sourceNpcId: LONE_NPC, items: [{ itemId: 2318, count: 1 }] }));
  // A window with no type is never read as skinning.
  records.push(lootRecord(4000, { sourceNpcId: 5000, items: [{ itemId: 2318, count: 1 }] }));
  calls = 0;
  // The second request sees a rebuilt snapshot, as one would between two pages of a long read.
  store.loadCorpus.mockReset().mockImplementation(async () => ({ uploads: 9, records, dataAsOf: ++calls >= 2 ? "2026-11-10T12:10:00.000Z" : "2026-11-10T12:00:00.000Z" }));
  server = createServer((req, res) => {
    GET(new Request(`${origin}${req.url}`)).then(async (r) => {
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(await r.text());
    }, () => { res.writeHead(500); res.end(); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = mkdtempSync(join(tmpdir(), "everloot-addon-docs-"));
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

const env = () => {
  const { EVERLOOT_API_KEY: _, ...rest } = process.env;
  return rest;
};

function expectSkinning() {
  const out = JSON.parse(readFileSync(join(dir, "skinning.json"), "utf8"));
  expect(out.credit).toBe(CREDIT_LINE);
  expect(out.dataAsOf).toBe("2026-11-10T12:10:00.000Z");
  expect(Object.keys(out).sort()).toEqual(["creatures", "credit", "dataAsOf"]);
  expect(out.creatures).toHaveLength(2);
  const by = Object.fromEntries(out.creatures.map((c: { sourceNpcId: number }) => [c.sourceNpcId, c]));
  expect(by[SKINNING_NPC]).toEqual({
    sourceNpcId: SKINNING_NPC, windows: 5, installs: 3, confirmed: true,
    items: [{ itemId: 2318, windows: 3 }, { itemId: 783, windows: 1 }],
  });
  expect(by[LONE_NPC]).toEqual({ sourceNpcId: LONE_NPC, windows: 4, installs: 1, confirmed: false, items: [{ itemId: 2318, windows: 4 }] });
  // Counts only: no install id, real or pseudonym, reaches the file.
  const raw = readFileSync(join(dir, "skinning.json"), "utf8");
  expect(raw).not.toContain("pub-");
  expect(raw).not.toContain("real-install");
  // 1,100 kills + 9 skinning windows + 1 untyped = 1,110 records: three pages. The first read is thrown away when
  // dataAsOf changes on page two, so the restart reads all three again.
  expect(calls).toBe(2 + 3);
}

test("the JavaScript sample pages the feed, restarts when dataAsOf changes, and counts installs per creature", async () => {
  expect(JS.split("https://everloot.app")).toHaveLength(2);
  writeFileSync(join(dir, "skinning.mjs"), JS.replace("https://everloot.app", origin));
  const { stdout } = await run(process.execPath, ["skinning.mjs"], { cwd: dir, env: env() });
  expect(stdout).toContain("Wrote 2 creatures to skinning.json");
  expect(stdout).toContain(CREDIT_LINE);
  expectSkinning();
}, 30_000);

test("the Python sample does the same", async (ctx) => {
  const python = process.platform === "win32" ? "python" : "python3";
  try { await run(python, ["--version"]); } catch { ctx.skip(); return; }
  expect(PY.split("https://everloot.app")).toHaveLength(2);
  writeFileSync(join(dir, "skinning.py"), PY.replace("https://everloot.app", origin));
  const { stdout } = await run(python, ["-I", join(dir, "skinning.py")], { cwd: dir, env: env() });
  expect(stdout).toContain("Wrote 2 creatures to skinning.json");
  expect(stdout).toContain(CREDIT_LINE);
  expectSkinning();
}, 30_000);
