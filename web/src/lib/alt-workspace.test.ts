import { describe, expect, test } from "vitest";
import { altKey, deleteAlt, restoreLines, saveAlt, type AltInput } from "./alt-workspace";
import { PROFESSIONS } from "./game-assets";
import {
  ALT_PROFESSIONS, applyImport, bucketKey, deletePlan, emptyWorkspace, exportBackup, previewImport, readWorkspace, savePlan,
  type LocalAlt, type LocalPlan, type Owner, type PlayerWorkspace,
} from "./player-workspace";

// Alts kept in the PlayerWorkspace (lib/player-workspace.ts), added and changed by hand: no addon file needed.

const MAGE = "EL1-mage-1482-1.60.1.70450-OTAwMDE6Miw5MDAwMjoxOjEsOTAwMDQ6Mg";
const ANON: Owner = { kind: "anonymous" };
const A_ID = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";
const B_ID = "7c1d2e3f-4a5b-4c6d-8e7f-901a2b3c4d5e";
const A: Owner = { kind: "account", userId: A_ID };
const B: Owner = { kind: "account", userId: B_ID };
const NOW = new Date("2026-10-26T12:00:00.000Z");
const LATER = new Date("2026-10-27T12:00:00.000Z");
const FILE_AT = "2026-10-21T18:00:00.000Z";
const idOf = (n: number) => `1a2b3c4d-0000-4000-8000-${String(n).padStart(12, "0")}`;

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

const input = (over: Partial<AltInput> = {}): AltInput => ({
  name: "Thrall", realm: "", classSlug: null, faction: null, level: null, professions: [], notes: "", planIds: [], ...over,
});

function added(storage: Memory, owner: Owner, over: Partial<AltInput> = {}, now = NOW): LocalAlt {
  const result = saveAlt(storage, owner, input(over), now);
  if (!result.ok) throw new Error(`save failed: ${result.error}: ${result.message}`);
  return result.alt;
}

function planIn(storage: Memory, owner: Owner, name = "Frost leveling"): LocalPlan {
  const result = savePlan(storage, owner, { name, notes: "", classSlug: "mage", codes: [MAGE, null], orders: [null, null] }, NOW);
  if (!result.ok) throw new Error(`plan save failed: ${result.error}`);
  return result.plan;
}

function stored(storage: Memory, owner: Owner): PlayerWorkspace {
  const read = readWorkspace(storage, owner);
  if (!read.ok) throw new Error(`read failed: ${read.error}`);
  return read.workspace;
}
const altNames = (storage: Memory, owner: Owner) => stored(storage, owner).alts.map((a) => a.name).sort();

/** A stored alt in the version 2 format, written by hand. */
const alt = (over: Partial<LocalAlt> = {}): LocalAlt => ({
  id: idOf(500), name: "Thrall", realm: null, classSlug: null, faction: null, level: null, professions: [], notes: "", planIds: [],
  provenance: { source: "manual", fileRecordAt: null, fileDetails: [] }, updatedAt: "2026-10-20T12:00:00.000Z", ...over,
});
const doc = (owner: Owner, alts: LocalAlt[], plans: LocalPlan[] = []): PlayerWorkspace =>
  ({ format: "everloot.player-workspace", version: 2, owner, plans, alts, watches: [] });
const seed = (storage: Memory, owner: Owner, alts: LocalAlt[], plans: LocalPlan[] = []) =>
  storage.items.set(bucketKey(owner), JSON.stringify(doc(owner, alts, plans)));

