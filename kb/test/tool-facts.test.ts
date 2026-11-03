import { beforeEach, expect, test, vi } from "vitest";
import { auctionSightingsFromRecords } from "../src/auction-history.js";
import { goldFactsFromRecords } from "../src/gold-ledger.js";
import { fromTooledUploads } from "../src/mcp-server.js";

const base = { installId: "install-one", capturedAt: "2026-10-09T00:00:00Z" };
const snap = { ...base, eventId: "e:16", kind: "gold_snapshot", character: "Thrall", realm: "Forever", currentCopper: 100, peakCopper: 100 };
const evt = { ...base, eventId: "e:17", kind: "money_event", character: "Thrall", realm: "Forever", category: "loot", copper: 10 };
const scan = { ...base, eventId: "e:13", kind: "auction_scan", realm: "Forever", itemId: 5, copper: 10, priceBasis: "unit" };

type GoldFacts = ReturnType<typeof goldFactsFromRecords>;
type AuctionFacts = ReturnType<typeof auctionSightingsFromRecords>;

const T1 = "2026-10-10T06:30:00.000Z";
const T2 = "2026-10-10T06:35:00.000Z";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("one tool's facts are built once per corpus version", async () => {
  const loader = vi.fn(async () => ({ records: [snap, evt], dataAsOf: T1 }));
  const seen: GoldFacts[] = [];
  const render = (facts: GoldFacts) => { seen.push(facts); return `snapshots:${facts.snapshots.length}`; };
  expect(await fromTooledUploads("gold_ledger", render, loader)).toBe("snapshots:1\nData as of 2026-10-10 06:30 UTC.");
  expect(await fromTooledUploads("gold_ledger", render, loader)).toBe("snapshots:1\nData as of 2026-10-10 06:30 UTC.");
  expect(seen[0]).toBe(seen[1]);
  // New snapshot time: the facts rebuild once for the new version.
  loader.mockResolvedValue({ records: [snap, evt], dataAsOf: T2 });
  expect(await fromTooledUploads("gold_ledger", render, loader)).toContain("Data as of 2026-10-10 06:35 UTC.");
  expect(seen[2]).not.toBe(seen[1]);
  expect(seen).toHaveLength(3);
});

test("each tool aggregates its own facts from the same corpus", async () => {
  const loader = async () => ({ records: [snap, evt, scan], dataAsOf: T1 });
  const gold = await fromTooledUploads("gold_ledger", (facts: GoldFacts) => `gold:${facts.events.length}`, loader);
  const auctions = await fromTooledUploads("auction_history", (facts: AuctionFacts) => `scans:${facts.length}`, loader);
  expect(gold).toContain("gold:1");
  expect(auctions).toContain("scans:1");
});

test("a failing loader fails closed and never serves stale facts", async () => {
  const render = (facts: GoldFacts) => `snapshots:${facts.snapshots.length}`;
  expect(await fromTooledUploads("gold_ledger", render, async () => null)).toMatch(/unavailable/i);
  expect(await fromTooledUploads("gold_ledger", () => { throw new Error("renderer must not run"); }, async () => { throw new Error("down"); }))
    .toMatch(/unavailable/i);
  const loader = async () => ({ records: [snap, evt], dataAsOf: T1 });
  expect(await fromTooledUploads("gold_ledger", render, loader)).toContain("snapshots:1");
});

test("the URL path asks for the tool's kinds and shares its facts per version", async () => {
  vi.stubEnv("EVERLOOT_PUBLIC_CORPUS_URL", "https://everloot.example/api/corpus/public");
  const send = vi.fn().mockImplementation(() => Response.json({ ok: true, records: [scan], dataAsOf: T1 }));
  vi.stubGlobal("fetch", send);
  const seen: AuctionFacts[] = [];
  const render = (facts: AuctionFacts) => { seen.push(facts); return `scans:${facts.length}`; };
  expect(await fromTooledUploads("auction_history", render)).toContain("scans:1");
  expect(await fromTooledUploads("auction_history", render)).toContain("scans:1");
  expect(send.mock.calls[0][0]).toBe("https://everloot.example/api/corpus/public?kinds=auction_scan");
  expect(seen[0]).toBe(seen[1]);
});
