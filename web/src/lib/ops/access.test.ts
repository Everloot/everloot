import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => auth);
import { authorizeOps } from "./access";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const issuer = "https://ops-test.cloudflareaccess.com";
const env = {
  EVERLOOT_OPS_ACCESS_ISSUER: issuer,
  EVERLOOT_OPS_ACCESS_AUDIENCE: "ops-app",
  EVERLOOT_OPS_ACCESS_HUMAN_SUBJECTS: "operator-id",
  EVERLOOT_OPS_ACCESS_SERVICE_SUBJECTS: "service-id",
};
const request = (jwt?: string, bearer?: string) => new Request("https://everloot.app/ops", {
  headers: { ...(jwt ? { "cf-access-jwt-assertion": jwt } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
});
function token(overrides: Record<string, unknown> = {}, forged = false) {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const input = `${encode({ alg: "RS256", kid: "key1" })}.${encode({ iss: issuer, aud: ["ops-app"], sub: "operator-id", email: "operator@example.test", exp: Math.floor(Date.now() / 1000) + 60, ...overrides })}`;
  return `${input}.${forged ? "AAAA" : sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}
beforeEach(() => {
  auth.getUser.mockReset().mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "key1", alg: "RS256", use: "sig" }] })));
});
afterEach(() => vi.unstubAllGlobals());

test("missing config, anonymous requests and ordinary player sign-in fail closed", async () => {
  expect(await authorizeOps(request(), "human", {})).toBeNull();
  expect(auth.getUser).not.toHaveBeenCalled();
  auth.getUser.mockResolvedValue({ id: "player", name: "operator-id" });
  expect(await authorizeOps(request(), "human", { EVERLOOT_OPS_USER_IDS: "operator-id" })).toBeNull();
  expect(await authorizeOps(request(), "summary", env)).toBeNull();
});

test("site access uses immutable user IDs and removal revokes access", async () => {
  auth.getUser.mockResolvedValue({ id: "operator-id", name: "anything" });
  expect(await authorizeOps(request(), "human", { EVERLOOT_OPS_USER_IDS: "operator-id" })).toEqual({ kind: "human", id: "operator-id" });
  expect(await authorizeOps(request(), "summary", { EVERLOOT_OPS_USER_IDS: "operator-id" })).toEqual({ kind: "human", id: "operator-id" });
  expect(await authorizeOps(request(), "human", { EVERLOOT_OPS_USER_IDS: "someone-else" })).toBeNull();
});

test("named contributor detail requires a separate human grant", async () => {
  auth.getUser.mockResolvedValue({ id: "operator-id", name: "anything" });
  const config = { EVERLOOT_OPS_USER_IDS: "operator-id" };
  expect(await authorizeOps(request(), "contributors", config)).toBeNull();
  expect(await authorizeOps(request(), "contributors", { ...config, EVERLOOT_OPS_CONTRIBUTOR_USER_IDS: "operator-id" }))
    .toEqual({ kind: "human", id: "operator-id" });
  expect(await authorizeOps(request(token()), "contributors", env)).toBeNull();
  expect(await authorizeOps(request(token()), "contributors", { ...env, EVERLOOT_OPS_ACCESS_CONTRIBUTOR_SUBJECTS: "operator-id" }))
    .toEqual({ kind: "human", id: "operator-id" });
});

test("signed, unexpired, correct-issuer/audience Access human is allowed", async () => {
  expect(await authorizeOps(request(token()), "human", env)).toEqual({ kind: "human", id: "operator-id" });
  expect(fetch).toHaveBeenCalledWith(`${issuer}/cdn-cgi/access/certs`, expect.objectContaining({ cache: "no-store" }));
});

test("explicit issuer-attested Access email grant bootstraps a human without accepting site display names", async () => {
  const config = { ...env, EVERLOOT_OPS_ACCESS_HUMAN_SUBJECTS: "", EVERLOOT_OPS_ACCESS_HUMAN_EMAILS: "operator@example.test" };
  expect(await authorizeOps(request(token()), "human", config)).toEqual({ kind: "human", id: "operator-id" });
  expect(await authorizeOps(request(token({ email: "other@example.test" })), "human", config)).toBeNull();
  expect(await authorizeOps(request(token({ email: undefined })), "human", config)).toBeNull();
  expect(await authorizeOps(request(token({ common_name: "service-id" })), "human", config)).toBeNull();
});

test.each([
  ["forged", {}, true], ["expired", { exp: 1 }], ["missing expiry", { exp: null }],
  ["wrong audience", { aud: ["other"] }], ["wrong issuer", { iss: "https://other.cloudflareaccess.com" }],
  ["future", { nbf: 9999999999 }], ["uninvited", { sub: "ordinary" }],
])("Access %s fails closed", async (_name, claims, forged = false) => {
  expect(await authorizeOps(request(token(claims as Record<string, unknown>, forged as boolean)), "summary", env)).toBeNull();
});

test("service identities are aggregate-only, even if their sub is in the human list", async () => {
  const jwt = token({ sub: "operator-id", email: undefined, common_name: "service-id" });
  expect(await authorizeOps(request(jwt), "summary", env)).toEqual({ kind: "agent", id: "service-id" });
  expect(await authorizeOps(request(jwt), "human", env)).toBeNull();
  expect(await authorizeOps(request(jwt), "contributors", env)).toBeNull();
});

test("a malformed service marker cannot become an allowed human", async () => {
  expect(await authorizeOps(request(token({ common_name: "" })), "human", env)).toBeNull();
  expect(await authorizeOps(request(token({ common_name: null })), "human", env)).toBeNull();
});

test("invalid explicit machine credentials never fall through to an allowed site session", async () => {
  auth.getUser.mockResolvedValue({ id: "operator-id", name: "anything" });
  const config = { ...env, EVERLOOT_OPS_USER_IDS: "operator-id" };
  expect(await authorizeOps(request("forged.jwt.token"), "summary", config)).toBeNull();
  expect(await authorizeOps(request(undefined, "ordinary-public-key"), "human", config)).toBeNull();
  expect(auth.getUser).not.toHaveBeenCalled();
});

test("separate hashed agent registry grants summary only and supports immediate revocation", async () => {
  const secret = "a-long-random-agent-secret";
  const registry = { EVERLOOT_OPS_AGENT_TOKEN_HASHES: JSON.stringify({ collector: createHash("sha256").update(secret).digest("hex") }) };
  expect(await authorizeOps(request(undefined, secret), "summary", registry)).toEqual({ kind: "agent", id: "collector" });
  expect(await authorizeOps(request(undefined, secret), "human", registry)).toBeNull();
  expect(await authorizeOps(request(undefined, secret), "contributors", registry)).toBeNull();
  expect(await authorizeOps(request(undefined, secret), "summary", {})).toBeNull();
  expect(await authorizeOps(request(undefined, "ordinary-public-api-key"), "summary", registry)).toBeNull();
  expect(await authorizeOps(request(undefined, secret), "summary", { EVERLOOT_OPS_AGENT_TOKEN_HASHES: "broken" })).toBeNull();
});

test("Access verification or session storage failure never grants access", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("provider unavailable"));
  expect(await authorizeOps(request(token()), "summary", env)).toBeNull();
  auth.getUser.mockRejectedValue(new Error("storage unavailable"));
  expect(await authorizeOps(request(), "human", { EVERLOOT_OPS_USER_IDS: "operator-id" })).toBeNull();
});
