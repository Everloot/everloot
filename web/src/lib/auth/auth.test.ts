import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { memoryAdapter } from "better-auth/adapters/memory";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { authV2Enabled, createAuth, signInMethods } from "./auth";
import type { RateLimitStore } from "./db";

afterEach(() => vi.unstubAllGlobals());

const env = {
  NODE_ENV: "test",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: "https://everloot.app",
  BNET_CLIENT_ID: "client",
  BNET_CLIENT_SECRET: "secret",
} as NodeJS.ProcessEnv;

// Battle.net's discovery document advertises id-token signing, so the plugin treats it as OIDC.
const discovery = {
  issuer: "https://oauth.battle.net",
  authorization_endpoint: "https://oauth.battle.net/authorize",
  token_endpoint: "https://oauth.battle.net/token",
  userinfo_endpoint: "https://oauth.battle.net/userinfo",
  jwks_uri: "https://oauth.battle.net/jwks/certs",
  id_token_signing_alg_values_supported: ["RS256"],
};

type Userinfo = () => Response | Promise<Response>;
const thrall: Userinfo = () => Response.json({ sub: "123", id: 123, battletag: "Thrall#1" });

// Battle.net's signing key, served from the discovery document's jwks_uri.
const signing = vi.hoisted(() => ({ jwks: { keys: [] as unknown[] }, privateKey: undefined as unknown, otherKey: undefined as unknown }));
beforeAll(async () => {
  const battlenet = await generateKeyPair("RS256");
  signing.privateKey = battlenet.privateKey;
  signing.jwks = { keys: [{ ...await exportJWK(battlenet.publicKey), kid: "bnet-1", alg: "RS256", use: "sig" }] };
  signing.otherKey = (await generateKeyPair("RS256")).privateKey;
});

type IdTokenClaims = { nonce?: string; iss?: string; aud?: string; key?: "battlenet" | "other" };
function signIdToken({ nonce, iss = discovery.issuer, aud = "client", key = "battlenet" }: IdTokenClaims) {
  return new SignJWT(nonce === undefined ? {} : { nonce })
    .setProtectedHeader({ alg: "RS256", kid: "bnet-1" })
    .setIssuer(iss).setAudience(aud).setSubject("123").setIssuedAt().setExpirationTime("5m")
    .sign((key === "battlenet" ? signing.privateKey : signing.otherKey) as CryptoKey);
}

// idToken gets the nonce Better Auth put in the authorize URL; without it the token response
// carries only an access token, and there is nothing to verify against the JWKS.
function stubBattlenet(userinfo: Userinfo, idToken?: () => Promise<string>) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://oauth.battle.net/.well-known/openid-configuration") return Response.json(discovery);
    if (url === discovery.jwks_uri) return Response.json(signing.jwks);
    if (url.startsWith(discovery.token_endpoint)) {
      return Response.json({ access_token: "at", token_type: "bearer", expires_in: 86400, ...idToken ? { id_token: await idToken() } : {} });
    }
    if (url.startsWith(discovery.userinfo_endpoint)) return userinfo();
    throw new Error(`Unexpected fetch: ${url}`);
  }));
}

// Same contract as pgRateLimitStore: a fixed window that starts at the first request.
function mapRateLimitStore() {
  const store = new Map<string, { count: number; lastRequest: number }>();
  const rateLimitStore: RateLimitStore = {
    async consume(key, { window, max }) {
      const now = Date.now();
      const row = store.get(key);
      const next = !row || now - row.lastRequest >= window * 1000
        ? { count: 1, lastRequest: now }
        : { count: row.count + 1, lastRequest: row.lastRequest };
      store.set(key, next);
      if (next.count <= max) return { allowed: true, retryAfter: null };
      return { allowed: false, retryAfter: Math.ceil((next.lastRequest + window * 1000 - now) / 1000) };
    },
  };
  return { store, rateLimitStore };
}

