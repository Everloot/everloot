import { afterEach, beforeEach, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));

import { DELETE, GET, POST } from "./route";
import { cleanLabel, hashKey, KEY_PATTERN, NO_LIVE_KEY } from "@/lib/api-keys";
import { DESKTOP_KEY_LABEL as DESKTOP } from "@/lib/desktop-connect";

const USER = { id: "11111111-2222-4333-8444-555555555555", bnet_id: "1", battletag: "Thrall#1" };
const KEY_ID = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";
const call = (method: string, query = "", body?: object, origin: string | null = "https://everloot.app") =>
  new Request(`https://everloot.app/api/keys${query}`, {
    method, headers: { ...(origin === null ? {} : { origin }), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });

beforeEach(() => {
  vi.stubEnv("EVERLOOT_DATA_GUARD", "1");
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); });

test("nothing works until the data guard is on", async () => {
  vi.stubEnv("EVERLOOT_DATA_GUARD", "");
  for (const res of [await GET(call("GET")), await POST(call("POST", "", {})), await DELETE(call("DELETE", `?id=${KEY_ID}`))]) {
    expect(res.status).toBe(503);
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("keys need a Battle.net sign-in", async () => {
  auth.getUser.mockResolvedValue(null);
  const res = await GET(call("GET"));
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ signIn: "/api/auth/bnet" });
});

test("making a key shows it once and stores only its hash, under the signed-in account", async () => {
  auth.authQuery.mockResolvedValue([{ key_ref: KEY_ID, refusal: null }]);
  const res = await POST(call("POST", "", { label: "  Everloot Desktop\u0007 App  " }));
  expect(res.status).toBe(201);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  const made = await res.json();
  expect(made.token).toMatch(KEY_PATTERN);
  expect(made).toMatchObject({ ok: true, id: KEY_ID, hint: made.token.slice(-4) });
  const [path, init] = auth.authQuery.mock.calls[0];
  expect(path).toBe("rpc/create_api_key");
  expect(JSON.parse(init.body)).toEqual({ p_user_id: USER.id, p_token_hash: hashKey(made.token), p_hint: made.token.slice(-4), p_label: "Everloot Desktop App" });
  expect(init.body).not.toContain(made.token);
});

test("with saved builds on, a key can also read its owner's builds; otherwise the call is unchanged", async () => {
  auth.authQuery.mockResolvedValue([{ key_ref: KEY_ID, refusal: null }]);
  await POST(call("POST", "", { label: DESKTOP, builds: true }));
  expect(JSON.parse(auth.authQuery.mock.calls[0][1].body)).not.toHaveProperty("p_scopes");
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
  await POST(call("POST", "", { label: DESKTOP, builds: true }));
  expect(JSON.parse(auth.authQuery.mock.calls[1][1].body).p_scopes).toEqual(["read:public", "read:own"]);
  await POST(call("POST", "", { label: DESKTOP, builds: "yes" }));
  expect(JSON.parse(auth.authQuery.mock.calls[2][1].body)).not.toHaveProperty("p_scopes");
  auth.authQuery.mockResolvedValue([]);
  expect(await (await GET(call("GET"))).json()).toMatchObject({ ownScope: true });
});

test("a sixth live key is refused, and so is an eleventh key made in one day", async () => {
  auth.authQuery.mockResolvedValue([{ key_ref: null, refusal: "live_limit" }]);
  const res = await POST(call("POST", "", { label: DESKTOP }));
  expect(res.status).toBe(409);
  expect((await res.json()).error).toContain("Revoke one first");
  auth.authQuery.mockResolvedValue([{ key_ref: null, refusal: "daily_limit" }]);
  const churn = await POST(call("POST", "", { label: DESKTOP }));
  expect(churn.status).toBe(429);
  expect((await churn.json()).error).toContain("10 keys in the last day");
  // An answer the database should never give is an error, not a key.
  auth.authQuery.mockResolvedValue([{ key_ref: null, refusal: null }]);
  expect((await POST(call("POST", "", { label: DESKTOP }))).status).toBe(503);
});

test("the older call without purpose, scopes or expiry makes only the Desktop App's key", async () => {
  auth.authQuery.mockImplementation(async (path: string) => (path.startsWith("api_keys?") ? [] : [{ key_ref: KEY_ID, refusal: null }]));
  for (const body of [{}, { label: "bot" }, { label: "bot", builds: true }, { label: "Everloot Desktop" }]) {
    const res = await POST(call("POST", "", body));
    expect(res.status, JSON.stringify(body)).toBe(400);
    expect((await res.json()).error).toContain("what the key is for");
  }
  expect(auth.authQuery.mock.calls.some(([path]) => path === "rpc/create_api_key")).toBe(false);
  const desktop = await POST(call("POST", "", { label: DESKTOP, builds: true }));
  expect(desktop.status).toBe(201);
  expect(auth.authQuery.mock.calls.at(-1)![0]).toBe("rpc/create_api_key");
  expect(JSON.parse(auth.authQuery.mock.calls.at(-1)![1].body)).toMatchObject({ p_label: DESKTOP });
});

test("labels are cut at 60 whole characters, never inside an emoji", () => {
  const label = cleanLabel("🐉".repeat(70));
  expect(Array.from(label)).toHaveLength(60);
  expect(label).toBe("🐉".repeat(60));
  expect(cleanLabel("a".repeat(59) + "🐉🐉")).toBe("a".repeat(59) + "🐉");
  expect(cleanLabel(42)).toBe("");
});

test("a revoked key can be deleted with its counts; a live one must be revoked first", async () => {
  auth.authQuery.mockResolvedValueOnce([{ id: KEY_ID }]);
  expect((await DELETE(call("DELETE", `?id=${KEY_ID}&erase=1`))).status).toBe(200);
  const [path, init] = auth.authQuery.mock.calls[0];
  expect(init.method).toBe("DELETE");
  expect(path).toContain(`user_id=eq.${USER.id}`);
  expect(path).toMatch(/or=\(revoked_at\.not\.is\.null,expires_at\.lte\.[^)]+\)/);
  auth.authQuery.mockResolvedValueOnce([]);
  const live = await DELETE(call("DELETE", `?id=${KEY_ID}&erase=1`));
  expect(live.status).toBe(404);
  expect((await live.json()).error).toContain("Revoke it first");
});

