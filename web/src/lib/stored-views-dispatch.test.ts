import { expect, test, vi } from "vitest";
import { dispatchSiteHealth, dispatchStoredViews, SITE_HEALTH_DISPATCH_URL, STORED_VIEWS_DISPATCH_URL } from "./stored-views-dispatch";

const token = { EVERLOOT_VIEWS_DISPATCH_TOKEN: "synthetic-dispatch-value" };

test("without a token nothing is sent or recorded", async () => {
  const fetch = vi.fn();
  const record = vi.fn();
  expect(await dispatchStoredViews({}, fetch, record)).toBe("off");
  expect(await dispatchStoredViews({ EVERLOOT_VIEWS_DISPATCH_TOKEN: "  " }, fetch, record)).toBe("off");
  expect(fetch).not.toHaveBeenCalled();
  expect(record).not.toHaveBeenCalled();
});

test("with a token it asks GitHub to run the stored-views workflow on main, and records the answer with the token's expiry", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 204, headers: { "github-authentication-token-expiration": "2026-12-22 06:42:29 UTC" } }));
  const record = vi.fn(async () => {});
  expect(await dispatchStoredViews(token, fetch, record)).toBe("sent");
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(STORED_VIEWS_DISPATCH_URL);
  expect(new URL(url).origin).toBe("https://api.github.com");
  expect(init.method).toBe("POST");
  expect(JSON.parse(String(init.body))).toEqual({ ref: "main" });
  const headers = init.headers as Record<string, string>;
  expect(headers.authorization).toBe("Bearer synthetic-dispatch-value");
  expect(headers["user-agent"]).toBeTruthy();
  expect(record).toHaveBeenCalledWith(expect.objectContaining({ httpStatus: 204, sent: true, tokenExpiresAt: "2026-12-22T06:42:29.000Z" }));
  expect(JSON.stringify(record.mock.calls)).not.toContain("synthetic-dispatch-value");
});

test("a refusal is recorded, then throws with GitHub's status, so the cron logs it", async () => {
  const fetch = vi.fn(async () => new Response('{"message":"Bad credentials"}', { status: 401 }));
  const record = vi.fn(async () => {});
  await expect(dispatchStoredViews(token, fetch, record)).rejects.toThrow("stored-views dispatch failed (401)");
  expect(record).toHaveBeenCalledWith(expect.objectContaining({ httpStatus: 401, sent: false, tokenExpiresAt: null }));
});

test("a record that cannot be written never fails the start", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await dispatchStoredViews(token, fetch, async () => { throw new Error("R2 down"); })).toBe("sent");
  vi.restoreAllMocks();
});

test("the site-health start uses the same token on the site-health workflow and records nothing", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  expect(await dispatchSiteHealth(token, fetch)).toBe("sent");
  expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe(SITE_HEALTH_DISPATCH_URL);
  expect(SITE_HEALTH_DISPATCH_URL).toContain("/workflows/site-health.yml/dispatches");
  expect(await dispatchSiteHealth({}, fetch)).toBe("off");
  await expect(dispatchSiteHealth(token, vi.fn(async () => new Response("no", { status: 403 })))).rejects.toThrow("site-health.yml dispatch failed (403)");
});