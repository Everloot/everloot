import { afterEach, expect, test, vi } from "vitest";
const mock = vi.hoisted(() => ({ account: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/character-links-store", async (original) => ({ ...await original<typeof import("@/lib/character-links-store")>(), linkAccount: mock.account }));
vi.mock("@/lib/supabase/server", () => ({ authQuery: mock.query }));
import { POST } from "@/app/api/me/characters/[id]/armory/route";
const id = "10000000-0000-4000-8000-000000000001";
const call = (body: unknown) => POST(new Request("https://everloot.app/api/me/characters/x/armory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
test("signed-in association uses the account's own id and a validated Blizzard identity", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  mock.account.mockResolvedValue("account-one"); mock.query.mockResolvedValue(true);
  expect((await call({ armoryUrl: "https://worldofwarcraft.blizzard.com/forever/us/armory/character/ember-vale" })).status).toBe(200);
  expect(JSON.parse(mock.query.mock.calls[0][1].body)).toEqual({ p_user_id: "account-one", p_link_id: id, p_region: "us", p_slug: "ember-vale" });
  expect((await call({ armoryUrl: "https://evil.test/" })).status).toBe(400);
  expect(mock.query).toHaveBeenCalledTimes(1);
  mock.query.mockResolvedValue(false);
  expect((await call({ armoryUrl: null })).status).toBe(409);
});
test("signed-out and disabled requests never associate characters", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1"); mock.account.mockResolvedValue(new Response(null, { status: 401 }));
  expect((await call({ armoryUrl: null })).status).toBe(401);
  vi.stubEnv("EVERLOOT_ARMORY", "");
  expect((await call({ armoryUrl: null })).status).toBe(404);
  expect(mock.query).not.toHaveBeenCalled();
});