describe("adding and editing by hand", () => {
  test("with no file at all, an alt needs only a name, and every detail not given stays unknown rather than guessed", () => {
    const storage = memory();
    const result = saveAlt(storage, ANON, input({ name: "Thrall" }), NOW);
    expect(result).toMatchObject({ ok: true, alt: {
      name: "Thrall", realm: null, classSlug: null, faction: null, level: null, professions: [], notes: "", planIds: [],
      provenance: { source: "manual", fileRecordAt: null, fileDetails: [] }, updatedAt: NOW.toISOString(),
    } });
    expect(stored(storage, ANON).alts).toEqual([result.ok && result.alt]);
  });

  test("every detail is kept as typed: realm, class, faction, level, professions in the game's order, notes and plans", () => {
    const storage = memory();
    const frost = planIn(storage, ANON);
    const jaina = added(storage, ANON, {
      name: "  Jaina ", realm: " Moon Guard ", classSlug: "mage", faction: "alliance", level: 60,
      professions: ["Tailoring", "Enchanting"], notes: " Raid main\r\nTuesdays\u0007 ", planIds: [frost.id],
    });
    expect(jaina).toMatchObject({
      name: "Jaina", realm: "Moon Guard", classSlug: "mage", faction: "alliance", level: 60,
      professions: ["Enchanting", "Tailoring"], notes: "Raid main\nTuesdays", planIds: [frost.id],
    });
  });

  test("a detail outside its rules is refused with its reason, never cut or guessed, and nothing is stored", () => {
    const storage = memory();
    const refused: Array<[Partial<AltInput>, string]> = [
      [{ name: "   " }, "name"],
      [{ name: "a".repeat(61) }, "name"],
      [{ realm: "r".repeat(61) }, "realm"],
      [{ classSlug: "deathknight" }, "class"],
      [{ faction: "neutral" }, "faction"],
      [{ level: 0 }, "level"],
      [{ level: 61 }, "level"],
      [{ level: 24.5 }, "level"],
      [{ level: Number.NaN }, "level"],
      [{ professions: ["Jewelcrafting"] }, "profession"],
      [{ notes: "n".repeat(1001) }, "Notes"],
    ];
    for (const [over, says] of refused) {
      const result = saveAlt(storage, ANON, input(over), NOW);
      expect(result, JSON.stringify(over)).toMatchObject({ ok: false, error: "invalid" });
      expect(!result.ok && result.message, JSON.stringify(over)).toContain(says);
    }
    expect(storage.items.size).toBe(0);
    expect(saveAlt(storage, ANON, input({ name: "a".repeat(60), realm: "r".repeat(60), notes: "n".repeat(1000), level: 1 }), NOW).ok).toBe(true);
  });

  test("the professions an alt can list are the site's", () => {
    expect([...ALT_PROFESSIONS]).toEqual([...PROFESSIONS]);
  });

  test("one character is one alt: the same name and realm, in any case or spelling of the realm, is refused", () => {
    const storage = memory();
    added(storage, ANON, { name: "Thrall", realm: "Moon Guard" });
    const again = saveAlt(storage, ANON, input({ name: "thrall", realm: "moon-guard" }), NOW);
    expect(again).toMatchObject({ ok: false, error: "invalid" });
    expect(!again.ok && again.message).toContain("already");
    // Another realm is another character, and with no realm set the player may keep two of one name.
    added(storage, ANON, { name: "Thrall", realm: "Nightfall" });
    added(storage, ANON, { name: "Thrall" });
    added(storage, ANON, { name: "Thrall" });
    expect(altNames(storage, ANON)).toEqual(["Thrall", "Thrall", "Thrall", "Thrall"]);
  });

  test("altKey matches a character however its name's case or its realm's spaces and hyphens are written", () => {
    expect(altKey("Thrall", "Moon Guard")).toBe(altKey("thrall", "moon-guard"));
    expect(altKey("Thrall", "Forever-Pioneer")).toBe(altKey("THRALL", " forever  pioneer "));
    expect(altKey("Thrall", "Moon Guard")).not.toBe(altKey("Thrall", "Nightfall"));
    expect(altKey("Thrall", "Moon Guard")).not.toBe(altKey("Thralls", "Moon Guard"));
  });

  test("an alt uses up to 10 of this bucket's plans; a plan that is gone is refused; a plan an alt uses is not deleted under it", () => {
    const storage = memory();
    const plans = Array.from({ length: 11 }, (_, i) => planIn(storage, ANON, `Plan ${i}`));
    const ten = added(storage, ANON, { planIds: plans.slice(0, 10).map((p) => p.id) });
    expect(ten.planIds).toHaveLength(10);
    const eleven = saveAlt(storage, ANON, input({ name: "Jaina", planIds: plans.map((p) => p.id) }), NOW);
    expect(eleven).toMatchObject({ ok: false, error: "invalid" });
    expect(!eleven.ok && eleven.message).toContain("10 plans");
    const gone = saveAlt(storage, ANON, input({ name: "Jaina", planIds: [idOf(99)] }), NOW);
    expect(gone).toMatchObject({ ok: false, error: "invalid" });
    expect(!gone.ok && gone.message).toContain("no longer on this device");
    expect(deletePlan(storage, ANON, plans[0].id)).toMatchObject({ ok: false, error: "referenced" });
    expect(stored(storage, ANON).plans).toHaveLength(11);
  });

  test("editing keeps the id and how the alt was added; a detail the player changes is theirs, no longer the file's", () => {
    const storage = memory();
    const fromFile = alt({
      realm: "Moon Guard", classSlug: "shaman", faction: "horde", level: 24,
      provenance: { source: "addon-file", fileRecordAt: FILE_AT, fileDetails: ["classSlug", "level", "faction"] },
    });
    seed(storage, ANON, [fromFile]);
    const edit = saveAlt(storage, ANON, input({ id: fromFile.id, name: "Thrall", realm: "Moon Guard", classSlug: "shaman", faction: "horde", level: 30, notes: "Leveling" }), LATER);
    expect(edit).toMatchObject({ ok: true, alt: {
      id: fromFile.id, level: 30, notes: "Leveling", updatedAt: LATER.toISOString(),
      provenance: { source: "addon-file", fileRecordAt: FILE_AT, fileDetails: ["classSlug", "faction"] },
    } });
    expect(stored(storage, ANON).alts).toHaveLength(1);
  });

  test("an edit of an alt that is gone says so, and an edit cannot take another alt's character", () => {
    const storage = memory();
    added(storage, ANON, { name: "Thrall", realm: "Moon Guard" });
    const jaina = added(storage, ANON, { name: "Jaina", realm: "Moon Guard" });
    expect(saveAlt(storage, ANON, input({ id: idOf(42), name: "Jaina" }), LATER)).toMatchObject({ ok: false, error: "missing" });
    expect(saveAlt(storage, ANON, input({ id: jaina.id, name: "Thrall", realm: "Moon Guard" }), LATER)).toMatchObject({ ok: false, error: "invalid" });
    // Saving an alt over itself is not a second character.
    expect(saveAlt(storage, ANON, input({ id: jaina.id, name: "Jaina", realm: "Moon Guard", level: 12 }), LATER).ok).toBe(true);
  });

  test("deleting an alt removes only that alt; its plans stay, and are free to delete after", () => {
    const storage = memory();
    const frost = planIn(storage, ANON);
    const thrall = added(storage, ANON, { name: "Thrall", planIds: [frost.id] });
    added(storage, ANON, { name: "Jaina" });
    expect(deleteAlt(storage, ANON, thrall.id)).toMatchObject({ ok: true });
    expect(altNames(storage, ANON)).toEqual(["Jaina"]);
    expect(stored(storage, ANON).plans).toEqual([frost]);
    const before = storage.items.get(bucketKey(ANON));
    expect(deleteAlt(storage, ANON, thrall.id)).toMatchObject({ ok: false, error: "missing" });
    expect(storage.items.get(bucketKey(ANON))).toBe(before);
    expect(deletePlan(storage, ANON, frost.id)).toMatchObject({ ok: true });
  });

  test("alts stay in their owner's bucket: an account's alts show neither signed out nor under another account", () => {
    const storage = memory();
    added(storage, A, { name: "A's alt" });
    added(storage, B, { name: "B's alt" });
    expect(altNames(storage, A)).toEqual(["A's alt"]);
    expect(altNames(storage, B)).toEqual(["B's alt"]);
    expect(altNames(storage, ANON)).toEqual([]);
  });

  test("a device keeps 60 alts: the 61st is refused and nothing changes", () => {
    const storage = memory();
    seed(storage, ANON, Array.from({ length: 60 }, (_, i) => alt({ id: idOf(500 + i), name: `Alt ${i}` })));
    const before = storage.items.get(bucketKey(ANON));
    const result = saveAlt(storage, ANON, input({ name: "One more" }), NOW);
    expect(result).toMatchObject({ ok: false, error: "over-limit" });
    expect(!result.ok && result.message).toContain("60 alts");
    expect(storage.items.get(bucketKey(ANON))).toBe(before);
  });
});

