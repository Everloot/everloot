import { expect, test, vi } from "vitest";
import { createIntakeQuota } from "./intake-quota";

const env = { NODE_ENV: "production", VERCEL: "1", SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key" };
const request = (ip = "203.0.113.5") => new Request("https://everloot.app/api/intake", { headers: { "x-vercel-forwarded-for": ip, "x-forwarded-for": "spoofed" } });

test("uses only the platform IP and sends namespaced hashes to the server-only RPC", async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify([{ allowed: true, retry_after: 0 }])));
  const quota = createIntakeQuota({ env, fetch });
  expect(await quota.request(request())).toEqual({ allowed: true, retryAfter: 0 });
  expect(await quota.install("install-1234")).toEqual({ allowed: true, retryAfter: 0 });
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe("https://example.supabase.co/rest/v1/rpc/consume_intake_quota");
  expect(JSON.parse(init.body)).toEqual({ p_scope: "request", p_key: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(init.body).not.toContain("203.0.113.5");
  expect(fetch.mock.calls[1][1].body).not.toContain("install-1234");
  expect(JSON.parse(fetch.mock.calls[1][1].body).p_key).not.toBe(JSON.parse(init.body).p_key);
  expect(init.cache).toBe("no-store");
});

test("on the Cloudflare Worker the bucket is keyed on cf-connecting-ip, and a forged Vercel header is refused", async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify([{ allowed: true, retry_after: 0 }])));
  const cf = { NODE_ENV: "production", EVERLOOT_PLATFORM: "cloudflare", SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY };
  const quota = createIntakeQuota({ env: cf, fetch });
  const at = (headers: Record<string, string>) => new Request("https://everloot.app/mcp/public", { headers });
  expect(await quota.mcp(at({ "cf-connecting-ip": "198.51.100.9" }))).toEqual({ allowed: true, retryAfter: 0 });
  await expect(quota.mcp(at({ "x-vercel-forwarded-for": "203.0.113.5" }))).rejects.toThrow();
});

test("public MCP calls get their own per-IP bucket, never the upload one, and trust the same platform IP", async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify([{ allowed: true, retry_after: 0 }])));
  const quota = createIntakeQuota({ env, fetch });
  await quota.request(request());
  expect(await quota.mcp(request())).toEqual({ allowed: true, retryAfter: 0 });
  const [upload, mcp] = fetch.mock.calls.map(([, init]) => JSON.parse(init.body));
  expect(mcp.p_scope).toBe("request");
  expect(mcp.p_key).not.toBe(upload.p_key);
  await expect(quota.mcp(request("spoofed"))).rejects.toThrow();
});

test("once the mcp scope migration is applied and flagged, public MCP uses its own scope and global bucket", async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify([{ allowed: true, retry_after: 0 }])));
  const quota = createIntakeQuota({ env: { ...env, EVERLOOT_MCP_QUOTA_SCOPE: "mcp" }, fetch });
  await quota.request(request());
  await quota.mcp(request());
  const [upload, mcp] = fetch.mock.calls.map(([, init]) => JSON.parse(init.body));
  expect(upload.p_scope).toBe("request");
  expect(mcp).toEqual({ p_scope: "mcp", p_key: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(mcp.p_key).not.toBe(upload.p_key);
});

test("in development the mcp scope keeps its own 200-per-IP allowance apart from uploads", async () => {
  const quota = createIntakeQuota({ env: { NODE_ENV: "test", EVERLOOT_MCP_QUOTA_SCOPE: "mcp" }, now: () => 0 });
  const local = new Request("http://localhost/mcp/public");
  for (let i = 0; i < 200; i++) expect((await quota.mcp(local)).allowed).toBe(true);
  expect((await quota.mcp(local)).allowed).toBe(false);
  expect((await quota.request(local)).allowed).toBe(true);
});

test("refuses missing, list or invalid platform IPs and does not trust a proxy header", async () => {
  const fetch = vi.fn();
  const quota = createIntakeQuota({ env, fetch });
  for (const value of ["", "203.0.113.5, 203.0.113.6", "spoofed"]) await expect(quota.request(request(value))).rejects.toThrow();
  await expect(quota.request(new Request("https://everloot.app", { headers: { "x-forwarded-for": "203.0.113.5" } }))).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

test("production cannot fall back to process-local quotas", async () => {
  const quota = createIntakeQuota({ env: { NODE_ENV: "production", VERCEL: "1" } });
  await expect(quota.request(request())).rejects.toThrow();
  await expect(quota.install("install-1234")).rejects.toThrow();
});

test("database denial carries retry delay; errors and malformed answers fail closed", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ allowed: false, retry_after: 43 }])));
  const quota = createIntakeQuota({ env, fetch });
  expect(await quota.install("install-1234")).toEqual({ allowed: false, retryAfter: 43 });
  for (const response of [new Response("unavailable", { status: 503 }), new Response("[]"), new Response('[{"allowed":true,"retry_after":-1}]')]) {
    fetch.mockResolvedValue(response);
    await expect(quota.install("install-1234")).rejects.toThrow();
  }
  fetch.mockRejectedValue(new Error("network unavailable"));
  await expect(quota.install("install-1234")).rejects.toThrow();
});

