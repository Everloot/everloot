import { readFileSync } from "node:fs";
import { parseEverlootLua } from "../../../web/src/lib/sv-parse";
import { SPENDING_CATEGORIES } from "../../../kb/src/gold-ledger";
import type { CharacterRow, CharactersInfo, ProgressRow } from "../shared/types";

/**
 * What the addon knows about the player's own characters, read from the save file and shown only
 * here. This is the named data the upload never sends from the app (gold, gear, progress); it stays
 * on the machine unless the player shares it on the website with a verified grant.
 */

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export const HISTORY_POINTS = 60;
// In and out follow the server ledger (kb/src/gold-ledger.ts): `vendor` is money in, since the addon writes it only
// for gold gained at a merchant (addon/modules/gold.lua). The website ledger reads the same list.
const SPENT: readonly string[] = SPENDING_CATEGORIES;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const MONEY_DAYS = 30;
const RECEIPTS = 12;

/** Keeps at most `max` points of a series, always the first and the last. */
export function thin<T>(points: T[], max = HISTORY_POINTS): T[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

export function summarizeCharacters(text: string, now = Date.now()): CharactersInfo {
  return summarizeRecords(parseEverlootLua(text).records, now);
}

/** The same summary from records already read: saveFacts takes the character realms from it without a second parse. */
export function summarizeRecords(records: Array<Record<string, unknown>>, now = Date.now()): CharactersInfo {
  const named = new Map<string, CharacterRow>();
  const keyed = new Map<string, ProgressRow>();
  const gearAt = new Map<string, string>();
  const money = new Map<string, { at: string; ms: number; category: string; copper: number; direction: "in" | "out" }[]>();
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
    if (!p) { p = { key, class: str(r.class) || "?", level: num(r.level), achievements: 0, achievementsInProgress: 0, reputations: 0, exalted: 0, titles: 0, quests: 0, talentPoints: null }; keyed.set(key, p); }
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
        const c = row(r); if (!c) break;
        const cat = str(r.category), copper = num(r.copper);
        const out = SPENT.includes(cat);
        const bucket = out ? c.spent : c.earned;
        bucket[cat] = (bucket[cat] ?? 0) + copper;
        const at = Date.parse(str(r.capturedAt));
        if (Number.isFinite(at) && now - at <= WEEK_MS) c.week[out ? "spent" : "earned"] += copper;
        if (Number.isFinite(at)) {
          const id = `${c.character}-${c.realm}`;
          const list = money.get(id) ?? [];
          list.push({ at: str(r.capturedAt), ms: at, category: cat, copper, direction: out ? "out" : "in" });
          money.set(id, list);
        }
        break;
      }
      case "achievement_owned": { const p = prog(r); if (!p) break; const m = achievements.get(p.key) ?? new Map<number, boolean>(); m.set(num(r.achievementId), r.completed === true); achievements.set(p.key, m); break; }
      case "reputation_owned": { const p = prog(r); if (!p) break; const m = reps.get(p.key) ?? new Map<number, number>(); m.set(num(r.factionId), num(r.reaction)); reps.set(p.key, m); break; }
      case "title_owned": { const p = prog(r); if (!p) break; const s = titles.get(p.key) ?? new Set<number>(); for (const id of (Array.isArray(r.titleIds) ? r.titleIds : []) as unknown[]) s.add(num(id)); titles.set(p.key, s); break; }
      case "quest_owned": { const p = prog(r); if (!p) break; const s = quests.get(p.key) ?? new Set<number>(); for (const id of (Array.isArray(r.questIds) ? r.questIds : []) as unknown[]) s.add(num(id)); quests.set(p.key, s); break; }
      default: break;
    }
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
  const at = new Date(now);
  const end = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const start = end - (MONEY_DAYS - 1) * DAY_MS;
  for (const c of named.values()) {
    const id = `${c.character}-${c.realm}`;
    const events = (money.get(id) ?? []).filter((e) => e.ms >= start && e.ms <= now).sort((a, b) => a.ms - b.ms);
    const days = Array.from({ length: MONEY_DAYS }, (_, i) => ({ date: new Date(start + i * DAY_MS).toISOString().slice(0, 10), earned: 0, spent: 0 }));
    const where = new Map(days.map((d, i) => [d.date, i]));
    for (const e of events) {
      const i = where.get(new Date(e.ms).toISOString().slice(0, 10));
      if (i === undefined) continue;
      if (e.direction === "out") days[i].spent += e.copper; else days[i].earned += e.copper;
    }
    c.days = days;
    c.receipts = events.slice(-RECEIPTS).reverse().map((e) => ({ at: e.at, category: e.category, copper: e.copper, direction: e.direction }));
    c.history = thin(c.history.sort((a, b) => a.at.localeCompare(b.at)));
  }
  return {
    characters: [...named.values()].sort((a, b) => (b.gold ?? 0) - (a.gold ?? 0)),
    progress: [...keyed.values()].sort((a, b) => b.level - a.level),
    talents,
  };
}

export function charactersFromFiles(files: string[]): CharactersInfo {
  const all: CharactersInfo = { characters: [], progress: [], talents: [] };
  for (const file of files) {
    try {
      const one = summarizeCharacters(readFileSync(file, "utf8"));
      all.characters.push(...one.characters); all.progress.push(...one.progress); all.talents.push(...one.talents);
    } catch { /* an unreadable file shows on the Upload page */ }
  }
  return all;
}
