import { altFailure, altKey, changeAlts, nameKey } from "./alt-workspace";
import {
  FILE_DETAILS, WORKSPACE_LIMITS, clean, sameOwner,
  type DeviceStorage, type Faction, type Failure, type FileDetail, type LocalAlt, type Owner, type PlayerWorkspace,
} from "./player-workspace";
import { LuaParseError, parseEverlootLua } from "./sv-parse";
import { TALENT_CLASSES, type TalentClassSlug } from "./talents/catalogs";

// The player's own characters from their Everloot.lua (the addon's SavedVariables file), added as alts after a
// preview. The file is parsed in the browser by the gold ledger's reader (lib/sv-parse.ts); its text is neither sent
// nor kept, and what comes out of it is only each character's name, realm, class, faction, level and newest record
// time. Only the records the addon writes about the player's own characters by name are read: gold and money
// records (character and realm) and link records (name, realm, class, level and faction). Census rows name no one,
// and player rows are sightings that mix the player's characters with everyone else's, so neither says who the
// player is, and neither is read.

/** The largest Everloot.lua read: anything larger is refused before it is parsed. */
export const ADDON_FILE_LIMIT = 20 * 1024 * 1024;
export const ADDON_FILE_TOO_LARGE = "That file is over 20 MiB, larger than an Everloot.lua should be, so it was not read. Nothing was changed.";
const NOT_EVERLOOT = "That is not an Everloot.lua: it holds no Everloot addon data. Nothing was changed.";
const DAMAGED = "That file is cut off or damaged, so nothing in it was read. If the game was running, log out fully so it finishes writing the file, then choose it again. Nothing was changed.";
const EXTRA = "That file has text the addon never writes before or after its data, so nothing in it was read. Choose the Everloot.lua the game wrote. Nothing was changed.";
const CHANGED = "The alts on this device changed since the preview. Choose the file again to see what it would do now.";

/** One of the player's own characters as their file names it. Details its records do not give are null. */
export interface FileCharacter {
  name: string;
  realm: string;
  /** From the character's newest link record. */
  classSlug: TalentClassSlug | null;
  faction: Faction | null;
  level: number | null;
  /** The time of the character's newest record. */
  recordAt: string;
}

export type AddonFile =
  | {
    ok: true;
    characters: FileCharacter[];
    /** The player's own records that could not name a character: no realm, or no readable name or time. */
    skipped: { noRealm: number; unreadable: number };
    /** Records of every other kind, none of them read. */
    others: number;
  }
  | { ok: false; error: "too-large" | "not-everloot" | "damaged"; message: string };

const OWN_MONEY = new Set(["gold_snapshot", "money_event"]);
const LINK = "character_link";
const ISO = /^\d{4}-\d{2}-\d{2}T/;

/** Plain text of 1 to `max` characters, as the workspace keeps it, or null. */
const plain = (v: unknown, max: number) => (typeof v === "string" && v !== "" && v === clean(v, false) && Array.from(v).length <= max ? v : null);
/** The game's class token (UnitClass's second return, "SHAMAN") as the site's class, if the site has it. */
const classOf = (v: unknown) => (typeof v === "string" && (TALENT_CLASSES as readonly string[]).includes(v.toLowerCase()) ? v.toLowerCase() as TalentClassSlug : null);
const factionOf = (v: unknown): Faction | null => (v === "Alliance" ? "alliance" : v === "Horde" ? "horde" : null);
const levelOf = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= WORKSPACE_LIMITS.level ? v : null);