test("another site, or a request with no Origin, cannot make, roll or revoke keys with the visitor's cookie", async () => {
  for (const origin of ["https://evil.example", null]) {
    expect((await POST(call("POST", "", { label: "x" }, origin))).status).toBe(403);
    expect((await POST(call("POST", `?roll=${KEY_ID}`, undefined, origin))).status).toBe(403);
    expect((await DELETE(call("DELETE", `?id=${KEY_ID}`, undefined, origin))).status).toBe(403);
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
  expect(auth.getUser).not.toHaveBeenCalled();
});

test("the list shows the account's own keys only", async () => {
  auth.authQuery.mockResolvedValue([{ id: KEY_ID, hint: "abcd", label: "", scopes: ["read:public"], created_at: "2026-10-19T00:00:00Z", last_used_at: null, revoked_at: null, expires_at: null }]);
  const body = await (await GET(call("GET"))).json();
  expect(body).toMatchObject({ ok: true, limit: 5, keys: [{ id: KEY_ID, hint: "abcd" }] });
  expect(auth.authQuery.mock.calls[0][0]).toContain(`user_id=eq.${USER.id}`);
  expect(auth.authQuery.mock.calls[0][0]).not.toContain("token_hash");
});

test("revoking marks the key revoked for this account only; a key that is not theirs is a 404", async () => {
  auth.authQuery.mockResolvedValueOnce([{ id: KEY_ID }]);
  expect((await DELETE(call("DELETE", `?id=${KEY_ID}`))).status).toBe(200);
  const [path, init] = auth.authQuery.mock.calls[0];
  expect(path).toContain(`id=eq.${KEY_ID}`);
  expect(path).toContain(`user_id=eq.${USER.id}`);
  expect(path).toContain("revoked_at=is.null");
  expect(init.method).toBe("PATCH");
  expect(Object.keys(JSON.parse(init.body))).toEqual(["revoked_at"]);
  auth.authQuery.mockResolvedValueOnce([]);
  expect((await DELETE(call("DELETE", `?id=${KEY_ID}`))).status).toBe(404);
  expect((await DELETE(call("DELETE", "?id=not-a-uuid"))).status).toBe(400);
});

test("a revoke this account cannot make answers the exact 404 the keys list recognises as no longer on its list", async () => {
  auth.authQuery.mockResolvedValueOnce([]);
  const res = await DELETE(call("DELETE", `?id=${KEY_ID}`));
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ ok: false, error: NO_LIVE_KEY });
});

