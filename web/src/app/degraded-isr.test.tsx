import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { emptyMarket } from "@kb/market";
import type { OpenDataState } from "@/lib/open-data";

// The deploy draws the prerendered and ISR pages on the runner with no storage settings, and OpenNext serves that
// render for the page's whole lifetime; a cold instance whose read failed is the same. Each kept read a page makes is
// recorded with its lifetime: Next keeps the page for the shortest it sees, so a 10 s read keeps it 10 s.
const kept = vi.hoisted(() => ({ calls: [] as { key: string; revalidate: unknown }[] }));
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T, key?: string[], opts?: { revalidate?: unknown }) =>
    ((...args: Parameters<T>) => { kept.calls.push({ key: (key ?? []).join(","), revalidate: opts?.revalidate }); return fn(...args); }) as T,
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_noStore: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
  permanentRedirect: (url: string) => { throw new Error(`PERMANENT ${url}`); },
  useRouter: () => ({ push: () => {} }),
  usePathname: () => "/",
}));

const reads = vi.hoisted(() => ({
  timelineDown: false,
  openData: { state: "none" } as OpenDataState,
  marketDown: false,
}));
vi.mock("@/lib/changes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/changes")>()),
  timelineDegraded: async () => reads.timelineDown,
}));
vi.mock("@/lib/open-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/open-data")>()),
  loadOpenData: async () => reads.openData,
}));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: {
    loadMarket: async () => (reads.marketDown ? { state: null, dataAsOf: null, unreachable: true } : { state: emptyMarket(), dataAsOf: "2026-11-27T10:00:00.000Z" }),
    loadCorpus: async () => ({ uploads: 0, records: [], dataAsOf: null }),
  },
}));

import NewsHub from "./news/page";
import WowForeverPage from "./wow-forever/page";
import DownloadPage from "./database/download/page";
import CrossRealmItemPage from "./tools/auctions/item/[itemId]/page";
import { GET as changesFeed } from "./changes/feed.xml/route";
import { GET as llmsFull } from "./llms-full.txt/route";
import { DEGRADED_REVALIDATE } from "@/lib/degraded-render";

beforeEach(() => {
  kept.calls = [];
  reads.timelineDown = false;
  reads.openData = { state: "none" };
  reads.marketDown = false;
});

const DEGRADED_TAG = /<meta name="everloot-degraded" content="1"\/>/;
/** The kept reads that ask for less than a minute: the degraded-render rule's, and nothing else. */
const shortened = () => kept.calls.filter((c) => typeof c.revalidate === "number" && c.revalidate < 60);
const html = async (page: () => Promise<React.ReactElement>) => renderToStaticMarkup(await page());

const PAGES: { name: string; draw: () => Promise<string>; fail: () => void }[] = [
  { name: "/news", draw: () => html(NewsHub), fail: () => { reads.timelineDown = true; } },
  { name: "/wow-forever", draw: () => html(WowForeverPage), fail: () => { reads.timelineDown = true; } },
  { name: "/database/download", draw: () => html(DownloadPage), fail: () => { reads.openData = { state: "unreachable" }; } },
  {
    name: "/tools/auctions/item/[itemId]",
    draw: () => html(() => CrossRealmItemPage({ params: Promise.resolve({ itemId: "2589" }) })),
    fail: () => { reads.marketDown = true; },
  },
];

test.each(PAGES)("$name: a render with its reads healthy keeps the page's own lifetime and carries no degraded marker", async ({ draw }) => {
  expect(await draw()).not.toMatch(DEGRADED_TAG);
  expect(shortened()).toEqual([]);
});

test.each(PAGES)("$name: a render whose read failed is marked degraded and kept only seconds", async ({ draw, fail }) => {
  fail();
  expect(await draw()).toMatch(DEGRADED_TAG);
  expect(shortened()).toEqual([{ key: "degraded-render", revalidate: DEGRADED_REVALIDATE }]);
  expect(DEGRADED_REVALIDATE).toBeLessThanOrEqual(15);
});

const ROUTES: { name: string; get: () => Promise<Response> }[] = [
  { name: "/changes/feed.xml", get: changesFeed },
  { name: "/llms-full.txt", get: llmsFull },
];

test.each(ROUTES)("$name: drawn from the store keeps its own lifetime; drawn from the bundled posts, only seconds", async ({ get }) => {
  expect((await get()).status).toBe(200);
  expect(shortened()).toEqual([]);
  reads.timelineDown = true;
  expect((await get()).status).toBe(200);
  expect(shortened()).toEqual([{ key: "degraded-render", revalidate: DEGRADED_REVALIDATE }]);
});
