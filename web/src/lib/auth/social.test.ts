import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, expect, test, vi } from "vitest";
import { createAuth } from "./auth";
import { configuredSocialProviders } from "./social";

const env = {
  NODE_ENV: "test", EVERLOOT_AUTH_V2: "1", BETTER_AUTH_URL: "https://everloot.app",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
  GOOGLE_CLIENT_ID: "google-id", GOOGLE_CLIENT_SECRET: "google-secret",
  MICROSOFT_CLIENT_ID: "microsoft-id", MICROSOFT_CLIENT_SECRET: "microsoft-secret",
  TWITCH_CLIENT_ID: "twitch-id", TWITCH_CLIENT_SECRET: "twitch-secret",
  DISCORD_CLIENT_ID: "discord-id", DISCORD_CLIENT_SECRET: "discord-secret",
} as NodeJS.ProcessEnv;
type Row = Record<string, unknown>;
afterEach(() => vi.unstubAllGlobals());

function setup(users: Row[] = [], accounts: Row[] = [], customEnv = env) {
  const db: Record<string, Row[]> = { users, auth_account: accounts, auth_session: [], auth_verification: [] };
  const auth = createAuth({ database: memoryAdapter(db), rateLimitStore: { consume: async () => ({ allowed: true, retryAfter: null }) }, env: customEnv });
  return { auth, db };
}
const post = (auth: ReturnType<typeof createAuth>, path: string, body: object, cookie = "") => auth.handler(new Request(`https://everloot.app/api/auth${path}`, {
  method: "POST", headers: { origin: "https://everloot.app", "content-type": "application/json", cookie }, body: JSON.stringify(body),
}));
const cookies = (r: Response) => r.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");
function discordProfile(email: string | null = "player@example.com", verified = true, id = "12345") {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/oauth2/token")) return Response.json({ access_token: "private-token", refresh_token: "private-refresh", token_type: "Bearer" });
    if (decodeURIComponent(url) === "https://discord.com/api/users/@me") return Response.json({ id, username: "Thrall", email, verified, avatar: null, discriminator: "0" });
    throw new Error(`Unexpected fetch: ${url}`);
  }));
}
async function callback(auth: ReturnType<typeof createAuth>, start: Response, cookie = "") {
  const { url } = await start.json() as { url: string };
  const state = new URL(url).searchParams.get("state")!;
  return auth.handler(new Request(`https://everloot.app/api/auth/callback/discord?code=c&state=${encodeURIComponent(state)}`, { headers: { cookie: `${cookie}; ${cookies(start)}` } }));
}

test("social buttons require v2 and both nonblank credentials", () => {
  expect(configuredSocialProviders(env)).toEqual(["google", "microsoft", "twitch", "discord"]);
  expect(configuredSocialProviders({ ...env, EVERLOOT_AUTH_V2: "0" })).toEqual([]);
  expect(configuredSocialProviders({ ...env, DISCORD_CLIENT_SECRET: "  ", GOOGLE_CLIENT_ID: "" })).toEqual(["microsoft", "twitch"]);
});

test("unconfigured social providers and anonymous linking cannot create accounts", async () => {
  const off = setup([], [], { ...env, DISCORD_CLIENT_SECRET: "" });
  expect((await post(off.auth, "/sign-in/social", { provider: "discord" })).status).toBe(404);
  const { auth, db } = setup();
  expect((await post(auth, "/link-social", { provider: "discord" })).status).toBe(401);
  expect(db.auth_account).toEqual([]);
  expect(db.users).toEqual([]);
});

test("an unsolicited Discord callback creates no account or session", async () => {
  const { auth, db } = setup();
  const response = await auth.handler(new Request("https://everloot.app/api/auth/callback/discord?code=c&state=forged"));
  expect(response.headers.get("location")).toContain("state_mismatch");
  expect(db.auth_session).toEqual([]);
  expect(db.users).toEqual([]);
});

