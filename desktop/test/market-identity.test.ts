import { expect, test } from "vitest";
import { collectCharacters } from "../src/main/characters";

test("named character summaries retain the full ruleset realm", () => {
  const rows = ["PVE", "PVP", "RP", "RPPVP"].map((ending, i) => ({ kind: "gold_snapshot",
    character: "Thrall", realm: `CAMWOW US1 Realm 4 ${ending}`, installId: "install-a",
    currentCopper: 100 + i, peakCopper: 100 + i, capturedAt: "2026-11-10T10:00:00Z" }));
  expect(collectCharacters(rows).characters).toHaveLength(4);
});

test("named summaries keep separate roster identities with identical names", () => {
  const roster = {
    "00000001": { name: "Thrall", realm: "CAMWOW US1 Realm 4 PVP" },
    "00000002": { name: "Thrall", realm: "CAMWOW US1 Realm 4 PVP" },
  };
  const ledger = { events: [
    { key: "00000001", at: 1794304800, category: "loot", copper: 100 },
    { key: "00000002", at: 1794304800, category: "loot", copper: 900 },
  ] };
  const rows = collectCharacters([], { roster, ledger }).characters;
  expect(rows.map((c) => [c.id, c.character, c.earned.loot])).toEqual([["key:00000001", "Thrall", 100], ["key:00000002", "Thrall", 900]]);
});

test("records join the one roster key that names them; with two keys of that name they stay apart by install", () => {
  const gold = (installId: string, copper: number) => ({ kind: "gold_snapshot", installId, character: "Thrall",
    realm: "CAMWOW US1 Realm 4 PVP", currentCopper: copper, peakCopper: copper, capturedAt: "2026-11-10T10:00:00Z" });
  const one = { roster: { "00000001": { name: "Thrall", realm: "CAMWOW US1 Realm 4 PVP" } },
    ledger: { events: [{ key: "00000001", at: 1794304800, category: "loot", copper: 100 }] } };
  expect(collectCharacters([gold("install-a", 500)], one).characters.map((c) => [c.id, c.gold, c.earned.loot])).toEqual([["key:00000001", 500, 100]]);
  // Two installs' records, no roster: two rows, never one summed under the name.
  const apart = collectCharacters([gold("install-a", 500), gold("install-b", 700)]).characters;
  expect(apart.map((c) => c.id).sort()).toEqual(["install:install-a\0Thrall\0CAMWOW US1 Realm 4 PVP", "install:install-b\0Thrall\0CAMWOW US1 Realm 4 PVP"]);
  expect(apart.map((c) => c.gold).sort()).toEqual([500, 700]);
});
