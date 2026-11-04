import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { hashKey, KEYS_MADE_PER_DAY, KEYS_PER_ACCOUNT, newKey, presentedKey, REVOKED_KEPT_DAYS, USAGE_KEPT_DAYS } from "./api-keys";
import {
  admit, ANON_PAGE, ANON_PER_HOUR, attribution, attributionHeaders, KEY_PAGE, KEY_PER_HOUR, KEY_URL, pageOf, pageRequest,
} from "./data-guard";
import { createIntakeQuota } from "./intake-quota";

const ON = { EVERLOOT_DATA_GUARD: "1", SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "service" };
const OFF = { SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "service" };
const ok = { allowed: true, retryAfter: 0 };
const quotaMock = () => ({ api: vi.fn().mockResolvedValue(ok), mcp: vi.fn().mockResolvedValue(ok), market: vi.fn().mockResolvedValue(ok) });
const req = (url = "https://everloot.app/api/corpus/public", key?: string) =>
  new Request(url, key ? { headers: { authorization: `Bearer ${key}` } } : {});
const keyRow = (row: object) => vi.fn().mockImplementation(async () => Response.json([row]));
const KEY_ID = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";

test("guard off: bulk endpoints answer as before, unpaged, with no quota and keys ignored", async () => {
  const quota = quotaMock();
  const send = vi.fn();
  for (const surface of ["corpus", "drops"] as const) {
    expect(await admit(req(undefined, newKey().token), surface, { env: OFF, quota, fetch: send })).toEqual({ tier: "open", pageMax: null });
  }
  expect(quota.api).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

test("guard off: the MCP and market keep their existing per-IP quota", async () => {
  const quota = quotaMock();
  quota.mcp.mockResolvedValueOnce({ allowed: false, retryAfter: 60 });
  const limited = await admit(req(), "mcp", { env: OFF, quota }) as Response;
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("60");
  // No keys exist while the guard is off, so the refusal does not point at one.
  const body = await limited.json();
  expect(body).not.toHaveProperty("getAKey");
  expect(body.error).not.toContain("key");
  expect(await admit(req(), "market", { env: OFF, quota })).toEqual({ tier: "open", pageMax: null });
  expect(quota.market).toHaveBeenCalledTimes(1);
});

test("guard on: anonymous bulk reads spend the per-IP api quota and get a capped page", async () => {
  const quota = quotaMock();
  expect(await admit(req(), "corpus", { env: ON, quota })).toEqual({ tier: "anonymous", pageMax: ANON_PAGE });
  expect(quota.api).toHaveBeenCalledTimes(1);
});

test(`guard on: the ${ANON_PER_HOUR + 1}th anonymous bulk request in an hour is a 429 that points at a free key`, async () => {
  const quota = createIntakeQuota({ env: {} });
  for (let i = 0; i < ANON_PER_HOUR; i++) expect(await admit(req(), "drops", { env: ON, quota })).toMatchObject({ tier: "anonymous" });
  const refused = await admit(req(), "corpus", { env: ON, quota }) as Response;
  expect(refused.status).toBe(429);
  expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
  const body = await refused.json();
  expect(body).toMatchObject({ ok: false, getAKey: KEY_URL });
  expect(body.error).toContain(`${ANON_PER_HOUR} requests per hour`);
  expect(body.error).toContain("Authorization: Bearer <key>");
  // Asking questions is not bulk copying: the MCP's own bucket is untouched.
  expect(await admit(req(), "mcp", { env: ON, quota })).toMatchObject({ tier: "anonymous" });
});

test("a key raises the limits: its own allowance, the larger page, and the anonymous quota untouched", async () => {
  const { token } = newKey();
  const quota = quotaMock();
  quota.mcp.mockResolvedValue({ allowed: false, retryAfter: 600 });
  const send = keyRow({ allowed: true, retry_after: 0, key_ref: KEY_ID });
  for (const surface of ["corpus", "drops", "market", "mcp"] as const) {
    expect(await admit(req(undefined, token), surface, { env: ON, quota, fetch: send })).toEqual({ tier: "key", pageMax: KEY_PAGE, keyId: KEY_ID });
  }
  expect(quota.api).not.toHaveBeenCalled();
  expect(quota.mcp).not.toHaveBeenCalled();
  // Every keyed request is counted against the key, by its hash: the key itself never leaves the site.
  expect(send).toHaveBeenCalledTimes(4);
  const [url, init] = send.mock.calls[3];
  expect(url).toBe("https://db.example/rest/v1/rpc/consume_api_key");
  expect(JSON.parse(init.body)).toEqual({ p_token_hash: hashKey(token), p_surface: "mcp" });
  expect(init.body).not.toContain(token);
});

test("anonymousAs: a keyless caller spends the MCP's quota and page, a key is still counted on its own surface", async () => {
  const quota = quotaMock();
  expect(await admit(req(), "drops", { env: ON, quota, anonymousAs: "mcp" })).toEqual({ tier: "anonymous", pageMax: null });
  expect(quota.mcp).toHaveBeenCalledTimes(1);
  expect(quota.api).not.toHaveBeenCalled();
  quota.mcp.mockResolvedValueOnce({ allowed: false, retryAfter: 60 });
  const limited = await admit(req(), "drops", { env: ON, quota, anonymousAs: "mcp" }) as Response;
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("60");
  const { token } = newKey();
  const send = keyRow({ allowed: true, retry_after: 0, key_ref: KEY_ID });
  expect(await admit(req(undefined, token), "drops", { env: ON, quota, fetch: send, anonymousAs: "mcp" })).toEqual({ tier: "key", pageMax: KEY_PAGE, keyId: KEY_ID });
  expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ p_token_hash: hashKey(token), p_surface: "drops" });
  expect(quota.mcp).toHaveBeenCalledTimes(2);
  expect(quota.api).not.toHaveBeenCalled();
  // Guard off: the surface answers as it did, with no quota.
  expect(await admit(req(), "drops", { env: OFF, quota, anonymousAs: "mcp" })).toEqual({ tier: "open", pageMax: null });
  expect(quota.mcp).toHaveBeenCalledTimes(2);
});

