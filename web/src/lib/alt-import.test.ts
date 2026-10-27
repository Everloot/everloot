import { describe, expect, test } from "vitest";
import {
  ADDON_FILE_LIMIT, applyAltImport, defaultChoices, previewAltImport, readAddonFile, type AddonFile, type RowChoice,
} from "./alt-import";
import { saveAlt } from "./alt-workspace";
import { bucketKey, readWorkspace, savePlan, type LocalAlt, type Owner, type PlayerWorkspace } from "./player-workspace";

// Reading the player's own characters from their Everloot.lua, in the browser, and adding them as alts after a preview.

const ANON: Owner = { kind: "anonymous" };
const A: Owner = { kind: "account", userId: "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11" };
const NOW = new Date("2026-10-26T12:00:00.000Z");
const LATER = new Date("2026-10-27T12:00:00.000Z");
const MAGE = "EL1-mage-1482-1.60.1.70450-OTAwMDE6Miw5MDAwMjoxOjEsOTAwMDQ6Mg";
const idOf = (n: number) => `1a2b3c4d-0000-4000-8000-${String(n).padStart(12, "0")}`;

// An Everloot.lua as the game writes it back: the player's own gold, money and link rows, and the rows that name or
// count other players (census, player pages), gear and an NPC sighting, which never say who the player is.
const SV = `
EverlootDB = {
["version"] = "0.3.12",
["installId"] = "install-fixture-0001",
["clientBuild"] = "1.60.1.70450",
["records"] = {
["gold_snapshot"] = {
{ ["installId"] = "install-fixture-0001", ["eventId"] = "epoch-1:1", ["kindLoggedAt"] = "2026-10-20T10:00:00Z", ["capturedAt"] = "2026-10-20T10:00:00Z", ["character"] = "Thrall", ["realm"] = "Moon Guard", ["currentCopper"] = 50000, ["peakCopper"] = 80000 },
{ ["installId"] = "install-fixture-0001", ["eventId"] = "epoch-1:2", ["kindLoggedAt"] = "2026-10-23T10:00:00Z", ["capturedAt"] = "2026-10-23T10:00:00Z", ["character"] = "Thrall", ["realm"] = "Moon Guard", ["currentCopper"] = 125000, ["peakCopper"] = 125000 },
{ ["installId"] = "install-fixture-0001", ["eventId"] = "epoch-1:3", ["kindLoggedAt"] = "2026-10-24T08:00:00Z", ["capturedAt"] = "2026-10-24T08:00:00Z", ["character"] = "Jaina", ["realm"] = "Moon Guard", ["currentCopper"] = 2000000, ["peakCopper"] = 2500000 },
},
["money_event"] = {
{ ["installId"] = "install-fixture-0001", ["eventId"] = "epoch-1:4", ["kindLoggedAt"] = "2026-10-24T09:00:00Z", ["capturedAt"] = "2026-10-24T09:00:00Z", ["character"] = "Thrall", ["realm"] = "Moon Guard", ["category"] = "loot", ["copper"] = 1500 },
},
["character_link"] = {
{ ["installId"] = "install-fixture-0001", ["eventId"] = "character_link:1", ["capturedAt"] = "2026-10-21T18:00:00Z", ["code"] = "EL-7K3Q-9P", ["name"] = "Thrall", ["realm"] = "Moon Guard", ["race"] = "Orc", ["class"] = "SHAMAN", ["level"] = 24, ["faction"] = "Horde", ["guid"] = "Player-4395-0A1B2C3D", ["completionKey"] = "0a1b2c3d" },
},
["census_self"] = {
{ ["installId"] = "install-fixture-0001", ["eventId"] = "census_self:2026-10-18:1", ["capturedAt"] = "2026-10-18T00:00:00Z", ["guid"] = "Player-4242-00AABBCC", ["race"] = "Skyborne", ["class"] = "HUNTER", ["level"] = 12, ["faction"] = "Alliance", ["realm"] = "Forever" },
},
["census_seen"] = {
{ ["installId"] = "install-fixture-0001", ["eventId"] = "census_seen:2026-10-18:1", ["capturedAt"] = "2026-10-18T00:01:00Z", ["guid"] = "Player-4242-00000001", ["race"] = "Scourge", ["class"] = "PRIEST", ["level"] = 30, ["faction"] = "Horde", ["via"] = "mouseover" },
},
["player_seen"] = {
{ ["installId"] = "install-fixture-0001", ["eventId"] = "player_seen:1", ["capturedAt"] = "2026-10-25T00:00:00Z", ["name"] = "Arthas", ["realm"] = "Nightslayer", ["race"] = "Human", ["class"] = "PALADIN", ["level"] = 60, ["guild"] = "Silver Hand" },
{ ["installId"] = "install-fixture-0001", ["eventId"] = "player_seen:2", ["capturedAt"] = "2026-10-25T00:00:00Z", ["name"] = "Thrall", ["realm"] = "Moon Guard", ["race"] = "Orc", ["class"] = "SHAMAN", ["level"] = 25 },
},
["gear_snapshot"] = {
{ ["installId"] = "install-fixture-0001", ["eventId"] = "epoch-1:5", ["capturedAt"] = "2026-10-24T10:00:00Z", ["character"] = "Sylvanas", ["realm"] = "?", ["equipped"] = { { ["slot"] = "HeadSlot", ["itemId"] = 1, ["itemLevel"] = 60 } } },
},
["npc_sighting"] = {
{ ["installId"] = "install-fixture-0001", ["eventId"] = "epoch-1:6", ["capturedAt"] = "2026-10-24T11:00:00Z", ["npcId"] = 1234, ["name"] = "Forest Spider", ["mapId"] = 141, ["x"] = 42.5, ["y"] = 61.0 },
},
},
}
`;

