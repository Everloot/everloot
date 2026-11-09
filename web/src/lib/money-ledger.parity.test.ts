import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { summarizeMoney } from "./money-ledger";

// The same events the addon's ledger_contract.py feeds through E.Ledger: both sides must reach these totals.
type Fixture = {
  now: string;
  events: { at: string; character: string; realm: string; category: string; copper: number }[];
  expected: { categories: { category: string; direction: string; copper: number; events: number }[]; week: { in: number; out: number; net: number } };
};
const fixture: Fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../addon/tests/fixtures/ledger-parity.json"), "utf8"));

test("the web ledger gives the totals the addon's ledger is held to", () => {
  const records = fixture.events.map((e) => ({
    kind: "money_event", installId: "i", character: e.character, realm: e.realm, category: e.category, copper: e.copper, capturedAt: e.at,
  }));
  const ledger = summarizeMoney(records, Date.parse(fixture.now));
  expect(ledger.categories).toEqual(fixture.expected.categories);
  expect(ledger.week).toEqual(fixture.expected.week);
});