type Row = Record<string, unknown>;

function startSignIn(auth: ReturnType<typeof createAuth>, headers: Record<string, string> = {}) {
  return auth.handler(new Request("https://everloot.app/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://everloot.app", ...headers },
    body: JSON.stringify({ provider: "battlenet", callbackURL: "/" }),
  }));
}

function cookieHeader(response: Response) {
  return response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function signInWithBattlenet(options: {
  seed?: { users?: Row[]; auth_account?: Row[] };
  userinfo?: Userinfo;
  idToken?: (authorizeNonce: string) => Promise<string>;
} = {}) {
  let authorizeNonce = "";
  const { idToken } = options;
  stubBattlenet(options.userinfo ?? thrall, idToken && (() => idToken(authorizeNonce)));
  const db: Record<string, Row[]> = {
    users: [...options.seed?.users ?? []],
    auth_session: [],
    auth_account: [...options.seed?.auth_account ?? []],
    auth_verification: [],
  };
  const { store, rateLimitStore } = mapRateLimitStore();
  const auth = createAuth({ database: memoryAdapter(db), rateLimitStore, env });
  const start = await startSignIn(auth);
  const { url } = await start.json() as { url: string };
  const state = new URL(url).searchParams.get("state");
  authorizeNonce = new URL(url).searchParams.get("nonce") ?? "";
  const response = await auth.handler(new Request(
    `https://everloot.app/api/auth/callback/battlenet?code=c&state=${encodeURIComponent(state ?? "")}`,
    { headers: { cookie: cookieHeader(start) } },
  ));
  const cookies = response.headers.getSetCookie().join("\n");
  return { cookies, db, store, response };
}

test("a Battle.net sign-in creates a session cookie and stores no provider tokens", async () => {
  const { cookies, db } = await signInWithBattlenet();
  expect(cookies).toMatch(/everloot\.session_token=/);
  // The memory adapter keeps rows under their database column names, as Postgres will.
  expect(db.auth_account[0]).toMatchObject({ provider_id: "battlenet", account_id: "123", access_token: null, refresh_token: null, id_token: null });
  expect(db.auth_session[0]).toMatchObject({ ip_address: null, user_agent: null });
});

test("a Battle.net id_token signed by the discovery JWKS, for our client and nonce, signs in", async () => {
  let sentNonce = "";
  const { cookies, db } = await signInWithBattlenet({ idToken: (nonce) => { sentNonce = nonce; return signIdToken({ nonce }); } });
  expect(sentNonce).toMatch(/.{16,}/);
  expect(cookies).toMatch(/everloot\.session_token=/);
  expect(db.auth_account[0]).toMatchObject({ provider_id: "battlenet", account_id: "123", id_token: null });
});

test.each([
  ["a different nonce", (nonce: string) => signIdToken({ nonce: `${nonce}x` })],
  ["no nonce", () => signIdToken({})],
  ["another audience", (nonce: string) => signIdToken({ nonce, aud: "someone-else" })],
  ["another issuer", (nonce: string) => signIdToken({ nonce, iss: "https://evil.example" })],
  ["a key not in the JWKS", (nonce: string) => signIdToken({ nonce, key: "other" })],
] as [string, (nonce: string) => Promise<string>][])("an id_token with %s fails the sign-in", async (_, idToken) => {
  const { cookies, db } = await signInWithBattlenet({ idToken });
  expect(cookies).not.toMatch(/session_token=/);
  expect(db.users).toEqual([]);
  expect(db.auth_session).toEqual([]);
});

const LEGACY_ID = "5f0c1f0e-6b7a-4c53-9a1e-0d4f4b2f9a11";
const legacyUser = {
  id: LEGACY_ID, name: "Thrall#1", email: "bnet-123@users.everloot.invalid",
  email_verified: false, created_at: new Date("2025-01-01"), updated_at: new Date("2025-01-01"),
};
// What the migration's backfill gives a Battle.net user, with provider tokens a legacy row could still hold.
const legacyAccount = {
  id: "a-legacy-account", user_id: LEGACY_ID, provider_id: "battlenet", account_id: "123",
  access_token: "old-at", refresh_token: "old-rt", id_token: "old-it",
  created_at: new Date("2025-01-01"), updated_at: new Date("2025-01-01"),
};

test("a legacy Battle.net account keeps its id on sign-in and its provider tokens are cleared", async () => {
  const { db } = await signInWithBattlenet({ seed: { users: [legacyUser], auth_account: [{ ...legacyAccount }] } });
  expect(db.auth_session).toHaveLength(1);
  expect(db.auth_session[0].user_id).toBe(LEGACY_ID);
  expect(db.users).toHaveLength(1);
  expect(db.auth_account).toHaveLength(1);
  expect(db.auth_account[0]).toMatchObject({ user_id: LEGACY_ID, access_token: null, refresh_token: null, id_token: null });
});

test("a legacy account is never linked by an unverified placeholder email", async () => {
  // A users row with no auth_account row: the placeholder email must not be enough to claim it.
  const { cookies, db, response } = await signInWithBattlenet({ seed: { users: [legacyUser] } });
  expect(response.headers.get("location")).toContain("error=account_not_linked");
  expect(cookies).not.toMatch(/session_token=/);
  expect(db.auth_session).toEqual([]);
  expect(db.users).toHaveLength(1);
  expect(db.auth_account).toEqual([]);
});

test.each([
  ["answers 500", () => new Response("nope", { status: 500 })],
  ["is unreachable", () => { throw new TypeError("fetch failed"); }],
] as [string, Userinfo][])("when Battle.net userinfo %s, no user or session is created", async (_, userinfo) => {
  const { cookies, db } = await signInWithBattlenet({ userinfo });
  expect(cookies).not.toMatch(/session_token=/);
  expect(db.users).toEqual([]);
  expect(db.auth_account).toEqual([]);
  expect(db.auth_session).toEqual([]);
});

test("rate-limit keys are an HMAC under the auth secret, never the address or its plain hash", async () => {
  stubBattlenet(thrall);
  const { store, rateLimitStore } = mapRateLimitStore();
  const db = { users: [], auth_session: [], auth_account: [], auth_verification: [] };
  const auth = createAuth({ database: memoryAdapter(db), rateLimitStore, env });
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) statuses.push((await startSignIn(auth, { "x-forwarded-for": "203.0.113.9" })).status);
  expect(statuses).toEqual([200, 200, 200, 429, 429]);
  const raw = "203.0.113.9|/sign-in/social";
  // Without the secret, anyone could hash every IPv4 address and read the table back.
  expect([...store.keys()]).toEqual([createHmac("sha256", env.BETTER_AUTH_SECRET ?? "").update(raw).digest("hex")]);
  expect(store.has(createHash("sha256").update(raw).digest("hex"))).toBe(false);
  expect(JSON.stringify([...store])).not.toContain("203.0.113.9");
});

