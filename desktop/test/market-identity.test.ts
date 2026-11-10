import { expect, test } from "vitest";
import { collectCharacters } from "../src/main/characters";

test("named character summaries retain the full ruleset realm", () => {
  const rows = ["PVE", "PVP", "RP", "RPPVP"].map((ending, i) => ({ kind: "gold_snapshot",
    character: "Thrall", realm: `CAMWOW US1 Realm 4 ${ending}`, installId: "install-a",
    currentCopper: 100 + i, peakCopper: 100 + i, capturedAt: "2026-11-10T10:00:00Z" }));
  expect(collectCharacters(rows).characters).toHaveLength(4);
});

test.fails("owner review: named summaries must retain separate roster identities with identical names", () => {
  const roster = {
    "00000001": { name: "Thrall", realm: "CAMWOW US1 Realm 4 PVP" },
    "00000002": { name: "Thrall", realm: "CAMWOW US1 Realm 4 PVP" },
  };
  const ledger = { events: [
    { key: "00000001", at: 1794304800, category: "loot", copper: 100 },
    { key: "00000002", at: 1794304800, category: "loot", copper: 900 },
  ] };
  expect(collectCharacters([], { roster, ledger }).characters).toHaveLength(2);
});
