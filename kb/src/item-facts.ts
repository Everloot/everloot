/**
 * The numbers on an item's tooltip that the game files do not hold (armour, block, damage per second, stats,
 * resistances), from what players' own clients showed (`item_fact`, addon 0.3.10). A number is public under the
 * 3-install rule of item-page.ts: it is shown when 3 installs report the same value for the same line and no other
 * value has 3. When installs report the line but no single value has 3 of them, or two values each have 3, the line
 * is contested and no number is shown.
 *
 * A patch can change an item's numbers, so each line is decided within one client build: the newest build in which
 * 3 installs report the line. Older reports never outvote it. Each install counts once, with the value from its
 * latest row in that build. Each shown number carries its install count, the build and when it was last seen: the
 * latest `capturedAt` among the agreeing rows, leaving out any time after `asOf`.
 */
import { ITEM_FACTS } from "@everloot/protocol";
import { latest } from "./instances.js";
import { ITEM_AGREEMENT } from "./item-page.js";

export type ItemFactName = (typeof ITEM_FACTS)[number];

export interface ItemFactRow {
  installId: string;
  itemId: number;
  fact: ItemFactName;
  value: number;
  clientBuild: string;
  capturedAt?: string;
}

/** A number 3 installs agree on. */
export interface ReportedFact {
  fact: ItemFactName;
  value: number;
  /** Installs that reported this value in `build`. */
  reporters: number;
  build: string;
  /** The latest time an agreeing install reported it, as ISO; null when no row carries a time. */
  lastSeen: string | null;
}

export interface ItemFactState {
  /** Agreed numbers, in `ITEM_FACTS` order (the game's: armour, block, damage, stats, resistances). */
  shown: ReportedFact[];
  /** Lines 3 or more installs reported without agreeing on one number, in the same order. */
  contested: ItemFactName[];
}

export const NO_REPORTED_FACTS: ItemFactState = { shown: [], contested: [] };

export interface ItemFactProgress {
  fact: ItemFactName;
  reporters: number;
  build: string;
}

const FACTS = new Set<string>(ITEM_FACTS);
const BUILD = /^\d+(\.\d+)+$/;

/** The rows that are well formed item facts, by item id. */
export function itemFactRowsFromRecords(records: unknown[]): Map<number, ItemFactRow[]> {
  const out = new Map<number, ItemFactRow[]>();
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (r.kind !== "item_fact" || typeof r.installId !== "string" || !r.installId.trim()) continue;
    if (typeof r.itemId !== "number" || !Number.isInteger(r.itemId) || r.itemId < 1) continue;
    if (typeof r.fact !== "string" || !FACTS.has(r.fact) || typeof r.value !== "number" || !Number.isFinite(r.value)) continue;
    if (typeof r.clientBuild !== "string" || !BUILD.test(r.clientBuild)) continue;
    const row: ItemFactRow = {
      installId: r.installId.trim(), itemId: r.itemId, fact: r.fact as ItemFactName, value: r.value, clientBuild: r.clientBuild,
      ...(typeof r.capturedAt === "string" && Number.isFinite(Date.parse(r.capturedAt)) ? { capturedAt: r.capturedAt } : {}),
    };
    out.set(r.itemId, [...(out.get(r.itemId) ?? []), row]);
  }
  return out;
}

/** Newer build first: 1.60.10 after 1.60.9. */
function compareBuilds(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] ?? 0) - (x[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const time = (r: ItemFactRow) => (r.capturedAt === undefined ? -Infinity : Date.parse(r.capturedAt));
/** One decimal is the most the tooltip prints, so values are compared at that precision. */
const key = (value: number) => value.toFixed(1);

/** Counts only, for undecided lines in their newest reported build. Never includes a value. */
export function itemFactProgress(rows: readonly ItemFactRow[] | undefined): ItemFactProgress[] {
  const progress: ItemFactProgress[] = [];
  for (const fact of ITEM_FACTS) {
    const reported = rows?.filter((r) => r.fact === fact) ?? [];
    const builds = [...new Set(reported.map((r) => r.clientBuild))].sort(compareBuilds);
    // A shown or contested line already has a decision; a newer partial build must not relabel it unconfirmed.
    if (builds.some((b) => new Set(reported.filter((r) => r.clientBuild === b).map((r) => r.installId)).size >= ITEM_AGREEMENT)) continue;
    const build = builds[0];
    if (!build) continue;
    const reporters = new Set(reported.filter((r) => r.clientBuild === build).map((r) => r.installId)).size;
    if (reporters < ITEM_AGREEMENT) progress.push({ fact, reporters, build });
  }
  return progress;
}

/** One item's agreed and contested lines, from its rows (the item's entry of `itemFactRowsFromRecords`). */
export function reportedItemFacts(rows: readonly ItemFactRow[] | undefined, asOf: Date = new Date()): ItemFactState {
  if (!rows?.length) return NO_REPORTED_FACTS;
  const state: ItemFactState = { shown: [], contested: [] };
  for (const fact of ITEM_FACTS) {
    const byBuild = new Map<string, ItemFactRow[]>();
    for (const r of rows) if (r.fact === fact) byBuild.set(r.clientBuild, [...(byBuild.get(r.clientBuild) ?? []), r]);
    for (const build of [...byBuild.keys()].sort(compareBuilds)) {
      // Each install's latest row in this build is its vote.
      const votes = new Map<string, ItemFactRow>();
      for (const r of byBuild.get(build)!) {
        const prior = votes.get(r.installId);
        if (!prior || time(r) >= time(prior)) votes.set(r.installId, r);
      }
      if (votes.size < ITEM_AGREEMENT) continue;
      const byValue = new Map<string, ItemFactRow[]>();
      for (const r of votes.values()) byValue.set(key(r.value), [...(byValue.get(key(r.value)) ?? []), r]);
      const winners = [...byValue.values()].filter((list) => list.length >= ITEM_AGREEMENT);
      if (winners.length === 1) {
        const agreed = winners[0]!;
        state.shown.push({ fact, value: Number(key(agreed[0]!.value)), reporters: agreed.length, build, lastSeen: latest(agreed, asOf) });
      } else {
        state.contested.push(fact);
      }
      break;
    }
  }
  return state;
}
