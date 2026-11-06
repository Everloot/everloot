import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEverlootLua } from "../../web/src/lib/sv-parse";
import { linkRealmKey } from "../../web/src/lib/character-links";
import { parseSyncRow, SYNC_CHARACTERS_PER_REQUEST, SYNC_ROWS_PER_REQUEST, type SyncCategory, type SyncRow } from "../../web/src/lib/private-sync";
import { receiptKeyForSite, type SentState } from "./sent-state";

/**
 * Private sync: sends the player's own linked characters' rows to the account's sync endpoint,
 * POST /api/me/characters/sync, with the account key, and nowhere else. The upload never carries profession_owned,
 * lockout_owned or talent_owned (web/src/lib/upload-batches.ts keeps them on the computer); this is the only sender of them.
 *
 * Only characters this file linked are sent: the character_link rows `/everloot link` wrote name them, and their
 * completionKey ties the completion module's rows (characterKey) to that name and realm. Gear rows carry the name and
 * realm themselves; only the newest one per character goes, and likewise the newest talent_owned row. The public
 * talent_snapshot rows carry no name, realm or key at all, so they can be tied to no character and are never sent.
 *
 * The site keeps a category only when the account holds that character's live link and turned the category's sync
 * on. Whatever it answers for a capture (kept, already had, older, sync off, not linked), the same capture is not sent
 * again; a changed one is. A request that fails leaves its captures to go next run.
 */

