import { it, expect, vi } from "vitest";
import { ArmoryStore } from "./store.js";
it("uses the exact contract names, arguments and service authentication", async () => {
  const fetchImpl = vi.fn().mockImplementation(async () => Response.json(1));
  const store = new ArmoryStore({
    url: "https://example.test/",
    serviceKey: "test-key",
    fetchImpl,
  });
  await store.seedFromPlayers();
  await store.take("eu", "guild", 8);
  await store.character("eu", "ember-vale");
  await store.upsertCharacters("eu", []);
  await store.touch("eu", "character", ["ember-vale"]);
  await store.missing("eu", "guild", "copper-owls");
  await store.retry("eu", "character", "ember-vale", "1 hour");
  await store.purge();
  const calls = fetchImpl.mock.calls.map(([url, init]) => ({
    name: url.split("/").at(-1),
    args: JSON.parse(init.body),
  }));
  expect(calls).toEqual([
    { name: "armory_seed_from_players", args: {} },
    {
      name: "armory_take",
      args: { p_region: "eu", p_kind: "guild", p_limit: 8 },
    },
    {
      name: "armory_character",
      args: { p_region: "eu", p_slug: "ember-vale" },
    },
    { name: "armory_upsert_characters", args: { p_region: "eu", p_rows: [] } },
    {
      name: "armory_touch",
      args: { p_region: "eu", p_kind: "character", p_slugs: ["ember-vale"] },
    },
    {
      name: "armory_missing",
      args: { p_region: "eu", p_kind: "guild", p_slug: "copper-owls" },
    },
    {
      name: "armory_retry",
      args: {
        p_region: "eu",
        p_kind: "character",
        p_slug: "ember-vale",
        p_delay: "1 hour",
      },
    },
    { name: "armory_purge", args: {} },
  ]);
  expect(fetchImpl.mock.calls[0][0]).toBe(
    "https://example.test/rest/v1/rpc/armory_seed_from_players",
  );
  expect(fetchImpl.mock.calls[0][1].headers).toEqual({
    apikey: "test-key",
    Authorization: "Bearer test-key",
    "Content-Type": "application/json",
    Prefer: "return=representation",
  });
});
it("does not expose response bodies in RPC errors", async () => {
  const store = new ArmoryStore({
    url: "https://example.test",
    serviceKey: "test-key",
    fetchImpl: vi
      .fn()
      .mockResolvedValue(new Response("private data", { status: 500 })),
  });
  await expect(store.purge()).rejects.toThrow("Armory RPC HTTP 500");
});
