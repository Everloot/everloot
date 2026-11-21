import { expect, test, vi } from "vitest";
import { dispatchStoredViews, STORED_VIEWS_DISPATCH_URL } from "./stored-views-dispatch";

test("without a token nothing is sent", async () => {
  const fetch = vi.fn();
  expect(await dispatchStoredViews({}, fetch)).toBe("off");
  expect(await dispatchStoredViews({ EVERLOOT_VIEWS_DISPATCH_TOKEN: "  " }, fetch)).toBe("off");
  expect(fetch).not.toHaveBeenCalled();
});

test("with a token it asks GitHub to run the stored-views workflow on main", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  expect(await dispatchStoredViews({ EVERLOOT_VIEWS_DISPATCH_TOKEN: "synthetic-dispatch-value" }, fetch)).toBe("sent");
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(STORED_VIEWS_DISPATCH_URL);
  expect(new URL(url).origin).toBe("https://api.github.com");
  expect(init.method).toBe("POST");
  expect(JSON.parse(String(init.body))).toEqual({ ref: "main" });
  const headers = init.headers as Record<string, string>;
  expect(headers.authorization).toBe("Bearer synthetic-dispatch-value");
  expect(headers["user-agent"]).toBeTruthy();
});

test("a refusal throws with GitHub's status, so the cron logs it", async () => {
  const fetch = vi.fn(async () => new Response('{"message":"Resource not accessible by personal access token"}', { status: 403 }));
  await expect(dispatchStoredViews({ EVERLOOT_VIEWS_DISPATCH_TOKEN: "synthetic-dispatch-value" }, fetch)).rejects.toThrow("stored-views dispatch failed (403)");
});