const FORM = { label: " Drop rates ", purpose: " A sheet for my guild ", scopes: [] as string[], expiresInDays: 90 };
const storageFailed = (status: number) => new Error(`Authentication storage failed (${status})`);

test("the create form's key: name, purpose, scopes and expiry go to issue_api_key; the key is shown once", async () => {
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
  auth.authQuery.mockResolvedValue([{ key_ref: KEY_ID, refusal: null }]);
  const before = Date.now();
  const res = await POST(call("POST", "", { ...FORM, scopes: ["read:own"] }));
  expect(res.status).toBe(201);
  const made = await res.json();
  expect(made.token).toMatch(KEY_PATTERN);
  const [path, init] = auth.authQuery.mock.calls[0];
  expect(path).toBe("rpc/issue_api_key");
  const sent = JSON.parse(init.body);
  expect(sent).toMatchObject({ p_user_id: USER.id, p_token_hash: hashKey(made.token), p_hint: made.token.slice(-4), p_label: "Drop rates",
    p_purpose: "A sheet for my guild", p_scopes: ["read:public", "read:own"] });
  expect(init.body).not.toContain(made.token);
  const days = (Date.parse(sent.p_expires_at) - before) / 86_400_000;
  expect(days).toBeGreaterThan(89.99);
  expect(days).toBeLessThan(90.01);
  expect(made.expires_at).toBe(sent.p_expires_at);
});