describe("storage that fails never loses what is stored", () => {
  test("denied storage refuses the change and says alts cannot be kept here", () => {
    for (const storage of [memory("denied"), null]) {
      const result = saveAlt(storage, ANON, input(), NOW);
      expect(result).toMatchObject({ ok: false, error: "unavailable" });
      expect(!result.ok && result.message).toContain("alts cannot be saved here");
    }
  });

  test("a full storage refuses the change and keeps what was stored", () => {
    const storage = memory();
    const thrall = added(storage, ANON);
    const before = storage.items.get(bucketKey(ANON));
    const full = { ...storage, setItem: () => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); } };
    expect(saveAlt(full, ANON, input({ name: "Jaina" }), NOW)).toMatchObject({ ok: false, error: "full" });
    expect(deleteAlt(full, ANON, thrall.id)).toMatchObject({ ok: false, error: "full" });
    expect(storage.items.get(bucketKey(ANON))).toBe(before);
  });

  test("damaged stored data and data from a newer version are left exactly as they are", () => {
    for (const text of ["{not json", JSON.stringify({ format: "everloot.player-workspace", version: 3, owner: ANON })]) {
      const storage = memory();
      storage.items.set(bucketKey(ANON), text);
      expect(saveAlt(storage, ANON, input(), NOW)).toMatchObject({ ok: false });
      expect(deleteAlt(storage, ANON, idOf(500))).toMatchObject({ ok: false });
      expect(storage.items.get(bucketKey(ANON))).toBe(text);
    }
  });
});

