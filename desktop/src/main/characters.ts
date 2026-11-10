import { parseEverlootLua, parseEverlootTable } from "../../../web/src/lib/sv-parse";
import { DAY_MS, directionOf, periodStart } from "../shared/ledger";
import type { CharacterRow, CharactersInfo, ProgressRow } from "../shared/types";

/**
 * What the addon knows about the player's own characters, read from the save file and shown only
 * here. This is the named data the upload never sends from the app (gold, gear, progress); it stays
 * on the machine unless the player shares it on the website with a verified grant.
 */

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export const HISTORY_POINTS = 60;
// In and out follow the addon's ledger (addon/modules/ledger.lua, mirrored in shared/ledger.ts): `vendor` is money
// in, since the addon writes it only for gold gained at a merchant (addon/modules/gold.lua); `vendor_spend` is out.
// The nine uploaded categories read the same way on the website ledger (kb/src/gold-ledger.ts).
const WEEK_DAYS = 7;
const MONEY_DAYS = 30;
const RECEIPTS = 12;

/** Keeps at most `max` points of a series, always the first and the last. */
export function thin<T>(points: T[], max = HISTORY_POINTS): T[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

export function summarizeCharacters(text: string, now = Date.now()): CharactersInfo {
  const { ledger, roster } = parseEverlootTable(text);
  return charactersAt(collectCharacters(parseEverlootLua(text).records, { ledger, roster }), now);
}

type MoneyEvent = { at: string; ms: number; category: string; copper: number; direction: "in" | "out" };

/**
 * The part of the summary that depends on the file alone, kept per write by saveFacts. Its rows are shared between
 * calls and not changed after; charactersAt adds what depends on the time of the call.
 */
export interface CharacterBase extends CharactersInfo { money: Map<string, MoneyEvent[]> }

/**
 * The two local-only tables beside the records (addon/README.md, "The Gold tab and the character list on Home"):
 * `EverlootDB.ledger`, the window's money events keyed by the opaque character key, and `EverlootDB.roster`, which
 * names each key. Either may be missing from a file written before they existed.
 */
export interface LocalTables { ledger?: unknown; roster?: unknown }

type LedgerEvent = MoneyEvent & { character: string; realm: string };

const whole = (v: unknown, least: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= least;

/**
 * The ledger's money events as the rows the Gold tab counts, each with its character's name and realm from the
 * roster. A row the roster cannot name, or that does not read cleanly, is left out, as the addon leaves out an
 * uploaded row it cannot key (addon/modules/ledger.lua, recordRows).
 */
function ledgerEvents({ ledger, roster }: LocalTables): LedgerEvent[] {
  const events = ledger && typeof ledger === "object" ? (ledger as { events?: unknown }).events : undefined;
  if (!Array.isArray(events) || !roster || typeof roster !== "object" || Array.isArray(roster)) return [];
  const rows = roster as Record<string, unknown>;
  const out: LedgerEvent[] = [];
  for (const e of events as unknown[]) {
    if (!e || typeof e !== "object") continue;
    const { key, at, category, copper } = e as Record<string, unknown>;
    const who = typeof key === "string" ? rows[key] : undefined;
    const character = who && typeof who === "object" ? str((who as Record<string, unknown>).name) : "";
    const realm = who && typeof who === "object" ? str((who as Record<string, unknown>).realm) : "";
    if (!character || !realm || !whole(at, 0) || !whole(copper, 1) || !str(category)) continue;
    const ms = at * 1000;
    const cat = str(category);
    out.push({ character, realm, at: new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z"), ms, category: cat, copper, direction: directionOf(cat) });
  }
  return out;
}

/**
 * Everything in the summary but the last seven days, the 30 days and the receipts, from records already read.
 * Money comes from the ledger when the file has one; `money_event` records count only from before the ledger's
 * oldest event, the way the Gold tab reads them, so a file from before the ledger still shows its money.
 */
export function collectCharacters(records: Array<Record<string, unknown>>, local: LocalTables = {}): CharacterBase {
  const ledger = ledgerEvents(local);
  const ledgerFrom = ledger.reduce((min, e) => Math.min(min, e.ms), Infinity);
  const named = new Map<string, CharacterRow>();
  const keyed = new Map<string, ProgressRow>();
  const gearAt = new Map<string, string>();
  const money = new Map<string, MoneyEvent[]>();
  const row = (r: Record<string, unknown>): CharacterRow | null => {
    const character = str(r.character), realm = str(r.realm);
    if (!character || !realm) return null;
    const id = `${character}-${realm}`;
    let c = named.get(id);
    if (!c) { c = { character, realm, gold: null, peakGold: null, gearSlots: 0, itemLevel: null, equipped: [], spent: {}, earned: {}, history: [], week: { earned: 0, spent: 0 }, days: [], receipts: [] }; named.set(id, c); }
    return c;
  };
  const prog = (r: Record<string, unknown>): ProgressRow | null => {
    const key = str(r.characterKey);
    if (!key) return null;
    let p = keyed.get(key);
    if (!p) { p = { key, class: str(r.class) || "?", level: num(r.level), achievements: 0, achievementsInProgress: 0, reputations: 0, exalted: 0, titles: 0, quests: 0, talentPoints: null, professions: [], lockouts: [] }; keyed.set(key, p); }
    if (num(r.level) > p.level) p.level = num(r.level);
    if (str(r.class)) p.class = str(r.class);
    return p;
  };
  const titles = new Map<string, Set<number>>(), quests = new Map<string, Set<number>>(), achievements = new Map<string, Map<number, boolean>>(), reps = new Map<string, Map<number, number>>();
  for (const r of records) {
    switch (r.kind) {
      case "gold_snapshot": {
        const c = row(r); if (!c) break;
        c.gold = num(r.currentCopper); c.peakGold = Math.max(c.peakGold ?? 0, num(r.peakCopper));
        if (str(r.capturedAt)) c.history.push({ at: str(r.capturedAt), copper: num(r.currentCopper) });
        break;
      }
      case "gear_snapshot": {
        const c = row(r); if (!c) break;
        const eq = Array.isArray(r.equipped) ? (r.equipped as Record<string, unknown>[]) : [];
        if (!eq.length) break;
        const id = `${c.character}-${c.realm}`, at = str(r.capturedAt), seen = gearAt.get(id) ?? "";
        if (c.equipped.length && !(at && at > seen)) break;
        c.equipped = eq.map((e) => ({ slot: str(e.slot), itemLevel: num(e.itemLevel) })).filter((e) => e.slot && e.itemLevel > 0);
        c.gearSlots = c.equipped.length;
        c.itemLevel = c.gearSlots ? Math.round(c.equipped.reduce((s, e) => s + e.itemLevel, 0) / c.gearSlots) : null;
        gearAt.set(id, at);
        break;
      }
      case "money_event": {
        const at = Date.parse(str(r.capturedAt));
        // With a ledger, an uploaded row counts only when it is dated before the ledger's first event.
        if (ledger.length && !(Number.isFinite(at) && at < ledgerFrom)) break;
        const c = row(r); if (!c) break;
        const cat = str(r.category), copper = num(r.copper);
        const direction = directionOf(cat);
        const bucket = direction === "out" ? c.spent : c.earned;
        bucket[cat] = (bucket[cat] ?? 0) + copper;
        if (Number.isFinite(at)) {
          const id = `${c.character}-${c.realm}`;
          const list = money.get(id) ?? [];
          list.push({ at: str(r.capturedAt), ms: at, category: cat, copper, direction });
          money.set(id, list);
        }
        break;
      }
      case "achievement_owned": { const p = prog(r); if (!p) break; const m = achievements.get(p.key) ?? new Map<number, boolean>(); m.set(num(r.achievementId), r.completed === true); achievements.set(p.key, m); break; }
      case "reputation_owned": { const p = prog(r); if (!p) break; const m = reps.get(p.key) ?? new Map<number, number>(); m.set(num(r.factionId), num(r.reaction)); reps.set(p.key, m); break; }
      case "title_owned": { const p = prog(r); if (!p) break; const s = titles.get(p.key) ?? new Set<number>(); for (const id of (Array.isArray(r.titleIds) ? r.titleIds : []) as unknown[]) s.add(num(id)); titles.set(p.key, s); break; }
      case "quest_owned": { const p = prog(r); if (!p) break; const s = quests.get(p.key) ?? new Set<number>(); for (const id of (Array.isArray(r.questIds) ? r.questIds : []) as unknown[]) s.add(num(id)); quests.set(p.key, s); break; }
      // The addon keeps only the latest state of these two (addon/modules/owned.lua); a row the game gave no numbers
      // for is not written there, and one that arrives without them here is left out, never shown as zero.
      case "profession_owned": {
        const name = str(r.profession), rank = r.rank, max = r.maxRank;
        if (!name || typeof rank !== "number" || typeof max !== "number" || max <= 0) break;
        const p = prog(r); if (!p) break;
        p.professions = [...p.professions.filter((x) => x.name !== name), { name, rank, maxRank: max }];
        break;
      }
      case "lockout_owned": {
        const instance = str(r.instance), killed = r.bossesKilledCount, total = r.bossesTotal, resetAt = str(r.resetAt);
        if (!instance || typeof killed !== "number" || typeof total !== "number" || total <= 0 || !Number.isFinite(Date.parse(resetAt))) break;
        const p = prog(r); if (!p) break;
        const difficulty = str(r.difficulty);
        p.lockouts = [...p.lockouts.filter((x) => x.instance !== instance || x.difficulty !== difficulty), { instance, difficulty, killed, total, resetAt }];
        break;
      }
      default: break;
    }
  }
  for (const e of ledger) {
    const c = row(e); if (!c) continue;
    const bucket = e.direction === "out" ? c.spent : c.earned;
    bucket[e.category] = (bucket[e.category] ?? 0) + e.copper;
    const id = `${c.character}-${c.realm}`;
    const list = money.get(id) ?? [];
    list.push({ at: e.at, ms: e.ms, category: e.category, copper: e.copper, direction: e.direction });
    money.set(id, list);
  }
  for (const [key, p] of keyed) {
    const a = achievements.get(key);
    if (a) { p.achievements = [...a.values()].filter(Boolean).length; p.achievementsInProgress = [...a.values()].filter((v) => !v).length; }
    const rp = reps.get(key);
    if (rp) { p.reputations = rp.size; p.exalted = [...rp.values()].filter((v) => v >= 8).length; }
    p.titles = titles.get(key)?.size ?? 0;
    p.quests = quests.get(key)?.size ?? 0;
  }
  // Talent snapshots carry class and level but no key or name; count the active one per class as a hint.
  const talents = records.filter((r) => r.kind === "talent_snapshot" && r.active === true).map((r) => ({ class: str(r.class), level: num(r.level), points: num(r.points) }));
  for (const c of named.values()) c.history = thin(c.history.sort((a, b) => a.at.localeCompare(b.at)));
  return {
    characters: [...named.values()].sort((a, b) => (b.gold ?? 0) - (a.gold ?? 0)),
    progress: [...keyed.values()].sort((a, b) => b.level - a.level),
    talents,
    money,
  };
}

/** The summary at `now`: each character's last seven days, 30 days and latest receipts, on a copy of its row. */
export function charactersAt(base: CharacterBase, now = Date.now()): CharactersInfo {
  const start = periodStart(now, MONEY_DAYS);
  const characters = base.characters.map((c) => {
    const all = base.money.get(`${c.character}-${c.realm}`) ?? [];
    // The Gold tab's "7 days": today and the six whole UTC days before it (addon/modules/ledger.lua, L.Period).
    const weekStart = periodStart(now, WEEK_DAYS);
    const week = { earned: 0, spent: 0 };
    for (const e of all) if (e.ms >= weekStart && e.ms <= now) week[e.direction === "out" ? "spent" : "earned"] += e.copper;
    const events = all.filter((e) => e.ms >= start && e.ms <= now).sort((a, b) => a.ms - b.ms);
    const days = Array.from({ length: MONEY_DAYS }, (_, i) => ({ date: new Date(start + i * DAY_MS).toISOString().slice(0, 10), earned: 0, spent: 0 }));
    const where = new Map(days.map((d, i) => [d.date, i]));
    for (const e of events) {
      const i = where.get(new Date(e.ms).toISOString().slice(0, 10));
      if (i === undefined) continue;
      if (e.direction === "out") days[i].spent += e.copper; else days[i].earned += e.copper;
    }
    const receipts = events.slice(-RECEIPTS).reverse().map((e) => ({ at: e.at, category: e.category, copper: e.copper, direction: e.direction }));
    return { ...c, week, days, receipts };
  });
  // A lockout past its reset is over in the game too, whenever the addon last read the list.
  const progress = base.progress.map((p) => ({ ...p, lockouts: p.lockouts.filter((l) => Date.parse(l.resetAt) > now) }));
  return { characters, progress, talents: base.talents };
}