test("without BETTER_AUTH_SECRET there is no auth, so rate-limit keys are never an HMAC under an empty key", () => {
  const db = { users: [], auth_session: [], auth_account: [], auth_verification: [] };
  // AUTH_SECRET alone would satisfy Better Auth but not the limiter's key.
  for (const secret of [undefined, "", " "]) {
    expect(() => createAuth({ database: memoryAdapter(db), rateLimitStore: mapRateLimitStore().rateLimitStore, env: { ...env, BETTER_AUTH_SECRET: secret, AUTH_SECRET: "test-secret-that-is-at-least-32-characters" } }))
      .toThrow("BETTER_AUTH_SECRET is not set");
  }
});

test("on the Worker the limiter keys on cf-connecting-ip, so a forged or multi-valued X-Forwarded-For shares nothing", async () => {
  stubBattlenet(thrall);
  const { rateLimitStore } = mapRateLimitStore();
  const db = { users: [], auth_session: [], auth_account: [], auth_verification: [] };
  const auth = createAuth({ database: memoryAdapter(db), rateLimitStore, env: { ...env, EVERLOOT_PLATFORM: "cloudflare" } });
  const statuses: number[] = [];
  // One caller rotating X-Forwarded-For (sometimes a chain) is still one caller.
  for (const xff of ["198.51.100.1", "198.51.100.2", "198.51.100.3, 10.0.0.1", "198.51.100.4"]) {
    statuses.push((await startSignIn(auth, { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": xff })).status);
  }
  expect(statuses).toEqual([200, 200, 200, 429]);
  // A different caller behind the same proxy chain gets its own bucket.
  expect((await startSignIn(auth, { "cf-connecting-ip": "203.0.113.10", "x-forwarded-for": "198.51.100.3, 10.0.0.1" })).status).toBe(200);
});

test("an empty BETTER_AUTH_URL falls back to the site URL", async () => {
  stubBattlenet(thrall);
  const db = { users: [], auth_session: [], auth_account: [], auth_verification: [] };
  const auth = createAuth({ database: memoryAdapter(db), rateLimitStore: mapRateLimitStore().rateLimitStore, env: { ...env, BETTER_AUTH_URL: " " } });
  const response = await startSignIn(auth);
  expect(response.status).toBe(200);
  const { url } = await response.json() as { url: string };
  expect(new URL(url).searchParams.get("redirect_uri")).toBe("https://everloot.app/api/auth/callback/battlenet");
});

test("a sign-in start keeps its state in a cookie and writes no database row", async () => {
  stubBattlenet(thrall);
  const db = { users: [], auth_session: [], auth_account: [], auth_verification: [] };
  const auth = createAuth({ database: memoryAdapter(db), rateLimitStore: mapRateLimitStore().rateLimitStore, env });
  const response = await startSignIn(auth);
  expect(response.status).toBe(200);
  expect(response.headers.getSetCookie().join(";")).toMatch(/everloot.oauth_state=/);
  expect(db.auth_verification).toEqual([]);
});

// /api/auth/bnet passes only paths that safeReturnTo accepts (lib/auth/return-to.ts); this checks Better Auth takes them.
test("a sign-in may return to a page on this site with its query (Save in the calculator)", async () => {
  stubBattlenet(thrall);
  const db = { users: [], auth_session: [], auth_account: [], auth_verification: [] };
  const auth = createAuth({ database: memoryAdapter(db), rateLimitStore: mapRateLimitStore().rateLimitStore, env });
  const start = (callbackURL: string) => auth.handler(new Request("https://everloot.app/api/auth/sign-in/social", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://everloot.app" },
    body: JSON.stringify({ provider: "battlenet", callbackURL }),
  }));
  expect((await start("/tools/talents/mage?save=1")).status).toBe(200);
});

test("Battle.net is not offered unless both its client id and secret are set", async () => {
  stubBattlenet(thrall);
  const db = { users: [], auth_session: [], auth_account: [], auth_verification: [] };
  const { rateLimitStore } = mapRateLimitStore();
  const auth = createAuth({ database: memoryAdapter(db), rateLimitStore, env: { ...env, BNET_CLIENT_SECRET: " " } });
  const response = await startSignIn(auth);
  expect(response.status).toBe(404);
});

test("authV2Enabled is only on for exactly 1", () => {
  expect(authV2Enabled({ EVERLOOT_AUTH_V2: "1" })).toBe(true);
  expect(authV2Enabled({ EVERLOOT_AUTH_V2: "true" })).toBe(false);
  expect(authV2Enabled({})).toBe(false);
});

const emailEnv = { ...env, RESEND_API_KEY: "re_test", EMAIL_FROM: "Everloot <hello@everloot.app>" } as NodeJS.ProcessEnv;

// Resend is the only outside call the email flow makes; the mail it would send is kept here.
function stubResend(status = 200) {
  const sent: Array<{ from: string; to: string[]; subject: string; text: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== "https://api.resend.com/emails") throw new Error(`Unexpected fetch: ${url}`);
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "mail" }, { status });
  }));
  return sent;
}