test("development preserves the 20-install allowance and resets after one hour", async () => {
  let now = 0;
  const quota = createIntakeQuota({ env: { NODE_ENV: "test" }, now: () => now });
  for (let i = 0; i < 20; i++) expect((await quota.install("install-1234")).allowed).toBe(true);
  expect(await quota.install("install-1234")).toEqual({ allowed: false, retryAfter: 3600 });
  now = 3_600_000;
  expect((await quota.install("install-1234")).allowed).toBe(true);
});

test("equivalent IPv6 addresses share a bucket", async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response('[{"allowed":true,"retry_after":0}]'));
  const quota = createIntakeQuota({ env, fetch });
  await quota.request(request("2001:db8::1"));
  await quota.request(request("2001:0db8:0:0:0:0:0:1"));
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
});

test("cleanup deletes only counters expired more than a day ago and reports failures", async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response(null, { status: 204 }));
  const quota = createIntakeQuota({ env, fetch, now: () => Date.parse("2026-10-07T00:00:00Z") });
  await quota.prune();
  expect(fetch.mock.calls[0][0]).toContain("intake_quota_buckets?reset_at=lt.2026-10-06T00%3A00%3A00.000Z");
  expect(fetch.mock.calls[0][1].method).toBe("DELETE");
  fetch.mockResolvedValue(new Response(null, { status: 503 }));
  await expect(quota.prune()).rejects.toThrow("Quota cleanup failed");
});

test("market price requests have their own per-IP bucket, apart from uploads and the MCP", async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify([{ allowed: true, retry_after: 0 }])));
  const quota = createIntakeQuota({ env, fetch });
  await quota.request(request());
  await quota.mcp(request());
  expect(await quota.market(request())).toEqual({ allowed: true, retryAfter: 0 });
  const [upload, mcp, market] = fetch.mock.calls.map(([, init]) => JSON.parse(init.body));
  expect(market.p_key).not.toBe(upload.p_key);
  expect(market.p_key).not.toBe(mcp.p_key);
  expect(fetch.mock.calls[2][1].body).not.toContain("203.0.113.5");
  await expect(quota.market(request("spoofed"))).rejects.toThrow();
});

test("a market request past 200 an hour from one IP is refused in development", async () => {
  const quota = createIntakeQuota({ env: { NODE_ENV: "test" }, now: () => 0 });
  const local = new Request("http://localhost/api/market/prices");
  for (let i = 0; i < 200; i++) expect((await quota.market(local)).allowed).toBe(true);
  expect((await quota.market(local)).allowed).toBe(false);
});

test("the reporter is a keyed 64-bit hash of the platform IP: stable, never the address, and not guessable without the key", () => {
  const quota = createIntakeQuota({ env });
  const a = quota.reporter(request("203.0.113.5"));
  expect(a).toMatch(/^[a-f0-9]{16}$/);
  expect(quota.reporter(request("203.0.113.5"))).toBe(a);
  expect(quota.reporter(request("203.0.113.6"))).not.toBe(a);
  expect(createIntakeQuota({ env: { ...env, SUPABASE_SERVICE_ROLE_KEY: "another-key" } }).reporter(request("203.0.113.5"))).not.toBe(a);
  expect(a).not.toContain("203");
  // Without a trusted platform IP there is no reporter, never a guess from a spoofable header.
  expect(quota.reporter(request("spoofed"))).toBeUndefined();
});

test("an IPv6 caller is its /64: addresses in one /64 share every bucket, another /64 does not", async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response('[{"allowed":true,"retry_after":0}]'));
  const quota = createIntakeQuota({ env, fetch });
  await quota.request(request("2001:db8:1:2::1"));
  await quota.request(request("2001:db8:1:2:ffff:abcd:1:9"));
  await quota.request(request("2001:db8:1:3::1"));
  const keys = fetch.mock.calls.map(([, init]) => JSON.parse(init.body).p_key);
  expect(keys[0]).toBe(keys[1]);
  expect(keys[2]).not.toBe(keys[0]);
  // The market's one-voice-per-address rule counts the same /64 once.
  expect(quota.reporter(request("2001:db8:1:2::1"))).toBe(quota.reporter(request("2001:db8:1:2:9::9")));
});

test("the /64 prefix is computed from any spelling, and IPv4-mapped addresses count as IPv4", async () => {
  const { ipv6Subscriber } = await import("./intake-quota");
  expect(ipv6Subscriber("2001:DB8:0:0:1::1")).toBe("2001:db8:0:0::/64");
  expect(ipv6Subscriber("2001:db8::")).toBe("2001:db8:0:0::/64");
  expect(ipv6Subscriber("::1")).toBe("0:0:0:0::/64");
  expect(ipv6Subscriber("fe80:1:2:3:4:5:6:7")).toBe("fe80:1:2:3::/64");
  expect(ipv6Subscriber("::ffff:203.0.113.5")).toBe("203.0.113.5");
});