test.each([
  ["google", "accounts.google.com"], ["microsoft", "login.microsoftonline.com"],
  ["twitch", "id.twitch.tv"], ["discord", "discord.com"],
])("%s starts OAuth with its registered callback and state", async (provider, host) => {
  const { auth } = setup();
  const response = await post(auth, "/sign-in/social", { provider, callbackURL: "/me" });
  expect(response.status).toBe(200);
  const url = new URL((await response.json()).url);
  expect(url.hostname).toBe(host);
  expect(url.searchParams.get("redirect_uri")).toBe(`https://everloot.app/api/auth/callback/${provider}`);
  expect(url.searchParams.get("state")).toBeTruthy();
  if (provider === "microsoft") expect(url.pathname).toContain("/common/");
  if (provider === "discord") expect(url.searchParams.get("scope")).toBe("identify email");
});

test("Discord callback creates a session, preserves the return path and discards tokens", async () => {
  discordProfile();
  const { auth, db } = setup();
  const response = await callback(auth, await post(auth, "/sign-in/social", { provider: "discord", callbackURL: "/me?save=1" }));
  expect(response.headers.get("location")).toBe("/me?save=1");
  expect(cookies(response)).toContain("everloot.session_token=");
  expect(db.auth_account[0]).toMatchObject({ provider_id: "discord", account_id: "12345", access_token: null, refresh_token: null, id_token: null });
  expect(db.auth_session[0]).toMatchObject({ ip_address: null, user_agent: null });
});

test.each([[false, true], [true, false]])("matching emails cannot link when local verified=%s and provider verified=%s", async (localVerified, providerVerified) => {
  discordProfile("player@example.com", providerVerified);
  const { auth, db } = setup([{ id: "existing", name: "Thrall", email: "player@example.com", email_verified: localVerified }]);
  const response = await callback(auth, await post(auth, "/sign-in/social", { provider: "discord" }));
  expect(response.headers.get("location")).toContain("account_not_linked");
  expect(db.auth_account).toEqual([]);
  expect(db.auth_session).toEqual([]);
});

test("matching verified emails keep the existing user's id", async () => {
  discordProfile();
  const { auth, db } = setup([{ id: "existing", name: "Thrall", email: "player@example.com", email_verified: true }]);
  await callback(auth, await post(auth, "/sign-in/social", { provider: "discord" }));
  expect(db.users).toHaveLength(1);
  expect(db.auth_account[0].user_id).toBe("existing");
});

test("a Discord account without email makes no account or session", async () => {
  discordProfile(null);
  const { auth, db } = setup();
  const response = await callback(auth, await post(auth, "/sign-in/social", { provider: "discord" }));
  expect(response.headers.get("location")).toContain("email");
  expect(db.users).toEqual([]);
  expect(db.auth_session).toEqual([]);
});

test("a social provider cannot reserve a Battle.net placeholder address", async () => {
  discordProfile("bnet-123@users.everloot.invalid", false);
  const { auth, db } = setup();
  const response = await callback(auth, await post(auth, "/sign-in/social", { provider: "discord" }));
  expect(response.headers.get("location")).toContain("reserved_email");
  expect(db.users).toEqual([]);
  expect(db.auth_account).toEqual([]);
  expect(db.auth_session).toEqual([]);
});

test("signed-in linking can use another verified email but cannot take someone else's login", async () => {
  discordProfile();
  const { auth, db } = setup();
  const login = await callback(auth, await post(auth, "/sign-in/social", { provider: "discord" }));
  const cookie = cookies(login);
  const userId = db.users[0].id;
  discordProfile("other@example.com", true, "67890");
  await callback(auth, await post(auth, "/link-social", { provider: "discord", callbackURL: "/account" }, cookie), cookie);
  expect(db.users).toHaveLength(1);
  expect(db.auth_account).toHaveLength(2);
  expect(db.auth_account[1]).toMatchObject({ user_id: userId, account_id: "67890", access_token: null });
  // This provider identity is already owned by another Everloot user.
  db.users.push({ id: "someone-else", name: "Jaina", email: "jaina@example.com", email_verified: true });
  db.auth_account.push({ id: "taken", user_id: "someone-else", provider_id: "discord", account_id: "99999" });
  discordProfile("jaina@example.com", true, "99999");
  const response = await callback(auth, await post(auth, "/link-social", { provider: "discord" }, cookie), cookie);
  expect(response.headers.get("location")).toContain("account_already_linked_to_different_user");
  expect(db.auth_account.find((a) => a.id === "taken")?.user_id).toBe("someone-else");
});