function emailAuth(authEnv = emailEnv) {
  const db: Record<string, Row[]> = { users: [], auth_session: [], auth_account: [], auth_verification: [] };
  return { db, auth: createAuth({ database: memoryAdapter(db), rateLimitStore: mapRateLimitStore().rateLimitStore, env: authEnv }) };
}

function post(auth: ReturnType<typeof createAuth>, path: string, body: object) {
  return auth.handler(new Request(`https://everloot.app/api/auth${path}`, {
    method: "POST", headers: { "content-type": "application/json", origin: "https://everloot.app" }, body: JSON.stringify(body),
  }));
}

const jaina = { name: "Jaina", email: "jaina@example.com", password: "kul-tiras-forever", callbackURL: "/account" };

test("an email sign-up sends a confirmation link and gives no session until it is used", async () => {
  const sent = stubResend();
  const { auth, db } = emailAuth();
  const response = await post(auth, "/sign-up/email", jaina);
  expect(response.status).toBe(200);
  expect(response.headers.getSetCookie().join(";")).not.toMatch(/session_token=/);
  expect(db.users[0]).toMatchObject({ email: "jaina@example.com", email_verified: false });
  // The password is hashed, never stored as typed.
  expect(db.auth_account[0]).toMatchObject({ provider_id: "credential" });
  expect(JSON.stringify(db.auth_account)).not.toContain(jaina.password);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ from: "Everloot <hello@everloot.app>", to: ["jaina@example.com"], subject: "Confirm your Everloot email" });

  // Signing in before confirming is refused.
  const early = await post(auth, "/sign-in/email", { email: jaina.email, password: jaina.password });
  expect(early.status).toBe(403);

  // The link in the mail confirms the email and signs in.
  const link = sent[0].text.match(/https:\/\/\S+/)?.[0] ?? "";
  expect(link).toContain("/api/auth/verify-email?token=");
  const verified = await auth.handler(new Request(link));
  expect(verified.headers.getSetCookie().join(";")).toMatch(/everloot\.session_token=/);
  expect(db.users[0]).toMatchObject({ email_verified: true });
  expect((await post(auth, "/sign-in/email", { email: jaina.email, password: jaina.password })).status).toBe(200);
});

