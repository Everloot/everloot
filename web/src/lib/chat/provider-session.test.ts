import { expect, test } from "vitest";
import { PROVIDERS } from "./store";
import { providerSession } from "./provider-session";

function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test("moves remembered provider keys into this tab without touching conversation history", () => {
  const persistent = memory(), tab = memory();
  persistent.setItem(PROVIDERS, "saved-provider-credentials");
  persistent.setItem("everloot.chat.conversations.v1", "history");
  expect(providerSession(persistent, tab)).toBe(tab);
  expect(tab.getItem(PROVIDERS)).toBe("saved-provider-credentials");
  expect(persistent.getItem(PROVIDERS)).toBeNull();
  expect(persistent.getItem("everloot.chat.conversations.v1")).toBe("history");
  expect(providerSession(persistent, memory()).getItem(PROVIDERS)).toBeNull();
});

test("keeps this tab's choices when older remembered credentials exist", () => {
  const persistent = memory(), tab = memory();
  persistent.setItem(PROVIDERS, "old"); tab.setItem(PROVIDERS, "current");
  providerSession(persistent, tab);
  expect(tab.getItem(PROVIDERS)).toBe("current");
  expect(persistent.getItem(PROVIDERS)).toBeNull();
});

test("does not delete remembered keys if the tab cannot store their replacement", () => {
  const persistent = memory(), tab = memory();
  persistent.setItem(PROVIDERS, "old");
  tab.setItem = () => { throw new Error("Storage unavailable"); };
  expect(() => providerSession(persistent, tab)).toThrow("Storage unavailable");
  expect(persistent.getItem(PROVIDERS)).toBe("old");
});