/** One Lua table row as the game writes it. */
const row = (fields: Record<string, string | number>) =>
  `{ ${Object.entries(fields).map(([k, v]) => `["${k}"] = ${typeof v === "number" ? v : `"${v}"`}`).join(", ")} }`;
/** A small Everloot.lua holding these rows. */
const lua = (kinds: Record<string, Array<Record<string, string | number>>>) =>
  `EverlootDB = {\n["version"] = "0.3.12",\n["installId"] = "install-fixture-0002",\n["records"] = {\n${
    Object.entries(kinds).map(([kind, rows]) => `["${kind}"] = {\n${rows.map(row).join(",\n")},\n},`).join("\n")}\n},\n}\n`;
const gold = (character: string, realm: string, capturedAt: string) => ({ capturedAt, character, realm, currentCopper: 10, peakCopper: 10 });
const link = (name: string, realm: string, capturedAt: string, cls: string, level: number, faction: string) =>
  ({ capturedAt, code: "EL-7K3Q-9P", name, realm, race: "Orc", class: cls, level, faction, guid: "Player-4395-0A1B2C3D", completionKey: "0a1b2c3d" });

function read(text: string): Extract<AddonFile, { ok: true }> {
  const file = readAddonFile(text);
  if (!file.ok) throw new Error(file.message);
  return file;
}

/** localStorage as a map. `fail` makes every write throw as a full or a denied storage does. */
function memory(fail: "full" | "denied" | null = null) {
  const items = new Map<string, string>();
  const error = () => new DOMException(fail === "full" ? "The quota has been exceeded." : "Access is denied.", fail === "full" ? "QuotaExceededError" : "SecurityError");
  return {
    items,
    getItem: (key: string) => { if (fail === "denied") throw error(); return items.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (fail) throw error(); items.set(key, value); },
    removeItem: (key: string) => { if (fail === "denied") throw error(); items.delete(key); },
  };
}
type Memory = ReturnType<typeof memory>;

function stored(storage: Memory, owner: Owner): PlayerWorkspace {
  const result = readWorkspace(storage, owner);
  if (!result.ok) throw new Error(`read failed: ${result.error}`);
  return result.workspace;
}
const byName = (storage: Memory, owner: Owner, name: string) => stored(storage, owner).alts.filter((a) => a.name === name);