test("a password reset mails a link, and the new password replaces the old one", async () => {
  const sent = stubResend();
  const { auth, db } = emailAuth();
  await post(auth, "/sign-up/email", jaina);
  await auth.handler(new Request(sent[0].text.match(/https:\/\/\S+/)?.[0] ?? ""));

  expect((await post(auth, "/request-password-reset", { email: jaina.email, redirectTo: "/reset-password" })).status).toBe(200);
  expect(sent[1]).toMatchObject({ to: ["jaina@example.com"], subject: "Reset your Everloot password" });
  const link = sent[1].text.match(/https:\/\/\S+/)?.[0] ?? "";
  const landing = await auth.handler(new Request(link));
  const token = new URL(landing.headers.get("location") ?? "", "https://everloot.app").searchParams.get("token");
  expect(token).toBeTruthy();

  expect((await post(auth, "/reset-password", { newPassword: "boralus-harbour-1", token })).status).toBe(200);
  expect((await post(auth, "/sign-in/email", { email: jaina.email, password: jaina.password })).status).toBe(401);
  expect((await post(auth, "/sign-in/email", { email: jaina.email, password: "boralus-harbour-1" })).status).toBe(200);
  // Sessions from before the reset are ended.
  expect(db.auth_session).toHaveLength(1);
});

