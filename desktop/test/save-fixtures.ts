// Account files for the save facts tests: read on the main thread (save-facts.test.ts) and by the save reader
// (save-reader.test.ts), which must read each one the same way.

export const save = (realm: string) => `EverlootDB = { ["version"] = "0.3.14", ["installId"] = "x", ["records"] = {},
  ["lastScans"] = { ["${realm}"] = { ["at"] = "2026-10-18T00:00:00Z" } },
  ["asks"] = { { ["id"] = "ask:1", ["question"] = "Thrall", ["askedAt"] = "2026-10-18T00:00:00Z" } } }`;

const gold = (character: string, realm: string, copper: number) =>
  `{ ["character"] = "${character}", ["realm"] = "${realm}", ["capturedAt"] = "2026-10-18T10:00:00Z", ["currentCopper"] = ${copper}, ["peakCopper"] = ${copper} }`;

export const CHARACTERS = `EverlootDB = { ["version"] = "0.3.14", ["installId"] = "x", ["records"] = {
    ["gold_snapshot"] = { ${gold("Arthas", "Doomhowl", 10)}, ${gold("Jaina", "Nightslayer", 900)}, ${gold("Arthas", "Doomhowl", 50)} },
    ["money_event"] = { { ["character"] = "Thrall", ["realm"] = "Skull Rock", ["capturedAt"] = "2026-10-18T10:00:00Z", ["category"] = "loot", ["copper"] = 5 } } },
    ["lastScans"] = { ["Nightslayer"] = { ["at"] = "2026-10-18T00:00:00Z" } } }`;

export const NO_INSTALL = `EverlootDB = { ["version"] = "0.3.14", ["records"] = { ["gold_snapshot"] = { ${gold("Arthas", "Doomhowl", 10)} } } }`;

export const BROKEN = `EverlootDB = { ["version"] = `;

export const DB = `EverlootDB = { ["version"] = "0.3.3", ["installId"] = "inst-1", ["clientBuild"] = "1.60.1.70450",
  ["records"] = { ["loot"] = { { ["sourceNpcId"] = 7 }, { ["sourceNpcId"] = 8 } }, ["npc_sighting"] = { { ["npcId"] = 1 } }, ["drop"] = {} },
  ["asks"] = { { ["id"] = "ask:inst-1:1", ["question"] = "what drops bindings", ["askedAt"] = "2026-10-18T00:00:00Z" } },
  ["lastScans"] = { ["Nightslayer"] = { ["at"] = "2026-10-18T00:00:00Z" }, ["Doomhowl"] = { ["at"] = "2026-10-19T00:00:00Z" } } }`;

/** Files the upload reads, refuses or cannot parse, by what is odd about them. */
export const UPLOAD_TEXTS: Record<string, string> = {
  whole: DB,
  "semicolon and comment after": `-- saved\n${DB};\n-- end\n`,
  "text after": `${DB}\nprint("x")`,
  "text before": `x = 1\n${DB}`,
  "no installId": `EverlootDB = { ["version"] = "0.3.3", ["records"] = {} }`,
  "records not a table": `EverlootDB = { ["version"] = "0.3.3", ["installId"] = "i", ["records"] = "no" }`,
  "group not a list": `EverlootDB = { ["version"] = "0.3.3", ["installId"] = "i", ["records"] = { ["loot"] = 5 } }`,
  "a non-row": `EverlootDB = { ["version"] = "0.3.3", ["installId"] = "i", ["records"] = { ["loot"] = { 5 } } }`,
  "rows beside the groups": `EverlootDB = { ["version"] = "0.3.3", ["installId"] = "i", ["records"] = { { ["a"] = 1 }, ["loot"] = { { ["b"] = 1 } } } }`,
  "empty records": `EverlootDB = { ["version"] = "0.3.3", ["installId"] = "inst-1", ["records"] = {} }`,
  "empty table": `EverlootDB = {}`,
  broken: BROKEN,
};
