import { afterEach, beforeEach, expect, test, vi } from "vitest";

const held = vi.hoisted(() => ({ asked: [] as string[], admitted: [] as boolean[], quota: { allowed: true, retryAfter: 0 } as { allowed: boolean; retryAfter: number } | Error }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: {} }) }));
vi.mock("next/cache", () => ({ unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn }));
vi.mock("@/lib/armory-lookup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/armory-lookup")>()),
  findCharacter: async (text: string, admit: () => Promise<boolean>) => { held.asked.push(text); held.admitted.push(await admit()); return null; },
}));
vi.mock("@/lib/intake-quota", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/intake-quota")>()),
  intakeQuota: { lookup: async () => { if (held.quota instanceof Error) throw held.quota; return held.quota; } },
}));

import { GET } from "./route";

const BROWSER = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36", "sec-fetch-site": "same-origin", "sec-fetch-dest": "empty" };
const ask = (query: string, headers: Record<string, string> = BROWSER) => GET(new Request(`https://everloot.app/search/people?${query}`, { headers }));

beforeEach(() => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  vi.stubEnv("EVERLOOT_ARMORY_LOOKUP", "1");
  held.asked = [];
  held.admitted = [];
  held.quota = { allowed: true, retryAfter: 0 };
});
afterEach(() => { vi.unstubAllEnvs(); });

test("the /search page's fetch of a full name nobody stored asks for a lookup, counted by the lookup quota", async () => {
  const res = await ask("q=Nera%20Ashcombe&lookup=1");
  expect(res.status).toBe(200);
  expect(held.asked).toEqual(["Nera Ashcombe"]);
  expect(held.admitted).toEqual([true]);
});

test("a used-up or unreadable quota refuses the lookup", async () => {
  held.quota = { allowed: false, retryAfter: 60 };
  await ask("q=Nera%20Ashcombe&lookup=1");
  held.quota = new Error("quota storage down");
  await ask("q=Nera%20Ashcombe&lookup=1");
  expect(held.admitted).toEqual([false, false]);
});

test("the switch off, the header's type-ahead, a crawler or a script never look up", async () => {
  await ask("q=Nera%20Ashcombe");
  await ask("q=Nera%20Ashcombe&lookup=1", { ...BROWSER, "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" });
  await ask("q=Nera%20Ashcombe&lookup=1", { "user-agent": "python-requests/2.32" });
  vi.stubEnv("EVERLOOT_ARMORY_LOOKUP", "");
  await ask("q=Nera%20Ashcombe&lookup=1");
  vi.stubEnv("EVERLOOT_ARMORY_LOOKUP", "1");
  vi.stubEnv("EVERLOOT_ARMORY", "");
  await ask("q=Nera%20Ashcombe&lookup=1");
  expect(held.asked).toEqual([]);
});
