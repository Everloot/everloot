import { expect, test } from "vitest";
import { createToolHandlers } from "../src/mcp-server.js";
import { MCP_TOOLS } from "@everloot/protocol";
import { z } from "zod";
import type { DB } from "../src/db.js";

const date = "2026-11-06T00:00:00.000Z";
const build = "1.60.1.70450";
const rows = (fact: string, value: number, n = 3, prefix = "private") => Array.from({ length: n }, (_, i) => ({
  kind: "item_fact", itemId: 5, fact, value, installId: `${prefix}-${i}`, clientBuild: build, capturedAt: date,
  playerName: "PRIVATE PLAYER",
}));
const call = (records: unknown[], dataAsOf: string | null = date) => createToolHandlers({} as DB, {
  corpus: async () => ({ records, dataAsOf }),
}).item_page({ itemId: 5 });

test("item input stays frozen and output includes agreed numbers with evidence even without drops", async () => {
  expect(Object.keys(MCP_TOOLS.item_page.inputSchema)).toEqual(["itemId"]);
  const answer = await call([...rows("armor", 25), ...rows("stamina", -5), ...rows("damage_per_second", 12.3), ...rows("fire_resistance", 8)]);
  expect(answer).toMatchObject({ structured: { connected: true, page: { reported: { shown: [
    { fact: "armor", value: 25, reporters: 3, build, lastSeen: date },
    { fact: "damage_per_second", value: 12.3 }, { fact: "stamina", value: -5 }, { fact: "fire_resistance", value: 8 },
  ], contested: [] } } } });
  expect(typeof answer === "string" ? answer : answer.text).toContain(`25 Armor: reported by 3 installs, last seen ${date}, build ${build}`);
  const parsed = z.object(MCP_TOOLS.item_page.outputSchema).parse(typeof answer === "string" ? {} : answer.structured);
  expect(parsed.page?.reported?.shown).toHaveLength(4);
  expect(JSON.stringify(answer)).not.toMatch(/PRIVATE PLAYER|private-/);
});

test("competing winners and split votes show no value, thin and missing lines stay unknown", async () => {
  const answer = await call([...rows("armor", 987), ...rows("armor", 654, 3, "other"), ...rows("block", 321, 1), ...rows("block", 432, 2, "other"), ...rows("stamina", 543, 2)]);
  const text = typeof answer === "string" ? answer : answer.text;
  expect(text).toContain("Armor: [?]; contested");
  expect(text).toContain("Block: [?]; contested");
  // Item 5 is not in the game files, so no line is known to apply: the rest is one unknown, not one [?] per stat.
  expect(text).not.toContain("Stamina: [?]");
  expect(text).not.toContain("Mana: [?]");
  expect(text).toContain("Other numbers: [?]; none confirmed by 3 agreeing installs.");
  expect(JSON.stringify(answer)).not.toMatch(/987|654|321|432|543|private-/);
});

test("only the lines the item's class shows are listed as unknown, as on the web item page", async () => {
  const item = async (itemId: number, records: unknown[] = []) => {
    const answer = await createToolHandlers({} as DB, { corpus: async () => ({ records, dataAsOf: date }) }).item_page({ itemId });
    return typeof answer === "string" ? answer : answer.text;
  };
  // 19019 is a weapon in the game files: damage per second, no armour, block, health or mana.
  const weapon = await item(19019);
  expect(weapon).toContain("damage per second: [?]");
  expect(weapon).not.toMatch(/^(Armor|Block|Health|Mana): \[\?\]/m);
  expect(weapon).toContain("Other numbers: [?]");
  // 3242 is plate armour: armour, no damage per second or block.
  const armour = await item(3242);
  expect(armour).toContain("Armor: [?]");
  expect(armour).not.toMatch(/^(damage per second|Block|Health|Mana): \[\?\]/m);
  // A number players agree on is shown whatever the class.
  const reported = await item(19019, rows("armor", 25).map((r) => ({ ...r, itemId: 19019 })));
  expect(reported).toContain("25 Armor: reported by 3 installs");
});

test("latest vote, newest qualifying build, and unknown last seen use the page's reader", async () => {
  const answer = await call([...rows("armor", 25), ...rows("armor", 50).map((r) => ({ ...r, clientBuild: "1.60.2.70500", capturedAt: "2026-11-07T00:00:00Z" })), ...rows("armor", 75, 2).map((r) => ({ ...r, clientBuild: "1.60.3.70600" }))]);
  expect(answer).toMatchObject({ structured: { page: { reported: { shown: [{ value: 50, build: "1.60.2.70500", lastSeen: null }] } } } });
  expect(typeof answer === "string" ? answer : answer.text).toContain("last seen [?]");
});

test("repeat rows cannot confirm a value and an install's latest vote replaces its old one", async () => {
  const answer = await call([...rows("armor", 25), ...rows("armor", 90, 1).map((r) => ({ ...r, capturedAt: "2026-11-06T01:00:00Z" })), ...rows("block", 88, 1), ...rows("block", 88, 1)]);
  expect(answer).toMatchObject({ structured: { page: { reported: { shown: [], contested: ["armor"] } } } });
  expect(JSON.stringify(answer)).not.toMatch(/25 Armor|90 Armor|88 Block/);
});

test("unavailable corpus and unknown snapshot date carry explicit unknowns", async () => {
  const failed = await createToolHandlers({} as DB, { corpus: async () => { throw new Error("private error"); } }).item_page({ itemId: 5 });
  expect(failed).toMatchObject({ structured: { connected: false }, text: expect.stringContaining("Item numbers: [?]; no corpus read") });
  expect(JSON.stringify(failed)).not.toContain("private error");
  const undated = await call(rows("armor", 25), null);
  expect(undated).toMatchObject({ structured: { page: { reported: { shown: [{ lastSeen: null }] } } }, text: expect.stringContaining("Item-number data as of [?]") });
});