test("the create form is checked on the server: a name, a purpose, scopes that exist and an allowed expiry", async () => {
  const refused = async (body: object) => {
    const res = await POST(call("POST", "", body));
    expect(res.status).toBe(400);
    return (await res.json()).error as string;
  };
  expect(await refused({ ...FORM, label: "  " })).toContain("name");
  expect(await refused({ ...FORM, purpose: "\u0007 " })).toContain("what the key is for");
  expect(await refused({ ...FORM, scopes: ["write:everything"] })).toContain("does not exist");
  // read:own exists only while saved builds are on.
  expect(await refused({ ...FORM, scopes: ["read:own"] })).toContain("does not exist");
  expect(await refused({ ...FORM, expiresInDays: 3650 })).toContain("expires");
  expect(await refused({ ...FORM, expiresInDays: undefined })).toContain("expires");
  expect(await refused({ ...FORM, expiresInDays: undefined, expiresOn: "2020-01-01" })).toContain("after today");
  expect(await refused({ ...FORM, expiresInDays: undefined, expiresOn: "2999-01-01" })).toContain("a year at most");
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("a custom date makes the key work through the end of that UTC day", async () => {
  auth.authQuery.mockResolvedValue([{ key_ref: KEY_ID, refusal: null }]);
  const date = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  expect((await POST(call("POST", "", { ...FORM, expiresInDays: undefined, expiresOn: date }))).status).toBe(201);
  expect(JSON.parse(auth.authQuery.mock.calls[0][1].body).p_expires_at).toBe(`${date}T23:59:59.999Z`);
});

test("rolling keeps the key's settings in the database and shows the new secret once", async () => {
  auth.authQuery.mockResolvedValue([{ key_ref: KEY_ID, key_expires_at: "2027-01-01T00:00:00+00:00", refusal: null }]);
  const res = await POST(call("POST", `?roll=${KEY_ID}`));
  expect(res.status).toBe(201);
  const made = await res.json();
  expect(made).toMatchObject({ ok: true, id: KEY_ID, expires_at: "2027-01-01T00:00:00+00:00" });
  const [path, init] = auth.authQuery.mock.calls[0];
  expect(path).toBe("rpc/roll_api_key");
  // Only who, which key and the new secret's hash: name, purpose, scopes and lifetime are copied by the database.
  expect(JSON.parse(init.body)).toEqual({ p_user_id: USER.id, p_id: KEY_ID, p_token_hash: hashKey(made.token), p_hint: made.token.slice(-4) });
  auth.authQuery.mockResolvedValue([{ key_ref: null, key_expires_at: null, refusal: "not_found" }]);
  expect((await POST(call("POST", `?roll=${KEY_ID}`))).status).toBe(404);
  expect((await POST(call("POST", "?roll=nope"))).status).toBe(400);
});

test("before the expiry migration: the list is read without purpose, and the form's call says so instead of making a key", async () => {
  const keys = [{ id: KEY_ID, hint: "abcd", label: "bot", scopes: ["read:public"], created_at: "2026-10-19T00:00:00Z", last_used_at: null, revoked_at: null, expires_at: null }];
  auth.authQuery.mockImplementation(async (path: string) => {
    if (path.includes(",purpose")) throw storageFailed(400);
    if (path.startsWith("rpc/issue_api_key") || path.startsWith("rpc/roll_api_key")) throw storageFailed(404);
    if (path.startsWith("rpc/create_api_key")) return [{ key_ref: KEY_ID, refusal: null }];
    return keys;
  });
  const listed = await (await GET(call("GET"))).json();
  expect(listed).toMatchObject({ ok: true, records: false, keys });
  const form = await POST(call("POST", "", FORM));
  expect(form.status).toBe(503);
  expect((await form.json()).error).toContain("not switched on yet");
  expect((await POST(call("POST", `?roll=${KEY_ID}`))).status).toBe(503);
  // The older call keeps working: the Desktop App's connect page, and the form, which has no other call yet.
  expect((await POST(call("POST", "", { label: "Everloot Desktop App" }))).status).toBe(201);
  expect((await POST(call("POST", "", { label: "bot", builds: true }))).status).toBe(201);
  // Once applied, the list says so.
  auth.authQuery.mockResolvedValue(keys.map((k) => ({ ...k, purpose: "A bot" })));
  expect(await (await GET(call("GET"))).json()).toMatchObject({ records: true, keys: [{ purpose: "A bot" }] });
  // Any other storage error is still an error, never a quiet fallback.
  auth.authQuery.mockRejectedValue(storageFailed(500));
  expect((await GET(call("GET"))).status).toBe(503);
});

test("the list offers only the scopes that exist now", async () => {
  auth.authQuery.mockResolvedValue([]);
  expect((await (await GET(call("GET"))).json()).scopes).toEqual(["read:public"]);
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
  expect((await (await GET(call("GET"))).json()).scopes).toEqual(["read:public", "read:own"]);
  expect((await POST(call("POST", "", { ...FORM, scopes: ["link:own"] }))).status).toBe(400);
  vi.stubEnv("EVERLOOT_CHARACTER_LINKS", "1");
  expect((await (await GET(call("GET"))).json()).scopes).toEqual(["read:public", "read:own", "link:own"]);
  auth.authQuery.mockResolvedValue([{ key_ref: KEY_ID, refusal: null }]);
  expect((await POST(call("POST", "", { ...FORM, scopes: ["link:own"] }))).status).toBe(201);
  expect(JSON.parse(auth.authQuery.mock.calls.at(-1)![1].body).p_scopes).toEqual(["read:public", "link:own"]);
});

test("storage trouble is a 503, never a silent success", async () => {
  auth.authQuery.mockRejectedValue(new Error("down"));
  expect((await POST(call("POST", "", {}))).status).toBe(503);
  expect((await GET(call("GET"))).status).toBe(503);
});