/** A stored alt in the version 2 format, written by hand. */
const alt = (over: Partial<LocalAlt> = {}): LocalAlt => ({
  id: idOf(500), name: "Thrall", realm: null, classSlug: null, faction: null, level: null, professions: [], notes: "", planIds: [],
  provenance: { source: "manual", fileRecordAt: null, fileDetails: [] }, updatedAt: "2026-10-20T12:00:00.000Z", ...over,
});
const seed = (storage: Memory, owner: Owner, alts: LocalAlt[]) => storage.items.set(bucketKey(owner),
  JSON.stringify({ format: "everloot.player-workspace", version: 2, owner, plans: [], alts, watches: [] }));

/** Previews `text` against the bucket as stored and applies it with the given choices, or the defaults. */
function importFile(storage: Memory, owner: Owner, text: string, choices?: (defaults: RowChoice[]) => RowChoice[], now = NOW) {
  const preview = previewAltImport(read(text), stored(storage, owner));
  return { preview, result: applyAltImport(storage, owner, preview, choices ? choices(defaultChoices(preview)) : defaultChoices(preview), now) };
}

describe("reading the file", () => {
  test("only the player's own named money and link records name characters: census rows, other players and gear never do", () => {
    const file = read(SV);
    expect(file.characters).toEqual([
      { name: "Jaina", realm: "Moon Guard", classSlug: null, faction: null, level: null, recordAt: "2026-10-24T08:00:00.000Z" },
      { name: "Thrall", realm: "Moon Guard", classSlug: "shaman", faction: "horde", level: 24, recordAt: "2026-10-24T09:00:00.000Z" },
    ]);
    // A player_seen row of the player's own character says level 25: it is a sighting, and is not read.
    expect(file.others).toBe(6);
    expect(file.skipped).toEqual({ noRealm: 0, unreadable: 0 });
  });

  test("nothing of the file is kept but each character's name, realm, class, faction, level and newest record time", () => {
    const file = read(SV);
    expect(Object.keys(file).sort()).toEqual(["characters", "ok", "others", "skipped"]);
    for (const c of file.characters) expect(Object.keys(c).sort()).toEqual(["classSlug", "faction", "level", "name", "realm", "recordAt"]);
    const kept = JSON.stringify(file);
    for (const raw of ["install-fixture-0001", "epoch-1", "Player-4395", "EL-7K3Q-9P", "0a1b2c3d", "Orc", "125000", "1500", "Arthas", "Sylvanas", "Forest Spider", "1.60.1.70450"]) {
      expect(kept, raw).not.toContain(raw);
    }
  });

  test("a character's class, faction and level come from its newest link record; one the site does not know stays unknown", () => {
    const file = read(lua({
      gold_snapshot: [gold("thrall", "Moon Guard", "2026-10-26T00:00:00Z"), gold("Rexxar", "Moon Guard", "2026-10-20T00:00:00Z")],
      character_link: [
        link("Thrall", "Moon Guard", "2026-10-21T18:00:00Z", "SHAMAN", 24, "Horde"),
        link("Thrall", "Moon-Guard", "2026-10-25T18:00:00Z", "SHAMAN", 31, "Horde"),
        link("Rexxar", "Moon Guard", "2026-10-22T18:00:00Z", "DEATHKNIGHT", 99, "Neutral"),
      ],
    }));
    expect(file.characters).toEqual([
      { name: "Rexxar", realm: "Moon Guard", classSlug: null, faction: null, level: null, recordAt: "2026-10-22T18:00:00.000Z" },
      // One character however its records spell it; it is named as its newest record names it.
      { name: "thrall", realm: "Moon Guard", classSlug: "shaman", faction: "horde", level: 31, recordAt: "2026-10-26T00:00:00.000Z" },
    ]);
  });

  test("records that cannot name a character are counted, never guessed: no realm, or no readable name or time", () => {
    const file = read(lua({
      gold_snapshot: [
        { capturedAt: "2026-10-20T00:00:00Z", character: "Thrall", currentCopper: 1, peakCopper: 1 },
        gold("Thrall", "", "2026-10-20T00:00:00Z"),
        gold("", "Moon Guard", "2026-10-20T00:00:00Z"),
        gold("a".repeat(61), "Moon Guard", "2026-10-20T00:00:00Z"),
        { character: "Jaina", realm: "Moon Guard", currentCopper: 1, peakCopper: 1 },
        gold("Jaina", "Moon Guard", "not a time"),
      ],
      money_event: [gold("Jaina", "Moon Guard", "2026-10-20T00:00:00Z")],
    }));
    expect(file.characters.map((c) => c.name)).toEqual(["Jaina"]);
    expect(file.skipped).toEqual({ noRealm: 2, unreadable: 4 });
  });

  test("a file with none of the player's own records reads, with no characters", () => {
    const file = read(lua({ census_seen: [{ capturedAt: "2026-10-18T00:01:00Z", guid: "Player-4242-00000001", class: "PRIEST" }] }));
    expect(file).toEqual({ ok: true, characters: [], skipped: { noRealm: 0, unreadable: 0 }, others: 1 });
  });

  test("a file over 20 MiB is refused before it is parsed, whether counted in characters or in bytes", () => {
    expect(ADDON_FILE_LIMIT).toBe(20 * 1024 * 1024);
    expect(readAddonFile("x".repeat(ADDON_FILE_LIMIT + 1))).toMatchObject({ ok: false, error: "too-large" });
    expect(readAddonFile(`EverlootDB = { "${"\u{1D538}".repeat(ADDON_FILE_LIMIT / 4)}" }`)).toMatchObject({ ok: false, error: "too-large" });
  });

  test("text that is not an Everloot.lua, and a file cut off part way, say so and read nothing", () => {
    expect(readAddonFile("x = 1")).toMatchObject({ ok: false, error: "not-everloot" });
    expect(readAddonFile("PolestarRecorderDB = { }")).toMatchObject({ ok: false, error: "not-everloot" });
    const cut = readAddonFile(SV.slice(0, Math.floor(SV.length / 2)));
    expect(cut).toMatchObject({ ok: false, error: "damaged" });
    expect(!cut.ok && cut.message).toContain("cut off");
    expect(readAddonFile(`EverlootDB = { ["version"] = "0.3.12" }`)).toMatchObject({ ok: false, error: "damaged" });
    // A table nested past what the parser can follow is damaged too, not a crash.
    expect(readAddonFile(`EverlootDB = ${"{".repeat(200_000)}`)).toMatchObject({ ok: false, error: "damaged" });
  });
});

