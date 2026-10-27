import { describe, expect, test } from "vitest";
import { LuaParseError, parseEverlootLua, parseEverlootTable } from "./sv-parse.js";

const SV = `-- Everloot export
EverlootDB = {
  version = "0.1.0",
  installId = "abcd-1234",
  toggles = { openworld = true, guild = false },
  records = {
    npc_sighting = {
      {
        capturedAt = "2026-09-30T10:00:00.000Z",
        npcId = 1234,
        name = "Forest Spider",
        mapId = 141,
        x = 42.5,
        y = 61.0,
        level = 60,
        reaction = "hostile",
      },
      {
        capturedAt = "2026-09-30T10:05:00.000Z",
        npcId = 99,
        name = "Boar \\"Boss\\"",
        mapId = 1,
        x = 50, y = 50,
        level = 5,
        reaction = "neutral",
        note = nil,
      },
    },
    ["loot"] = {
      [1] = {
        capturedAt = "2026-09-30T10:01:00.000Z",
        sourceNpcId = 1234,
        items = { { itemId = 456, count = 2 } },
      },
    },
  },
};
`;

describe("SavedVariables parser", () => {
  test("parses a realistic Everloot.lua into intake rows", () => {
    const f = parseEverlootLua(SV);
    expect(f.version).toBe("0.1.0");
    expect(f.installId).toBe("abcd-1234");
    expect(f.records).toHaveLength(3);
    expect(f.records[0]).toMatchObject({ kind: "npc_sighting", npcId: 1234, name: "Forest Spider", installId: "abcd-1234" });
    expect(f.records[1]).toMatchObject({ name: 'Boar "Boss"' });
    expect(f.records[1]).not.toHaveProperty("note"); // nil skipped
    expect(f.records[2]).toMatchObject({ items: [{ itemId: 456, count: 2 }] });
  });

  test("an empty item list is a kill that dropped nothing, and an empty kind adds no rows", () => {
    const text = `EverlootDB = { version = "0.1.0", installId = "abcd-1234", records = { loot = { { sourceNpcId = 7, items = {} } }, quest = {} } }`;
    const f = parseEverlootLua(text);
    expect(f.records).toHaveLength(1);
    expect(f.records[0]).toMatchObject({ kind: "loot", sourceNpcId: 7, items: [] });
  });

  test("the client build comes along when the addon wrote one (0.2.6+)", () => {
    const text = `EverlootDB = { version = "0.2.6", installId = "abcd-1234", clientBuild = "1.60.1.70450", records = {} }`;
    expect(parseEverlootLua(text).clientBuild).toBe("1.60.1.70450");
    expect(parseEverlootLua(SV)).not.toHaveProperty("clientBuild");
  });

  test("a row's kind is the table it is in: a field of the row cannot change it", () => {
    const text = `EverlootDB = { version = "0.3.12", installId = "abcd-1234", records = {
      census_seen = { { kind = "gold_snapshot", character = "Arthas", realm = "Forever", capturedAt = "2026-10-27T00:00:00Z" } },
    } }`;
    expect(parseEverlootLua(text).records).toEqual([
      { kind: "census_seen", installId: "abcd-1234", character: "Arthas", realm: "Forever", capturedAt: "2026-10-27T00:00:00Z" },
    ]);
  });

  test("the file is the export and nothing else: whitespace, comments and a semicolon around it, never other text", () => {
    expect(parseEverlootLua(`${SV}\n-- written by the game\n\n`).records).toHaveLength(3);
    expect(parseEverlootLua(`\n\n${SV.replace("};", "}")}`).records).toHaveLength(3);
    const commentedOut = `-- EverlootDB = { version = "0.1.0", installId = "abcd-1234", records = {} }\n`;
    for (const text of [`${SV}\nthis is not valid Lua !!!`, `${SV}\nEverlootOther = {}`, `garbage\n${SV}`, `x${SV.replace("-- Everloot export\n", "")}`, `${SV};`, commentedOut]) {
      expect(() => parseEverlootLua(text), JSON.stringify(text.slice(-30))).toThrow(LuaParseError);
    }
  });

  test("rejects non-exports and malformed tables", () => {
    expect(() => parseEverlootLua("x = 1")).toThrow(LuaParseError);
    expect(() => parseEverlootLua("EverlootDB = { version = ")).toThrow(LuaParseError);
    expect(() => parseEverlootLua('EverlootDB = { version = "0.1.0" }')).toThrow(LuaParseError);
  });
});

test("the whole table is readable for fields beyond records, such as /ask questions", () => {
  const table = parseEverlootTable(`EverlootDB = {
["version"] = "0.2.3", ["installId"] = "abcd-1234", ["records"] = {},
["asks"] = { {["id"] = "ask:1", ["question"] = "Who is Thrall?", ["askedAt"] = "2026-10-09T00:00:00Z"} },
}`);
  expect(table.asks).toEqual([{ id: "ask:1", question: "Who is Thrall?", askedAt: "2026-10-09T00:00:00Z" }]);
  expect(() => parseEverlootTable("not lua")).toThrow(LuaParseError);
});

test("census rows become intake records in the census wire shape, field for field", () => {
  // As the game writes addon/modules/census.lua's rows back to the file.
  const text = `EverlootDB = {
["version"] = "0.3.3", ["installId"] = "abcd-1234",
["records"] = {
["census_self"] = { { ["installId"] = "abcd-1234", ["eventId"] = "census_self:2026-10-18:1", ["capturedAt"] = "2026-10-18T00:00:00Z",
  ["guid"] = "Player-4242-00AABBCC", ["race"] = "Skyborne", ["class"] = "HUNTER", ["level"] = 12, ["faction"] = "Alliance", ["realm"] = "Forever" } },
["census_seen"] = { { ["installId"] = "abcd-1234", ["eventId"] = "census_seen:2026-10-18:1", ["capturedAt"] = "2026-10-18T00:01:00Z",
  ["guid"] = "Player-4242-00000001", ["race"] = "Scourge", ["class"] = "PRIEST", ["level"] = 30, ["faction"] = "Horde", ["via"] = "mouseover" } },
},
}`;
  expect(parseEverlootLua(text).records).toEqual([
    { kind: "census_self", installId: "abcd-1234", eventId: "census_self:2026-10-18:1", capturedAt: "2026-10-18T00:00:00Z",
      guid: "Player-4242-00AABBCC", race: "Skyborne", class: "HUNTER", level: 12, faction: "Alliance", realm: "Forever" },
    { kind: "census_seen", installId: "abcd-1234", eventId: "census_seen:2026-10-18:1", capturedAt: "2026-10-18T00:01:00Z",
      guid: "Player-4242-00000001", race: "Scourge", class: "PRIEST", level: 30, faction: "Horde", via: "mouseover" },
  ]);
});