test("a revoked or unknown key is a 401; a malformed one never reaches the database", async () => {
  const revoked = await admit(req(undefined, newKey().token), "corpus", { env: ON, quota: quotaMock(), fetch: keyRow({ allowed: false, retry_after: 0, key_ref: null }) }) as Response;
  expect(revoked.status).toBe(401);
  expect(revoked.headers.get("www-authenticate")).toMatch(/^Bearer error="invalid_token"/);
  expect((await revoked.json()).error).toContain("/docs/api/keys");
  const send = vi.fn();
  expect(((await admit(req(undefined, "evl_short"), "corpus", { env: ON, quota: quotaMock(), fetch: send })) as Response).status).toBe(401);
  expect(send).not.toHaveBeenCalled();
});

test("a key over its hourly allowance is a 429 with retry-after", async () => {
  const res = await admit(req(undefined, newKey().token), "corpus", { env: ON, quota: quotaMock(), fetch: keyRow({ allowed: false, retry_after: 120, key_ref: KEY_ID }) }) as Response;
  expect(res.status).toBe(429);
  expect(res.headers.get("retry-after")).toBe("120");
  expect((await res.json()).error).toContain(`${KEY_PER_HOUR} requests`);
});

test("another service's bearer token is not a key: the caller is anonymous", async () => {
  const quota = quotaMock();
  const send = vi.fn();
  expect(await admit(req(undefined, "some-oauth-token"), "corpus", { env: ON, quota, fetch: send })).toEqual({ tier: "anonymous", pageMax: ANON_PAGE });
  expect(send).not.toHaveBeenCalled();
});

test("storage trouble fails closed with 503, for keys and for anonymous callers", async () => {
  const broken = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
  expect(((await admit(req(undefined, newKey().token), "corpus", { env: ON, quota: quotaMock(), fetch: broken })) as Response).status).toBe(503);
  const odd = keyRow({ allowed: true, retry_after: 0, key_ref: null });
  expect(((await admit(req(undefined, newKey().token), "corpus", { env: ON, quota: quotaMock(), fetch: odd })) as Response).status).toBe(503);
  const quota = quotaMock();
  quota.api.mockRejectedValue(new Error("Quota storage unavailable"));
  expect(((await admit(req(), "corpus", { env: ON, quota })) as Response).status).toBe(503);
});