test("nobody can sign up with a Battle.net placeholder address", async () => {
  const sent = stubResend();
  const { auth, db } = emailAuth();
  const response = await post(auth, "/sign-up/email", { ...jaina, email: "bnet-999@users.everloot.invalid" });
  expect(response.status).toBe(400);
  expect(db.users).toEqual([]);
  expect(sent).toEqual([]);
});

test("email sign-up is off without a Resend key, so no unverifiable account is made", async () => {
  const sent = stubResend();
  const { auth, db } = emailAuth(env);
  const response = await post(auth, "/sign-up/email", jaina);
  expect(response.ok).toBe(false);
  expect(db.users).toEqual([]);
  expect(sent).toEqual([]);
});

test("a sign-up whose confirmation mail Resend refuses makes no session", async () => {
  stubResend(500);
  const { auth } = emailAuth();
  const response = await post(auth, "/sign-up/email", jaina);
  expect(response.headers.getSetCookie().join(";")).not.toMatch(/session_token=/);
});

test("signInMethods offers email only with the Better Auth flag and a mail sender", () => {
  expect(signInMethods({ ...emailEnv, EVERLOOT_AUTH_V2: "1" })).toEqual({ battlenet: true, email: true });
  expect(signInMethods(emailEnv)).toEqual({ battlenet: true, email: false });
  expect(signInMethods({ EVERLOOT_AUTH_V2: "1", RESEND_API_KEY: "re_test" })).toEqual({ battlenet: false, email: false });
});

// The account switcher: Better Auth's multi-session plugin, as /api/me/accounts and /api/auth/logout use it.
test("two accounts signed in on one browser: both are listed, either can be current, signing out one keeps the other", async () => {
  const sent = stubResend();
  const { auth } = emailAuth();
  const thrall = { ...jaina, name: "Thrall", email: "thrall@example.com" };
  for (const person of [jaina, thrall]) {
    await post(auth, "/sign-up/email", person);
    await auth.handler(new Request(sent.at(-1)!.text.match(/https:\/\/\S+/)?.[0] ?? ""));
  }
  // One browser: a cookie jar that keeps what each response sets.
  const jar = new Map<string, string>();
  const keep = (response: Response) => {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair, ...attributes] = cookie.split(";");
      const [name, value] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)];
      if (!value || attributes.some((a) => /max-age=0/i.test(a.trim()))) jar.delete(name); else jar.set(name, value);
    }
  };
  const headers = () => new Headers({ cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), origin: "https://everloot.app" });
  const signIn = async (person: typeof jaina) => keep(await auth.handler(new Request("https://everloot.app/api/auth/sign-in/email", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://everloot.app", cookie: headers().get("cookie") ?? "" },
    body: JSON.stringify({ email: person.email, password: person.password }),
  })));
  await signIn(jaina);
  await signIn(thrall);

  const names = async () => (await auth.api.listDeviceSessions({ headers: headers() })).map((s) => s.user.name).sort();
  const current = async () => (await auth.api.getSession({ headers: headers() }))?.user.name;
  expect(await names()).toEqual(["Jaina", "Thrall"]);
  expect(await current()).toBe("Thrall");

  const jainaToken = (await auth.api.listDeviceSessions({ headers: headers() })).find((s) => s.user.name === "Jaina")!.session.token;
  keep(await auth.api.setActiveSession({ headers: headers(), body: { sessionToken: jainaToken }, asResponse: true }));
  expect(await current()).toBe("Jaina");

  // Signing out of the current account only: Thrall becomes current and is still signed in.
  const out = await auth.api.revokeDeviceSession({ headers: headers(), body: { sessionToken: jainaToken }, asResponse: true });
  expect(out.ok).toBe(true);
  keep(out);
  expect(await current()).toBe("Thrall");
  expect(await names()).toEqual(["Thrall"]);
});
