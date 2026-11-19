import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { armoryGuild } from "@/lib/armory.fixture";
import { createMemoryArmoryStore, type MemoryArmoryStore } from "@/lib/armory-store";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
const held = vi.hoisted(() => ({ store: null as MemoryArmoryStore | null, allowed: true }));
vi.mock("@/lib/armory-store", async (original) => ({ ...(await original<typeof import("@/lib/armory-store")>()), armoryStore: () => held.store }));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { form: async () => ({ allowed: held.allowed }) } }));
beforeEach(() => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-30T00:00:00Z"));
  held.store = createMemoryArmoryStore();
  held.allowed = true;
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.resetModules(); });

const page = async (search: Record<string, string> = {}) => renderToStaticMarkup(await (await import("./page")).default({ searchParams: Promise.resolve(search) }));
const send = async (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return (await import("./send/route")).POST(new Request("https://everloot.app/armory/guilds/submit/send", { method: "POST", body: form }));
};
const result = (r: Response) => new URL(r.headers.get("location")!).searchParams;

test("guild form and directory search are labelled, honest and noindex", async () => {
  const out = await page({ region: "eu", name: "Ember Wardens" });
  expect(out).toContain('action="/guilds"');
  expect(out).toContain('name="q"');
  expect(out).toContain('action="/armory/guilds/submit/send"');
  expect(out).toContain("usually within a few hours");
  expect(out).toContain("nothing is added");
  expect(out).toContain('value="Ember Wardens"');
  expect((await import("./page")).generateMetadata().robots).toEqual({ index: false, follow: false });
  expect(await page({ done: "0" })).toContain("queued already");
  expect(await page({ done: "1" })).toContain("The guild is queued");
  expect(await page({ error: "invalid" })).toContain('role="alert"');
});

test("queues a normalized guild once, with no realm or ruleset required", async () => {
  const spy = vi.spyOn(held.store!, "enqueue");
  const fields = { region: "eu", name: "  Ember   Wardens  " };
  expect(result(await send(fields)).get("done")).toBe("1");
  expect(spy).toHaveBeenCalledWith("eu", "guild", "ember-wardens", "website");
  expect(result(await send(fields)).get("done")).toBe("0");
  expect(held.store!.queued()).toHaveLength(1);
});

test.each([{}, { region: "kr", name: "Ember Wardens" }, { region: "eu", name: "<bad>" }, { region: "eu", name: "-wardens" }, { region: "eu", name: "a".repeat(65) }])("invalid guild identity never queues: %j", async (fields) => {
  const spy = vi.spyOn(held.store!, "enqueue");
  expect(result(await send(fields as Record<string, string>)).get("error")).toBe("invalid");
  expect(spy).not.toHaveBeenCalled();
});

test("guild refresh uses checkedAt, including a 304 read, and the exact recheck boundary", async () => {
  const fields = { region: "eu", name: "Ember Wardens" };
  held.store!.putGuild(armoryGuild({ checkedAt: "2026-11-10T00:00:00.001Z" }), []);
  expect(result(await send(fields)).get("done")).toBe("0");
  held.store!.putGuild(armoryGuild({ checkedAt: "2026-11-10T00:00:00.000Z" }), []);
  expect(result(await send(fields)).get("done")).toBe("1");
});

test("quota, unavailable storage and switch off preserve intake rules", async () => {
  held.allowed = false;
  expect(result(await send({ region: "eu", name: "Ember Wardens" })).get("error")).toBe("limit");
  held.allowed = true;
  vi.spyOn(held.store!, "enqueue").mockRejectedValue(new Error("down"));
  expect(result(await send({ region: "eu", name: "Ember Wardens" })).get("error")).toBe("storage");
  vi.stubEnv("EVERLOOT_ARMORY", "");
  expect((await send({ region: "eu", name: "Ember Wardens" })).status).toBe(404);
  await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
});
