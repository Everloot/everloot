import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readAsks } from "../src/bridge/asks";
import { className, playerLine, sourcedFor, withPlayer, type AskContext } from "../src/bridge/engine";
import { answerPending, createAnswerStore } from "../src/bridge/run";

const sv = (asks: string) => `EverlootDB = {["version"] = "0.3.4", ["installId"] = "abcd-1234-ef56-7890", ["records"] = {}, ["asks"] = {${asks}}}\n`;

test("readAsks: the class token, level and zone the addon wrote; a malformed one is left out and the question kept", () => {
  const asks = readAsks(sv(
    `{["id"] = "ask:1", ["question"] = "where is the flight master here", ["askedAt"] = "2026-10-29T10:00:00Z", ["class"] = "MAGE", ["level"] = 34, ["zone"] = "Stranglethorn Vale"},`
    + `{["id"] = "ask:2", ["question"] = "q", ["askedAt"] = "2026-10-29T10:00:00Z", ["class"] = "mage", ["level"] = 0, ["zone"] = "a|b"},`
    + `{["id"] = "ask:3", ["question"] = "q", ["askedAt"] = "2026-10-29T10:00:00Z"},`,
  ));
  expect(asks[0]!.player).toEqual({ class: "MAGE", level: 34, zone: "Stranglethorn Vale" });
  expect(asks[1]).not.toHaveProperty("player");
  expect(asks[1]!.question).toBe("q");
  expect(asks[2]).not.toHaveProperty("player");
});

test("withPlayer: 'here' is the zone and 'my class' the class, in English or Spanish; nothing known changes nothing", () => {
  const player = { class: "MAGE", level: 34, zone: "Stranglethorn Vale" };
  expect(withPlayer("where is the flight master here", player)).toBe("where is the flight master Stranglethorn Vale");
  expect(withPlayer("dónde está el flight master aquí", player)).toBe("dónde está el flight master Stranglethorn Vale");
  expect(withPlayer("best talents for my class", player)).toBe("best talents for Mage");
  expect(withPlayer("qué talentos para mi clase", player)).toBe("qué talentos para Mage");
  // "there" and "where" are not "here".
  expect(withPlayer("is there a mailbox where I am", player)).toBe("is there a mailbox where I am");
  expect(withPlayer("where is the flight master here", undefined)).toBe("where is the flight master here");
  expect(className("DEATHKNIGHT_X")).toBeUndefined();
});

test("playerLine: one line for the model, only what is known", () => {
  expect(playerLine({ class: "MAGE", level: 34, zone: "Stranglethorn Vale" })).toBe("The player asking is a level 34 Mage in Stranglethorn Vale.\n\n");
  expect(playerLine({ level: 12 })).toBe("The player asking is a level 12 player.\n\n");
  expect(playerLine(undefined)).toBe("");
});

test("sourcedFor: the lookup reads 'here' as the player's zone", async () => {
  const asked: string[] = [];
  await sourcedFor("where is the flight master here", { player: { zone: "Westfall" } }, async (q) => { asked.push(q); return { text: "", evidence: [] }; });
  expect(asked).toEqual(["where is the flight master Westfall"]);
});

test("answerPending: the engine gets who asked; the store keeps the question with its zone, never the class or level", async () => {
  const dir = mkdtempSync(join(tmpdir(), "everloot-player-"));
  const file = join(dir, "Everloot.lua");
  writeFileSync(file, sv(`{["id"] = "ask:1", ["question"] = "where is the flight master here", ["askedAt"] = "2026-10-29T10:00:00Z", ["class"] = "MAGE", ["level"] = 34, ["zone"] = "Westfall"},`));
  const seen: (AskContext | undefined)[] = [];
  const storePath = join(dir, "answers.json");
  const store = createAnswerStore(storePath);
  await answerPending({ svFile: file, addonsDir: join(dir, "AddOns"), store, engine: { answer: async (_q, context) => { seen.push(context); return { answer: "Sentinel Hill.", source: "none" }; } } });
  expect(seen[0]?.player).toEqual({ class: "MAGE", level: 34, zone: "Westfall" });
  const stored = JSON.parse(readFileSync(storePath, "utf8")) as Record<string, unknown>[];
  expect(stored[0]!.question).toBe("where is the flight master Westfall");
  expect(Object.keys(stored[0]!).sort()).toEqual(["answer", "answeredAt", "askedAt", "id", "question", "source"]);
  expect(JSON.stringify(stored)).not.toContain("MAGE");
});