describe("backups", () => {
  test("a backup holds every detail of every alt, and restoring it brings each back as it was", () => {
    const storage = memory();
    const frost = planIn(storage, ANON);
    added(storage, ANON, {
      name: "Jaina", realm: "Moon Guard", classSlug: "mage", faction: "alliance", level: 60,
      professions: ["Enchanting", "Tailoring"], notes: "Raid main", planIds: [frost.id],
    });
    seed(storage, ANON, [...stored(storage, ANON).alts, alt({
      id: idOf(501), realm: "Moon Guard", classSlug: "shaman", faction: "horde", level: 24,
      provenance: { source: "addon-file", fileRecordAt: FILE_AT, fileDetails: ["classSlug", "level", "faction"] },
    })], [frost]);
    const before = stored(storage, ANON);
    const backup = exportBackup(before, NOW);
    if (!backup.ok) throw new Error("no backup");
    const elsewhere = memory();
    const preview = previewImport(backup.text, emptyWorkspace(ANON));
    if (!preview.ok) throw new Error(preview.message);
    expect(applyImport(elsewhere, ANON, preview.preview)).toMatchObject({ ok: true });
    expect(stored(elsewhere, ANON).alts).toEqual(before.alts);
    expect(stored(elsewhere, ANON).plans).toEqual(before.plans);
  });

  test("a restore names the alts it adds and those it replaces with the backup's newer copy, notes included, and a character it would add twice", () => {
    const thrall = alt({ id: idOf(500), name: "Thrall", realm: "Moon Guard", notes: "Kept here" });
    const jaina = alt({ id: idOf(501), name: "Jaina", realm: "Moon Guard" });
    const device = doc(ANON, [thrall, jaina]);
    const backup = doc(ANON, [
      { ...thrall, notes: "From the backup", level: 30, updatedAt: "2026-10-22T12:00:00.000Z" },
      alt({ id: idOf(502), name: "Sylvanas" }),
      alt({ id: idOf(503), name: "jaina", realm: "moon-guard" }),
    ]);
    const preview = previewImport(JSON.stringify(backup), device);
    if (!preview.ok) throw new Error(preview.message);
    expect(restoreLines(device, preview.preview)).toEqual([
      "Adds Sylvanas.",
      "Adds jaina (moon-guard). Jaina (Moon Guard) is already here as another alt, so it would be here twice.",
      "Replaces Thrall (Moon Guard) with the backup's newer copy, which changes its level and notes.",
    ]);
  });
});