test("paging: the cap holds whatever limit is asked for, and next keeps the other parameters", () => {
  const items = Array.from({ length: 1200 }, (_, i) => i);
  const r = req("https://everloot.app/api/corpus/public?kinds=loot&limit=100000");
  const first = pageOf(r, items, pageRequest(r, ANON_PAGE)!);
  expect(first.items).toHaveLength(ANON_PAGE);
  expect(first.page).toMatchObject({ offset: 0, limit: ANON_PAGE, total: 1200 });
  const next = new URL(first.page.next!);
  expect(Object.fromEntries(next.searchParams)).toEqual({ kinds: "loot", limit: String(ANON_PAGE), offset: String(ANON_PAGE) });
  const lastReq = req("https://everloot.app/api/corpus/public?kinds=loot&offset=1000");
  const last = pageOf(lastReq, items, pageRequest(lastReq, ANON_PAGE)!);
  expect(last.items).toEqual(items.slice(1000));
  expect(last.page.next).toBeNull();
});

test("paging: with no cap and no limit the whole list is one page, as before the guard", () => {
  const r = req();
  const all = pageOf(r, [1, 2, 3], pageRequest(r, null)!);
  expect(all).toEqual({ items: [1, 2, 3], page: { offset: 0, limit: 3, total: 3, next: null } });
  for (const bad of ["?offset=-1", "?limit=0", "?limit=abc", "?offset=1.5"]) {
    expect(pageRequest(req(`https://everloot.app/api/corpus/public${bad}`), ANON_PAGE)).toBeNull();
  }
});

test("attribution carries the licence, the credit line and the source page", () => {
  expect(attribution("/database")).toEqual({
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    credit: "Data from Everloot (https://everloot.app), CC BY-SA 4.0.",
    source: "https://everloot.app/database",
    terms: "https://everloot.app/terms#licences",
  });
  const headers = new Headers(attributionHeaders());
  expect(headers.get("x-everloot-licence")).toBe("CC BY-SA 4.0");
  expect(headers.get("x-everloot-credit")).toBe("Data from Everloot (https://everloot.app), CC BY-SA 4.0.");
  expect(headers.get("link")).toContain('<https://creativecommons.org/licenses/by-sa/4.0/>; rel="license"');
});

test("the limits in code are the limits the migration enforces", () => {
  // Compare without line endings or indentation, so a CRLF checkout reads the same as LF.
  const flat = (text: string) => text.replace(/\s+/g, " ");
  const sql = flat(readFileSync(new URL("../../../supabase/migrations/20261019120000_data_guard.sql", import.meta.url), "utf8"));
  expect(sql).toContain(`keys := array['api_global', 'api:' || p_key]; limits := array[3000, ${ANON_PER_HOUR}];`);
  expect(sql).toContain(`bucket_name := 'user:' || found_key.user_id::text;`);
  expect(sql).toContain(`if current_bucket.count >= ${KEY_PER_HOUR} then`);
  expect(sql).toContain(`if live >= ${KEYS_PER_ACCOUNT} then refusal := 'live_limit';`);
  expect(sql).toContain(`if made.count >= ${KEYS_MADE_PER_DAY} then refusal := 'daily_limit';`);
  expect(sql).toContain("and 'read:public' = any(k.scopes);");
  expect(sql).toContain(`where day < (now() at time zone 'utc')::date - ${USAGE_KEPT_DAYS};`);
  expect(sql).toContain(`where revoked_at < now() - interval '${REVOKED_KEPT_DAYS} days';`);
  expect(sql).toContain("(last_used_at is null or last_used_at < now() - interval '1 minute')");
  const quota = flat(readFileSync(new URL("./intake-quota.ts", import.meta.url), "utf8"));
  expect(quota).toContain(`[["api_global", 3000], [\`api:\${value}\`, ${ANON_PER_HOUR}]]`);
});

test("the Bearer scheme is matched in any case; other schemes and other tokens are not keys", () => {
  const token = newKey().token;
  const withAuth = (value: string) => new Request("https://everloot.app/x", { headers: { authorization: value } });
  for (const scheme of ["Bearer", "bearer", "BEARER", "bEaReR"]) expect(presentedKey(withAuth(`${scheme} ${token}`))).toBe(token);
  expect(presentedKey(withAuth(`Basic ${token}`))).toBeNull();
  expect(presentedKey(withAuth("Bearer some-oauth-token"))).toBeNull();
  expect(presentedKey(new Request("https://everloot.app/x"))).toBeNull();
});
