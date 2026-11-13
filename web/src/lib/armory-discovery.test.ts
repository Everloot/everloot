import { afterEach, expect, test, vi } from "vitest";
import { playerUpsert, type PlayerRow } from "./player-pages";
import { createCloudPlayerStore } from "./player-store";

afterEach(() => vi.unstubAllEnvs());
test("named upload surnames reach the atomic armory-discovery write", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response("1"));
  const row = playerUpsert({ kind: "player_seen", installId: "test-install", capturedAt: "2026-11-12T12:00:00Z", name: "Ember", surname: "Vale", realm: "US1 Realm 4 PvP", race: "Troll", class: "WARLOCK", level: 26 } as PlayerRow, new Date("2026-11-12T13:00:00Z"));
  await createCloudPlayerStore("https://storage.test", "test-key", fetcher).upsert([row]);
  expect(fetcher.mock.calls[0]?.[0]).toBe("https://storage.test/rest/v1/rpc/upsert_players_armory");
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).p_rows[0]).toMatchObject({ surname: "Vale", seen: "2026-11-12" });
});
test("turning the armory off keeps the existing player-only write", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "");
  const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response("1"));
  await createCloudPlayerStore("https://storage.test", "test-key", fetcher).upsert([{ name: "Ember", realm: "US1 Realm 4 PvP", race: "Troll", class: "WARLOCK", level: 26, seen: "2026-11-12" }]);
  expect(fetcher.mock.calls[0]?.[0]).toBe("https://storage.test/rest/v1/rpc/upsert_players");
});