describe("adding the file's characters", () => {
  test("new characters are offered to add; an added alt says it came from the file, with the file's details and newest time", () => {
    const storage = memory();
    const { preview, result } = importFile(storage, ANON, SV);
    expect(preview.rows.map((r) => [r.character.name, r.status])).toEqual([["Jaina", "new"], ["Thrall", "new"]]);
    expect(result).toMatchObject({ ok: true, added: 2, updated: 0 });
    expect(byName(storage, ANON, "Thrall")).toEqual([expect.objectContaining({
      realm: "Moon Guard", classSlug: "shaman", faction: "horde", level: 24, professions: [], notes: "", planIds: [],
      provenance: { source: "addon-file", fileRecordAt: "2026-10-24T09:00:00.000Z", fileDetails: ["classSlug", "level", "faction"] },
      updatedAt: NOW.toISOString(),
    })]);
    expect(byName(storage, ANON, "Jaina")).toEqual([expect.objectContaining({
      realm: "Moon Guard", classSlug: null, faction: null, level: null,
      provenance: { source: "addon-file", fileRecordAt: "2026-10-24T08:00:00.000Z", fileDetails: [] },
    })]);
  });

  test("the same file again changes nothing: every character is already here, and applying it stores nothing", () => {
    const storage = memory();
    importFile(storage, ANON, SV);
    const once = storage.items.get(bucketKey(ANON));
    const { preview, result } = importFile(storage, ANON, SV, undefined, LATER);
    expect(preview.rows.map((r) => r.status)).toEqual(["same", "same"]);
    expect(result).toMatchObject({ ok: true, added: 0, updated: 0 });
    expect(storage.items.get(bucketKey(ANON))).toBe(once);
  });

  test("only the added alts' details are stored: nothing else from the file", () => {
    const storage = memory();
    importFile(storage, ANON, SV);
    const text = storage.items.get(bucketKey(ANON))!;
    for (const raw of ["install-fixture-0001", "epoch-1", "Player-4395", "EL-7K3Q-9P", "0a1b2c3d", "Orc", "125000", "Arthas", "Sylvanas", "Forest Spider"]) {
      expect(text, raw).not.toContain(raw);
    }
  });

  test("a newer file sets what the last file set and fills what is unknown; what the player set is listed, never changed", () => {
    const storage = memory();
    const frost = savePlan(storage, ANON, { name: "Frost", notes: "", classSlug: "mage", codes: [MAGE, null], orders: [null, null] }, NOW);
    if (!frost.ok) throw new Error("no plan");
    const here = alt({
      name: "Thrall", realm: "Moon Guard", classSlug: "warrior", level: 24, faction: null, notes: "Mine", professions: ["Alchemy"], planIds: [frost.plan.id],
      provenance: { source: "addon-file", fileRecordAt: "2026-10-21T18:00:00.000Z", fileDetails: ["level"] },
    });
    storage.items.set(bucketKey(ANON), JSON.stringify({ ...stored(storage, ANON), alts: [here] }));
    const newer = lua({ character_link: [link("Thrall", "Moon Guard", "2026-10-25T18:00:00Z", "SHAMAN", 31, "Horde")] });
    const { preview, result } = importFile(storage, ANON, newer, undefined, LATER);
    expect(preview.rows).toEqual([expect.objectContaining({
      status: "update", altIds: [here.id],
      changes: [{ detail: "level", here: 24, file: 31 }, { detail: "faction", here: null, file: "horde" }],
      kept: [{ detail: "classSlug", here: "warrior", file: "shaman" }],
    })]);
    expect(result).toMatchObject({ ok: true, added: 0, updated: 1 });
    expect(byName(storage, ANON, "Thrall")).toEqual([{
      ...here, level: 31, faction: "horde", updatedAt: LATER.toISOString(),
      provenance: { source: "addon-file", fileRecordAt: "2026-10-25T18:00:00.000Z", fileDetails: ["level", "faction"] },
    }]);
  });

  test("a file no newer than the last one read has nothing to change, even where the player changed a detail since", () => {
    const storage = memory();
    seed(storage, ANON, [alt({
      name: "Thrall", realm: "Moon Guard", classSlug: "shaman", faction: "horde", level: 40,
      provenance: { source: "addon-file", fileRecordAt: "2026-10-24T09:00:00.000Z", fileDetails: ["classSlug", "faction"] },
    })]);
    const preview = previewAltImport(read(SV), stored(storage, ANON));
    expect(preview.rows.find((r) => r.character.name === "Thrall")).toMatchObject({ status: "same", changes: [] });
  });

  test("a name matching alts with no realm set is ambiguous: skipped unless the player says which alt it is, or adds it as new", () => {
    const storage = memory();
    const typed = alt({ id: idOf(500), name: "Thrall", notes: "Typed by hand", professions: ["Mining"] });
    const other = alt({ id: idOf(501), name: "thrall", notes: "Another one" });
    seed(storage, ANON, [typed, other]);
    const first = importFile(storage, ANON, SV);
    expect(first.preview.rows.find((r) => r.character.name === "Thrall")).toMatchObject({ status: "ambiguous", altIds: [typed.id, other.id] });
    expect(defaultChoices(first.preview)).toEqual(["add", "skip"]);
    expect(first.result).toMatchObject({ ok: true, added: 1, updated: 0 });
    expect(byName(storage, ANON, "Thrall")).toEqual([typed]);

    const second = importFile(storage, ANON, SV, () => ["skip", `alt:${typed.id}`], LATER);
    expect(second.result).toMatchObject({ ok: true, added: 0, updated: 1 });
    expect(byName(storage, ANON, "Thrall")).toEqual([{
      ...typed, realm: "Moon Guard", classSlug: "shaman", faction: "horde", level: 24, updatedAt: LATER.toISOString(),
      provenance: { source: "manual", fileRecordAt: "2026-10-24T09:00:00.000Z", fileDetails: ["classSlug", "level", "faction"] },
    }]);
    expect(byName(storage, ANON, "thrall")).toEqual([other]);
  });

  test("an ambiguous character can be added as a new alt instead", () => {
    const storage = memory();
    seed(storage, ANON, [alt({ name: "Thrall" })]);
    importFile(storage, ANON, SV, () => ["skip", "add"]);
    expect(byName(storage, ANON, "Thrall").map((a) => a.realm)).toEqual([null, "Moon Guard"]);
  });

  test("two of the file's characters cannot both be one alt, and nothing is stored when they are", () => {
    const storage = memory();
    const typed = alt({ name: "Thrall" });
    seed(storage, ANON, [typed]);
    const before = storage.items.get(bucketKey(ANON));
    const two = lua({ gold_snapshot: [gold("Thrall", "Moon Guard", "2026-10-20T00:00:00Z"), gold("Thrall", "Nightfall", "2026-10-20T00:00:00Z")] });
    const { result } = importFile(storage, ANON, two, () => [`alt:${typed.id}`, `alt:${typed.id}`]);
    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect(!result.ok && result.message).toContain("same alt");
    expect(storage.items.get(bucketKey(ANON))).toBe(before);
  });

  test("a choice a row does not offer is refused: adding a character already here, or naming an alt it cannot be", () => {
    const storage = memory();
    importFile(storage, ANON, SV);
    const before = storage.items.get(bucketKey(ANON));
    expect(importFile(storage, ANON, SV, () => ["add", "add"]).result).toMatchObject({ ok: false, error: "invalid" });
    expect(importFile(storage, ANON, SV, () => ["skip", `alt:${idOf(999)}`]).result).toMatchObject({ ok: false, error: "invalid" });
    expect(importFile(storage, ANON, SV, () => ["skip"]).result).toMatchObject({ ok: false, error: "invalid" });
    expect(storage.items.get(bucketKey(ANON))).toBe(before);
  });

  test("more new characters than the device has room for: the import is refused whole", () => {
    const storage = memory();
    seed(storage, ANON, Array.from({ length: 59 }, (_, i) => alt({ id: idOf(500 + i), name: `Alt ${i}` })));
    const before = storage.items.get(bucketKey(ANON));
    const { preview, result } = importFile(storage, ANON, SV);
    expect(preview.room).toBe(1);
    expect(result).toMatchObject({ ok: false, error: "over-limit" });
    expect(storage.items.get(bucketKey(ANON))).toBe(before);
  });

  test("a preview is applied only to the bucket it was made for, and only while that bucket is as it was", () => {
    const storage = memory();
    const preview = previewAltImport(read(SV), stored(storage, ANON));
    expect(applyAltImport(storage, A, preview, defaultChoices(preview), NOW)).toMatchObject({ ok: false, error: "other-owner" });
    expect(storage.items.get(bucketKey(A))).toBeUndefined();
    const added = saveAlt(storage, ANON, { name: "From another tab", realm: "", classSlug: null, faction: null, level: null, professions: [], notes: "", planIds: [] }, NOW);
    expect(added.ok).toBe(true);
    const before = storage.items.get(bucketKey(ANON));
    const late = applyAltImport(storage, ANON, preview, defaultChoices(preview), NOW);
    expect(late).toMatchObject({ ok: false, error: "changed" });
    expect(!late.ok && late.message).toContain("Choose the file again");
    expect(storage.items.get(bucketKey(ANON))).toBe(before);
  });

  test("storage that refuses the write keeps the device as it was, and says why", () => {
    const storage = memory();
    const preview = previewAltImport(read(SV), stored(storage, ANON));
    const full = { ...storage, setItem: () => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); } };
    expect(applyAltImport(full, ANON, preview, defaultChoices(preview), NOW)).toMatchObject({ ok: false, error: "full" });
    expect(applyAltImport(memory("denied"), ANON, preview, defaultChoices(preview), NOW)).toMatchObject({ ok: false, error: "unavailable" });
    expect(storage.items.size).toBe(0);
  });
});
