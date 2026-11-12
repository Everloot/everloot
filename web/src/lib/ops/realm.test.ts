import { expect, it } from "vitest";
import { opsRealmLabel } from "./realm";

it("shortens only recognized recorded realm names", () => {
  expect(opsRealmLabel("CAMWOW US1 Realm 4 PvP")).toEqual({ label: "US1 · Realm 4", ruleset: "PvP" });
  expect(opsRealmLabel("CAMWOW EU1 Realm 2 PvE")).toEqual({ label: "EU1 · Realm 2", ruleset: "PvE" });
  expect(opsRealmLabel("Unknown Realm PvP")).toEqual({ label: "Unknown Realm PvP", ruleset: null });
});