export interface SyncSendOptions {
  /** Site origin, e.g. https://everloot.app. */
  endpoint: string;
  /** The account key checked against this site, or null when the app is not signed in to it: then nothing is sent. */
  key: string | null;
  state: SentState;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

export interface SyncSendResult {
  /** Characters the site kept (or already had) at least one category of. */
  synced: string[];
  /** Characters whose every category sent has its sync off on the site. */
  syncOff: string[];
  /** Characters the account holds no live link for. */
  notLinked: string[];
  /** Characters the site would not take: the class differs from the link's, or the rows are not one character. */
  refused: string[];
  /** Characters not answered this run: they go again next run. */
  waiting: number;
  /** One category of one character over the request limit: not sent. */
  tooLarge: number;
  /** Why captures wait, when a whole request did not go through. */
  problem: string | null;
}

/**
 * Answered captures are kept apart from the intake's and the links' receipts: one key per site and character, holding
 * `category|hash` of the last answered capture of each category. Two files that share an install id (a copied WTF
 * folder) each keep their own characters' answers.
 */
export const syncReceiptKey = (installId: string, endpoint: string, character: string) => `sync|${receiptKeyForSite(installId, endpoint)}|${character}`;

const CATEGORY_OF: Record<string, SyncCategory> = {
  gear_snapshot: "gear", talent_owned: "talents", stats_owned: "stats", pvp_owned: "pvp", profession_owned: "professions", reputation_owned: "reputations",
  lockout_owned: "raids", achievement_owned: "achievements", title_owned: "achievements",
};
/** Kinds keyed by the completion module's characterKey. */
const KEYED = new Set(["talent_owned", "stats_owned", "pvp_owned", "profession_owned", "reputation_owned", "lockout_owned", "achievement_owned", "title_owned"]);

/** A site that asked to wait, by origin: nothing goes to it before then. Kept while the app runs. */
const waitUntil = new Map<string, number>();

interface Capture { category: SyncCategory; records: SyncRow[]; entry: string }
interface Character { id: string; label: string; name: string; realm: string; captures: Capture[] }
interface Group { character: Character; captures: Capture[] }

const time = (row: { capturedAt: string }) => Date.parse(row.capturedAt);
const characterId = (name: string, realm: string) => `${name.toLowerCase()}-${linkRealmKey(realm)}`;
const hashOf = (records: readonly SyncRow[]) => createHash("sha256").update(JSON.stringify(records)).digest("hex").slice(0, 32);

/** The file's linked characters with their rows by category, in file order. */
function charactersOf(records: Array<Record<string, unknown>>): Character[] {
  // The newest link row names each character; its completionKey ties the keyed rows to it.
  const links = new Map<string, { name: string; realm: string; key: string; at: string }>();
  for (const r of records) {
    if (r.kind !== "character_link" || typeof r.name !== "string" || typeof r.realm !== "string" || typeof r.completionKey !== "string") continue;
    const id = characterId(r.name, r.realm.trim());
    const at = typeof r.capturedAt === "string" ? r.capturedAt : "";
    const had = links.get(id);
    if (!had || at >= had.at) links.set(id, { name: r.name, realm: r.realm.trim(), key: r.completionKey, at });
  }
  const byKey = new Map([...links].map(([id, l]) => [l.key, id]));
  const rows = new Map<string, SyncRow[]>();
  for (const r of records) {
    const kind = String(r.kind);
    if (!Object.hasOwn(CATEGORY_OF, kind)) continue;
    let id: string | undefined;
    if (kind === "gear_snapshot") id = typeof r.character === "string" && typeof r.realm === "string" ? characterId(r.character, r.realm) : undefined;
    else if (KEYED.has(kind)) id = typeof r.characterKey === "string" ? byKey.get(r.characterKey) : undefined;
    if (!id || !links.has(id)) continue;
    // Only a row the endpoint reads goes; it gets the row as the schema reads it, with nothing else of the file.
    const row = parseSyncRow(r);
    if (!row) continue;
    const list = rows.get(id) ?? [];
    list.push(row);
    rows.set(id, list);
  }
  const out: Character[] = [];
  for (const [id, link] of links) {
    const mine = rows.get(id);
    if (!mine) continue;
    const captures: Capture[] = [];
    for (const category of ["gear", "stats", "talents", "pvp", "professions", "reputations", "raids", "achievements"] as const) {
      let records = mine.filter((r) => CATEGORY_OF[r.kind] === category);
      // The addon keeps a gear sample an hour, and the site keeps one talent build, one stats sheet and one PvP standing; the newest of each goes.
      if ((category === "gear" || category === "stats" || category === "talents" || category === "pvp") && records.length) records = [records.reduce((a, b) => (time(b) > time(a) ? b : a))];
      if (!records.length) continue;
      captures.push({ category, records, entry: `${category}|${hashOf(records)}` });
    }
    out.push({ id, label: `${link.name} of ${link.realm}`, name: link.name, realm: link.realm, captures });
  }
  return out;
}

/** Captures into requests within the endpoint's limits. A character may span two requests, by category. */
function requestsOf(characters: readonly Character[], result: SyncSendResult): Group[][] {
  const requests: Group[][] = [];
  let current: Group[] = [];
  let rows = 0;
  for (const character of characters) {
    let group: Group | null = null;
    for (const capture of character.captures) {
      const n = capture.records.length;
      if (n > SYNC_ROWS_PER_REQUEST) { result.tooLarge++; continue; }
      if (rows + n > SYNC_ROWS_PER_REQUEST || (!group && current.length >= SYNC_CHARACTERS_PER_REQUEST)) {
        requests.push(current);
        current = [];
        rows = 0;
        group = null;
      }
      if (!group) { group = { character, captures: [] }; current.push(group); }
      group.captures.push(capture);
      rows += n;
    }
  }
  if (current.length) requests.push(current);
  return requests;
}

/** When a 429's Retry-After lets the next request go: seconds or an HTTP date. */
function retryAt(header: string | null, now: number): number {
  const value = header?.trim() ?? "";
  if (/^\d+$/.test(value)) return now + Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : now;
}

/** Why a whole request was turned away. */
function problemOf(status: number): string {
  if (status === 401) return "everloot.app refused your account key; it may have been revoked. Sign in again under Settings > Account.";
  if (status === 403) return "make a key with \"Sync my linked characters\" on everloot.app and sign in with it under Settings > Account.";
  if (status === 429) return "everloot.app asked to wait. Your characters sync again later.";
  return `everloot.app could not sync characters right now (HTTP ${status}). They go again next time.`;
}

type Answer = { index?: unknown; result?: unknown; categories?: unknown };

export async function sendSync(file: string, options: SyncSendOptions): Promise<SyncSendResult> {
  const result: SyncSendResult = { synced: [], syncOff: [], notLinked: [], refused: [], waiting: 0, tooLarge: 0, problem: null };
  // No key for this site, no sync: making a key with "Sync my linked characters" is the player's opt-in.
  if (!options.key) return result;
  const origin = new URL(options.endpoint).origin;
  const now = options.now ?? Date.now;
  if ((waitUntil.get(origin) ?? 0) > now()) return result;
  const text = readFileSync(file, "utf8");
  // Without a link row no character can be named; skip the parse.
  if (!text.includes("character_link")) return result;
  const parsed = parseEverlootLua(text);
  const receiptKey = (c: Character) => syncReceiptKey(parsed.installId, options.endpoint, c.id);
  const characters = charactersOf(parsed.records);
  // Only the current capture of each category is remembered; older answers are dropped.
  for (const c of characters) options.state.keepOnly(receiptKey(c), new Set(c.captures.map((x) => x.entry)));
  const pending = characters
    .map((c) => ({ ...c, captures: c.captures.filter((x) => !options.state.has(receiptKey(c), x.entry)) }))
    .filter((c) => c.captures.length);
  if (!pending.length) return result;

  const url = new URL("/api/me/characters/sync", origin).href;
  const send = options.fetch ?? fetch;
  const kept = new Set<string>(), off = new Set<string>(), notLinked = new Set<string>(), refused = new Set<string>(), waiting = new Set<string>();
  const requests = requestsOf(pending, result);
  for (let n = 0; n < requests.length; n++) {
    const batch = requests[n]!;
    const rest = () => new Set(requests.slice(n).flat().map((g) => g.character.label));
    let response: Response, body: { characters?: unknown } | null;
    try {
      response = await send(url, {
        method: "POST",
        headers: { authorization: `Bearer ${options.key}`, "content-type": "application/json", "user-agent": "everloot-desktop" },
        body: JSON.stringify({ characters: batch.map((g) => ({ name: g.character.name, realm: g.character.realm, records: g.captures.flatMap((x) => x.records) })) }),
        redirect: "error",
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
      body = await response.json().catch(() => null);
    } catch {
      for (const label of rest()) waiting.add(label);
      result.problem = "could not reach everloot.app. Your characters sync next time.";
      break;
    }
    // The site's switch is off: nothing more goes this run, and nothing is said.
    if (response.status === 404) break;
    const answers = Array.isArray(body?.characters) ? (body.characters as Answer[]) : null;
    if (!answers || (response.status !== 200 && response.status !== 503)) {
      for (const label of rest()) waiting.add(label);
      if (response.status === 429) waitUntil.set(origin, retryAt(response.headers.get("retry-after"), now()));
      result.problem = problemOf(response.status);
      break;
    }
    batch.forEach((group, index) => {
      const answer = answers.find((a) => a?.index === index);
      const label = group.character.label;
      const answered: string[] = [];
      if (answer?.result === "synced") {
        const outcomes = (answer.categories && typeof answer.categories === "object" ? answer.categories : {}) as Record<string, unknown>;
        for (const capture of group.captures) {
          const outcome = outcomes[capture.category];
          if (outcome === "stored" || outcome === "duplicate" || outcome === "older") kept.add(label);
          // Sync off is not remembered: the player may turn it on later, and the same capture must go then.
          else if (outcome === "no_consent") { off.add(label); continue; }
          answered.push(capture.entry);
        }
      } else if (answer?.result === "not_linked") {
        // Not remembered either: a link made or settled later must still get this capture.
        notLinked.add(label);
      } else if (answer?.result === "mismatch" || answer?.result === "invalid") {
        refused.add(label);
        answered.push(...group.captures.map((x) => x.entry));
      } else waiting.add(label);
      if (answered.length) options.state.add(receiptKey(group.character), answered);
    });
  }
  result.synced = [...kept];
  result.syncOff = [...off].filter((l) => !kept.has(l));
  result.notLinked = [...notLinked];
  result.refused = [...refused];
  result.waiting = waiting.size;
  return result;
}

const characters = (n: number) => `${n} ${n === 1 ? "character" : "characters"}`;

/** One line for the app's status, or null when nothing was sent or said. */
export function syncSummary(r: SyncSendResult): string | null {
  const parts = [
    r.synced.length ? `synced ${characters(r.synced.length)}` : "",
    r.syncOff.length ? `${characters(r.syncOff.length)} not synced: turn sync on for ${r.syncOff.length === 1 ? "it" : "them"} on everloot.app` : "",
    r.notLinked.length ? `${r.notLinked.join(", ")} not linked to your account` : "",
    r.refused.length ? `${r.refused.join(", ")} not synced: the site did not match ${r.refused.length === 1 ? "it" : "them"} to the link` : "",
    r.tooLarge ? `${r.tooLarge} sync ${r.tooLarge === 1 ? "category" : "categories"} too large to send` : "",
    r.problem ? `sync: ${r.problem}` : r.waiting ? `${characters(r.waiting)} ${r.waiting === 1 ? "syncs" : "sync"} next time` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}
