import { expect, test } from "vitest";
import { createCloudArmoryStore, createMemoryArmoryStore } from "./armory-store";
import { armoryCharacter } from "./armory.fixture";

test("refresh is available after one hour, deduplicates, and never revives hidden characters", async () => {
  const store = createMemoryArmoryStore(() => new Date("2026-11-09T12:00:00Z"));
  store.putCharacter(armoryCharacter());
  expect(await store.refresh("eu", "velkara-duskmantle")).toBe("queued");
  expect(await store.refresh("eu", "velkara-duskmantle")).toBe("queued-already");
  await store.hide("eu", "velkara-duskmantle");
  expect(await store.refresh("eu", "velkara-duskmantle")).toBe("unavailable");
  store.putCharacter(armoryCharacter({ slug: "new-person", checkedAt: "2026-11-09T11:30:00Z" }));
  expect(await store.refresh("eu", "new-person")).toBe("cooldown");
});
test("the cloud refresh calls the throttled RPC", async () => {
  const calls: unknown[] = [];
  const store = createCloudArmoryStore(async (path, init) => { calls.push([path, JSON.parse(String(init?.body))]); return "queued" as never; });
  expect(await store.refresh("us", "ember-vale")).toBe("queued");
  expect(calls).toEqual([["rpc/armory_refresh", { p_region: "us", p_slug: "ember-vale" }]]);
});