/** The player's own characters in an Everloot.lua's text, or why the file cannot be read. Never runs the file. */
export function readAddonFile(text: string): AddonFile {
  // A string's UTF-8 length is at least its length in code units, so the cheap test goes first.
  if (text.length > ADDON_FILE_LIMIT || new TextEncoder().encode(text).length > ADDON_FILE_LIMIT) {
    return { ok: false, error: "too-large", message: ADDON_FILE_TOO_LARGE };
  }
  let records: Array<Record<string, unknown>>;
  try {
    records = parseEverlootLua(text).records;
  } catch (error) {
    // The parser throws for anything outside the addon's Lua, a file cut off part way included; a table nested past
    // what it can follow throws too.
    const foreign = error instanceof LuaParseError && error.message.startsWith("not ");
    const extra = error instanceof LuaParseError && error.message.startsWith("extra text");
    return { ok: false, error: foreign ? "not-everloot" : "damaged", message: foreign ? NOT_EVERLOOT : extra ? EXTRA : DAMAGED };
  }
  const found = new Map<string, { character: FileCharacter; linkAt: number }>();
  const skipped = { noRealm: 0, unreadable: 0 };
  let others = 0;
  for (const r of records) {
    const link = r.kind === LINK;
    if (!link && !OWN_MONEY.has(String(r.kind))) { others++; continue; }
    const name = plain(link ? r.name : r.character, WORKSPACE_LIMITS.name);
    if (!name) { skipped.unreadable++; continue; }
    const realm = plain(r.realm, WORKSPACE_LIMITS.realm);
    if (!realm) { skipped.noRealm++; continue; }
    const ms = typeof r.capturedAt === "string" ? Date.parse(r.capturedAt) : Number.NaN;
    const at = Number.isFinite(ms) ? new Date(ms).toISOString() : "";
    if (!ISO.test(at)) { skipped.unreadable++; continue; }
    const key = altKey(name, realm);
    const entry = found.get(key) ?? { character: { name, realm, classSlug: null, faction: null, level: null, recordAt: at }, linkAt: -Infinity };
    // Named as its newest record names it; its details are its newest link record's.
    if (at >= entry.character.recordAt) Object.assign(entry.character, { name, realm, recordAt: at });
    if (link && ms >= entry.linkAt) {
      Object.assign(entry.character, { classSlug: classOf(r.class), faction: factionOf(r.faction), level: levelOf(r.level) });
      entry.linkAt = ms;
    }
    found.set(key, entry);
  }
  const characters = [...found.values()].map((e) => e.character)
    .sort((a, b) => a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm));
  return { ok: true, characters, skipped, others };
}

/** One detail the file has a value for that differs from the alt's. */
export interface DetailChange { detail: FileDetail; here: string | number | null; file: string | number }

export interface ImportRow {
  character: FileCharacter;
  /**
   * new: no alt is this character. update: the alt that is, with details the file would set. same: that alt, with
   * nothing the file would set. ambiguous: alts of its name whose realm is not set, any or none of which it may be.
   */
  status: "new" | "update" | "same" | "ambiguous";
  /** The alt it is (update, same), or the alts it may be (ambiguous). */
  altIds: string[];
  /** What it would set: a detail not known here, or one that still holds an older file's value. */
  changes: DetailChange[];
  /** Where the player's own value differs from the file's: shown, and never changed. */
  kept: DetailChange[];
}

export interface AltImportPreview {
  owner: Owner;
  /** The bucket as stored when the preview was made: applyAltImport writes only while it is still that. */
  base: string;
  rows: ImportRow[];
  /** How many alts the device can still take. */
  room: number;
  skipped: { noRealm: number; unreadable: number };
  others: number;
}

/** What to do with a row: add it as a new alt, update the alt it is, take it as the named alt (`alt:<id>`), or skip. */
export type RowChoice = "add" | "update" | "skip" | `alt:${string}`;

/** The choices a row offers, the first being what is done unless the player says otherwise (an unsure match is skipped). */
export function rowChoices(row: ImportRow): RowChoice[] {
  if (row.status === "new") return ["add", "skip"];
  if (row.status === "update") return ["update", "skip"];
  if (row.status === "same") return ["skip"];
  return ["skip", "add", ...row.altIds.map((id) => `alt:${id}` as const)];
}

export const defaultChoices = (preview: AltImportPreview): RowChoice[] => preview.rows.map((row) => rowChoices(row)[0]);

/** How the file's details compare with an alt's: what the file would set, and where the player's own value stays. */
function compare(character: FileCharacter, alt: LocalAlt): { changes: DetailChange[]; kept: DetailChange[] } {
  const changes: DetailChange[] = [];
  const kept: DetailChange[] = [];
  for (const detail of FILE_DETAILS) {
    const file = character[detail];
    const here = alt[detail];
    if (file === null || file === here) continue;
    (here === null || alt.provenance.fileDetails.includes(detail) ? changes : kept).push({ detail, here, file });
  }
  return { changes, kept };
}

function matched(character: FileCharacter, alt: LocalAlt): ImportRow {
  const { fileRecordAt } = alt.provenance;
  // A file no newer than the last one read into this alt has nothing new for it, whatever the player changed since.
  if (fileRecordAt !== null && character.recordAt <= fileRecordAt) return { character, status: "same", altIds: [alt.id], changes: [], kept: [] };
  const { changes, kept } = compare(character, alt);
  return { character, status: changes.length > 0 ? "update" : "same", altIds: [alt.id], changes, kept };
}

/** What adding a file's characters to `current` would do, without changing anything. */
export function previewAltImport(file: Extract<AddonFile, { ok: true }>, current: PlayerWorkspace): AltImportPreview {
  const rows = file.characters.map((character): ImportRow => {
    const key = altKey(character.name, character.realm);
    const placed = current.alts.filter((a) => a.realm !== null && altKey(a.name, a.realm) === key);
    if (placed.length === 1) return matched(character, placed[0]);
    // With no alt on its realm, an alt of its name with no realm set may be it, or may not: the player says which.
    const unsure = placed.length > 1 ? placed : current.alts.filter((a) => a.realm === null && nameKey(a.name) === nameKey(character.name));
    return { character, status: unsure.length > 0 ? "ambiguous" : "new", altIds: unsure.map((a) => a.id), changes: [], kept: [] };
  });
  return {
    owner: current.owner, base: JSON.stringify(current), rows, room: WORKSPACE_LIMITS.alts - current.alts.length,
    skipped: file.skipped, others: file.others,
  };
}

export type ApplyResult = { ok: true; added: number; updated: number } | Failure;

/**
 * Makes the choices a preview offered, into the bucket it was made for and only while that bucket is as it was. An
 * added alt keeps the file's details and says it came from the file; an alt the file updates keeps its name, notes,
 * plans and professions, and every detail the player set. Nothing is stored unless every choice can be made.
 */
export function applyAltImport(storage: DeviceStorage | null, owner: Owner, preview: AltImportPreview, choices: RowChoice[], now = new Date()): ApplyResult {
  // After an account switch, a preview made for the last account is not applied to this one.
  if (!sameOwner(preview.owner, owner)) return altFailure("other-owner", "Who is signed in here changed since the preview, so nothing was added. Choose the file again.");
  if (choices.length !== preview.rows.length || preview.rows.some((row, i) => !rowChoices(row).includes(choices[i]))) {
    return altFailure("invalid", "Those choices do not fit what the file holds. Choose the file again.");
  }
  const claimed = choices.filter((c) => c.startsWith("alt:"));
  if (new Set(claimed).size !== claimed.length) return altFailure("invalid", "Two characters from the file were matched to the same alt. Choose one of them for it.");
  if (choices.every((c) => c === "skip")) return { ok: true, added: 0, updated: 0 };
  let added = 0;
  let updated = 0;
  const result = changeAlts(storage, owner, (workspace) => {
    if (JSON.stringify(workspace) !== preview.base) return altFailure("changed", CHANGED);
    const alts = [...workspace.alts];
    preview.rows.forEach(({ character, altIds }, i) => {
      const choice = choices[i];
      if (choice === "skip") return;
      if (choice === "add") {
        alts.push({
          id: crypto.randomUUID(), name: character.name, realm: character.realm,
          classSlug: character.classSlug, faction: character.faction, level: character.level, professions: [], notes: "", planIds: [],
          provenance: { source: "addon-file", fileRecordAt: character.recordAt, fileDetails: FILE_DETAILS.filter((d) => character[d] !== null) },
          updatedAt: now.toISOString(),
        });
        added++;
        return;
      }
      const at = alts.findIndex((a) => a.id === (choice === "update" ? altIds[0] : choice.slice("alt:".length)));
      // Taken as an alt whose realm was not set, it is on the file's realm from now on.
      const alt = choice === "update" ? alts[at] : { ...alts[at], realm: character.realm };
      const { changes } = compare(character, alt);
      const next: LocalAlt = { ...alt, updatedAt: now.toISOString() };
      for (const { detail, file } of changes) Object.assign(next, { [detail]: file });
      const set = new Set(changes.map((c) => c.detail));
      next.provenance = {
        ...alt.provenance, fileRecordAt: character.recordAt,
        fileDetails: FILE_DETAILS.filter((d) => set.has(d) || alt.provenance.fileDetails.includes(d)),
      };
      alts[at] = next;
      updated++;
    });
    return { ...workspace, alts };
  });
  return result.ok ? { ok: true, added, updated } : result;
}
