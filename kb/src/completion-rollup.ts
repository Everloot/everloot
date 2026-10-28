/**
 * The completion rollup: a compact fold of the eight completion kinds, kept apart from the corpus
 * (kb/src/corpus.ts skips them) so the corpus every page loads does not carry them.
 *
 * Catalog entries are votes. A voter is an upload address (the intake's keyed hash, as the market
 * counts it), or the install when an upload carries none. A voter backs one content per entry, the one
 * it reported last; an entry is listed once 3 voters back the identical content, and among such
 * contents the most supported wins, then the one confirmed first. Supporters are counted up to a sample
 * of 64. The contents one voter, one install or one upload may create are capped, by count and, per voter,
 * by bytes. Of the catalog, whatever has the fewest supporters (then was seen least recently) is the first
 * thing evicted or trimmed, and all of it is trimmed before any progress an owner still shares.
 *
 * An achievement's criteria list is its own vote (bucket `c`), with its own creation caps, so a long list
 * never costs a voter the entries themselves. It is shown only next to an agreed entry.
 *
 * Owned rows keep only the latest row per (install, character, id), and titles and completed quests as
 * one sorted union. Owned data is shown only for installs whose current grant covers the collection
 * category (authorizedOwners).
 *
 * The voter of each content's creator is stored with the install it came from (`by`), so the stored
 * rollup links an address hash to an install id until a rebuild drops uploads that were deleted.
 */
import { COMPLETION_KINDS, parseRecords } from "@everloot/protocol";
import type { IntakeRecord } from "@everloot/protocol";
import { canonicalJson } from "./corpus.js";
import { authorizeRecord, type PublicationState } from "./publication.js";
import type { CompletionFacts, OwnedCharacter } from "./completion.js";

export const COMPLETION_AGREEMENT = 3;
/** The rollup file is refused past this size on read; a write trims to stay well under it. */
export const COMPLETION_MAX_BYTES = 32_000_000;
export const COMPLETION_LIMITS = {
  idsPerKind: 20_000,
  variantsPerId: 3,
  /** Distinct supporters remembered per content; the count stops here. */
  sample: 64,
  /** Contents one voter or one install may have created and still in the rollup, confirmed or not (a real install creates about 3000). */
  createdPerVoter: 5000,
  createdPerInstall: 5000,
  /** Bytes of listed content one voter may have created and still in the rollup (a real install creates about 500 KB). */
  createdBytesPerVoter: 1_000_000,
  /** New contents one upload may add. */
  newPerUpload: 4000,
  /** Canonical JSON of the listed fields of one entry. */
  contentBytes: 2048,
  /** Canonical JSON of one achievement's criteria list; a longer list is not voted on. */
  criteriaBytes: 8192,
  charactersPerInstall: 8,
  grantsPerInstall: 8,
  installs: 20_000,
  /** An id is evicted for a new one only while its best content has at most this many supporters. */
  evictableSupport: COMPLETION_AGREEMENT,
};

/**
 * c: listed fields as canonical JSON; v: supporters (voter keys), at most `sample`; s: last seen (epoch s);
 * f: when it was first confirmed (epoch s); by: creator [voter, install].
 */
type Variant = { c: string; v: string[]; s: number; f?: number; by: [string, string] };
type CatalogKey = "a" | "f" | "t" | "q" | "c";
const KEYS = ["a", "f", "t", "q", "c"] as const;
type Stamp = { at: string; n: number };
type AchState = Stamp & { c: boolean; e?: boolean; m: number; t: number; q?: number; r?: number; d?: string };
type RepState = Stamp & { k: number; s: number; lo: number; hi: number };
export type CharacterState = {
  class: string; level: number; at: string; n: number;
  a: Record<string, AchState>; f: Record<string, RepState>; t: number[]; q: number[];
};
export type InstallState = { grants: string[]; characters: Record<string, CharacterState>; dropped: number };
export type CompletionState = {
  version: 2;
  /** `c` (achievement criteria) is absent from rollups written before it existed. */
  catalog: Record<Exclude<CatalogKey, "c">, Record<string, Variant[]>> & { c?: Record<string, Variant[]> };
  /** Keyed by install id, which is free text: a null-prototype object, so "__proto__" is an ordinary key. */
  owned: Record<string, InstallState>;
};
export type CompletionUpload = { records: readonly unknown[]; grants: readonly string[]; reporter?: string; receivedAt?: string };

const table = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

export function emptyCompletion(): CompletionState {
  return { version: 2, catalog: { a: table(), f: table(), t: table(), q: table(), c: table() }, owned: table() };
}

/** A parsed state with null-prototype maps, so a stored key cannot reach Object.prototype. */
export function normalizeCompletion(state: CompletionState): CompletionState {
  const copy = <T>(o: Record<string, T>) => Object.assign(table<T>(), o);
  const owned = copy(state.owned);
  for (const install of Object.values(owned)) install.characters = copy(install.characters);
  return {
    version: 2,
    catalog: { a: copy(state.catalog.a), f: copy(state.catalog.f), t: copy(state.catalog.t), q: copy(state.catalog.q), c: copy(state.catalog.c ?? {}) },
    owned,
  };
}

/** The sequence number at the end of an event id ("epoch:12" is 12), compared as a number. */
export function eventSeq(eventId: string | undefined): number {
  const n = Number((eventId ?? "").split(":").pop());
  return Number.isFinite(n) ? n : 0;
}

/** True when (at, n) is later than the stamp. Capture time first, then the numeric sequence. */
function later(row: { capturedAt: string; eventId?: string }, stamp: Stamp): boolean {
  const order = row.capturedAt.localeCompare(stamp.at);
  return order > 0 || (order === 0 && eventSeq(row.eventId) >= stamp.n);
}

const CATALOG_BUCKET: Record<string, CatalogKey> = {
  achievement_catalog: "a", reputation_catalog: "f", title_catalog: "t", quest_chain_catalog: "q",
};

/** The id and the fields the lists show. Agreement is on these; category ids are not shown. */
function listed(row: IntakeRecord): { id: number; fields: Record<string, unknown> } | null {
  switch (row.kind) {
    case "achievement_catalog": return { id: row.achievementId, fields: { name: row.name, category: row.category, points: row.points, criteriaCount: row.criteriaCount } };
    case "reputation_catalog": return { id: row.factionId, fields: { name: row.name, header: row.header, major: row.major === true } };
    case "title_catalog": return { id: row.titleId, fields: { name: row.name } };
    case "quest_chain_catalog": return { id: row.questLineId, fields: { name: row.name, questIds: row.questIds, truncated: row.truncated === true } };
    default: return null;
  }
}

/**
 * An achievement's criteria as one content: only a complete list (every criterion kept, each with its wording),
 * so a cut-off or blank list is never voted on.
 */
function criteriaOf(row: IntakeRecord): { id: number; fields: Record<string, unknown> } | null {
  if (row.kind !== "achievement_catalog" || row.criteriaCount === 0 || row.criteria.length !== row.criteriaCount) return null;
  if (row.criteria.some((c) => !c.text.trim())) return null;
  return { id: row.achievementId, fields: { criteria: row.criteria.map((c) => [c.text, c.required]) } };
}

const confirmed = (v: Variant) => v.v.length >= COMPLETION_AGREEMENT;
/** Fewest supporters first, then least recently seen. */
const weaker = (x: Variant, y: Variant) => x.v.length - y.v.length || x.s - y.s;
const support = (vs: Variant[]) => vs.reduce((n, v) => Math.max(n, v.v.length), 0);
const lastSeen = (vs: Variant[]) => vs.reduce((n, v) => Math.max(n, v.s), 0);

/**
 * What one fold keeps between rows, computed once from the state: ids per kind, contents per creator, and
 * per kind the queue of ids a new id may evict (null once it ran dry), so no row scans the whole catalog.
 */
type FoldIndex = {
  ids: Record<CatalogKey, number>;
  /** Creation counts per voter and install; the criteria bucket counts under its own "c|" keys. */
  voter: Map<string, number>;
  voterBytes: Map<string, number>;
  install: Map<string, number>;
  queue: Partial<Record<CatalogKey, { ids: string[]; next: number } | null>>;
};
function indexOf(state: CompletionState): FoldIndex {
  const ix: FoldIndex = { ids: { a: 0, f: 0, t: 0, q: 0, c: 0 }, voter: new Map(), voterBytes: new Map(), install: new Map(), queue: {} };
  for (const key of KEYS) {
    for (const variants of Object.values(state.catalog[key] ?? {})) {
      ix.ids[key]++;
      for (const v of variants) credit(ix, key, v, 1);
    }
  }
  return ix;
}
const budget = (key: CatalogKey, who: string) => (key === "c" ? `c|${who}` : who);
function credit(ix: FoldIndex, key: CatalogKey, v: Variant, delta: number) {
  const voter = budget(key, v.by[0]), install = budget(key, v.by[1]);
  ix.voter.set(voter, (ix.voter.get(voter) ?? 0) + delta);
  ix.voterBytes.set(voter, (ix.voterBytes.get(voter) ?? 0) + delta * v.c.length);
  ix.install.set(install, (ix.install.get(install) ?? 0) + delta);
}

/** Remove one id to make room for a new one: the one whose best content has the fewest supporters, then least recently seen. */
function evictOne(bucket: Record<string, Variant[]>, key: CatalogKey, ix: FoldIndex): boolean {
  let queue = ix.queue[key];
  if (queue === null) return false;
  if (queue === undefined) {
    const ids = Object.entries(bucket)
      .map(([id, vs]) => ({ id, top: support(vs), s: lastSeen(vs) }))
      .filter((x) => x.top <= COMPLETION_LIMITS.evictableSupport)
      .sort((x, y) => x.top - y.top || x.s - y.s)
      .map((x) => x.id);
    queue = ix.queue[key] = { ids, next: 0 };
  }
  while (queue.next < queue.ids.length) {
    const id = queue.ids[queue.next++];
    const vs = bucket[id];
    if (!vs) continue;
    vs.forEach((v) => credit(ix, key, v, -1));
    delete bucket[id];
    ix.ids[key]--;
    return true;
  }
  ix.queue[key] = null;
  return false;
}

type UploadContext = { voter: string; install: string; seen: number; added: number };

function foldCatalog(state: CompletionState, row: IntakeRecord, ctx: UploadContext, ix: FoldIndex) {
  const entry = listed(row);
  if (!entry) return;
  vote(state, CATALOG_BUCKET[row.kind], entry, COMPLETION_LIMITS.contentBytes, ctx, ix);
  const criteria = criteriaOf(row);
  if (criteria) vote(state, "c", criteria, COMPLETION_LIMITS.criteriaBytes, ctx, ix);
}

function vote(state: CompletionState, key: CatalogKey, entry: { id: number; fields: Record<string, unknown> }, maxBytes: number, ctx: UploadContext, ix: FoldIndex) {
  const content = canonicalJson(entry.fields);
  if (content.length > maxBytes) return;
  const bucket = (state.catalog[key] ??= table());
  const id = String(entry.id);
  let variants = bucket[id];
  let variant = variants?.find((v) => v.c === content);
  if (!variant) {
    const voter = budget(key, ctx.voter), install = budget(key, ctx.install);
    if (ctx.added >= COMPLETION_LIMITS.newPerUpload) return;
    if ((ix.voter.get(voter) ?? 0) >= COMPLETION_LIMITS.createdPerVoter) return;
    if ((ix.voterBytes.get(voter) ?? 0) + content.length > COMPLETION_LIMITS.createdBytesPerVoter) return;
    if ((ix.install.get(install) ?? 0) >= COMPLETION_LIMITS.createdPerInstall) return;
    if (!variants) {
      if (ix.ids[key] >= COMPLETION_LIMITS.idsPerKind && !evictOne(bucket, key, ix)) return;
      variants = bucket[id] = [];
      ix.ids[key]++;
    } else if (variants.length >= COMPLETION_LIMITS.variantsPerId) {
      // The least supported content leaves, the least recently seen first, so junk cannot hold the slots.
      const out = variants.reduce((x, y) => (weaker(y, x) < 0 ? y : x));
      credit(ix, key, out, -1);
      variants.splice(variants.indexOf(out), 1);
    }
    variant = { c: content, v: [], s: ctx.seen, by: [ctx.voter, ctx.install] };
    variants.push(variant);
    credit(ix, key, variant, 1);
    if (key !== "c") ctx.added++;
  }
  // Only now that the content is in does the voter's support move to it from the content it backed before.
  for (const v of variants) {
    if (v === variant) continue;
    const i = v.v.indexOf(ctx.voter);
    if (i >= 0) v.v.splice(i, 1);
  }
  if (!variant.v.includes(ctx.voter) && variant.v.length < COMPLETION_LIMITS.sample) variant.v.push(ctx.voter);
  if (confirmed(variant) && variant.f === undefined) variant.f = ctx.seen;
  variant.s = Math.max(variant.s, ctx.seen);
  // Contents nobody backs any more leave.
  const kept = variants.filter((v) => v.v.length > 0);
  for (const v of variants) if (!kept.includes(v)) credit(ix, key, v, -1);
  bucket[id] = kept;
}

/** The capture time, never later than the upload's arrival: a future clock cannot pin a row. */
function clampedAt(capturedAt: string, receivedAt: string | undefined): string {
  if (!receivedAt) return capturedAt;
  const r = Date.parse(receivedAt);
  if (!Number.isFinite(r)) return capturedAt;
  return Date.parse(capturedAt) > r ? new Date(r).toISOString() : capturedAt;
}

function installOf(state: CompletionState, installId: string, count: { n: number }): InstallState | null {
  const existing = state.owned[installId];
  if (existing) return existing;
  if (count.n >= COMPLETION_LIMITS.installs) return null;
  count.n++;
  return (state.owned[installId] = { grants: [], characters: table(), dropped: 0 });
}

/**
 * Fold uploads into the state, in order. Titles and quests are merged once at the end, so a long list is not
 * re-sorted per row. The state is changed in place and returned.
 */
export function foldCompletion(state: CompletionState, uploads: readonly CompletionUpload[]): CompletionState {
  const wanted = new Set<string>(COMPLETION_KINDS);
  const additions = new Map<CharacterState, { t: Set<number>; q: Set<number> }>();
  let ix: FoldIndex | null = null;
  const installs = { n: Object.keys(state.owned).length };
  for (const upload of uploads) {
    const mine = upload.records.filter((r) => typeof r === "object" && r !== null && wanted.has((r as { kind?: string }).kind ?? ""));
    if (!mine.length) continue;
    const touched = new Set<InstallState>();
    const ctxs = new Map<string, UploadContext>();
    for (const parsed of parseRecords(mine).records) {
      if (!parsed.eventId) continue;
      const row = { ...parsed, capturedAt: clampedAt(parsed.capturedAt, upload.receivedAt) } as IntakeRecord;
      if (row.kind in CATALOG_BUCKET) {
        let ctx = ctxs.get(row.installId);
        if (!ctx) {
          const seen = Math.floor(Date.parse(upload.receivedAt ?? row.capturedAt) / 1000);
          ctx = { voter: upload.reporter ? `r:${upload.reporter}` : `i:${row.installId}`, install: row.installId, seen: Number.isFinite(seen) ? seen : 0, added: 0 };
          ctxs.set(row.installId, ctx);
        }
        ix ??= indexOf(state);
        foldCatalog(state, row, ctx, ix);
        continue;
      }
      if (!("characterKey" in row)) continue;
      const install = installOf(state, row.installId, installs);
      if (!install) continue;
      if (!touched.has(install)) {
        touched.add(install);
        // Grants in upload order, the newest kept: an old grant gives way, not a new one.
        install.grants = [...install.grants.filter((g) => !upload.grants.includes(g)), ...upload.grants].slice(-COMPLETION_LIMITS.grantsPerInstall);
      }
      let character = install.characters[row.characterKey];
      if (!character) {
        const keys = Object.keys(install.characters);
        if (keys.length >= COMPLETION_LIMITS.charactersPerInstall) {
          // The character not seen for longest gives way (a deleted one stops being seen).
          const oldest = keys.reduce((x, y) => (install.characters[y].at < install.characters[x].at ? y : x));
          delete install.characters[oldest];
          install.dropped++;
        }
        character = install.characters[row.characterKey] = { class: row.class, level: row.level, at: "", n: 0, a: {}, f: {}, t: [], q: [] };
      }
      if (later(row, character)) { character.class = row.class; character.level = row.level; character.at = row.capturedAt; character.n = eventSeq(row.eventId); }
      const stamp = { at: row.capturedAt, n: eventSeq(row.eventId) };
      if (row.kind === "achievement_owned") {
        const old = character.a[row.achievementId];
        if (!old || later(row, old)) {
          character.a[row.achievementId] = { ...stamp, c: row.completed, e: row.earnedByMe, m: row.criteriaMet, t: row.criteriaTotal, q: row.quantity, r: row.required, d: row.earnedOn };
        }
      } else if (row.kind === "reputation_owned") {
        const old = character.f[row.factionId];
        if (!old || later(row, old)) character.f[row.factionId] = { ...stamp, k: row.reaction, s: row.standing, lo: row.floor, hi: row.ceiling };
      } else if (row.kind === "title_owned" || row.kind === "quest_owned") {
        const add = additions.get(character) ?? { t: new Set<number>(), q: new Set<number>() };
        (row.kind === "title_owned" ? row.titleIds : row.questIds).forEach((id) => add[row.kind === "title_owned" ? "t" : "q"].add(id));
        additions.set(character, add);
      }
    }
  }
  for (const [character, add] of additions) {
    if (add.t.size) character.t = [...new Set([...character.t, ...add.t])].sort((x, y) => x - y);
    if (add.q.size) character.q = [...new Set([...character.q, ...add.q])].sort((x, y) => x - y);
  }
  return state;
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/**
 * Keep the state under `maxBytes` by trimming instead of failing. Past 90% of the limit it drops, in this order,
 * catalog contents ranked fewest supporters first and then least recently seen, characters oldest first:
 *   1. contents nobody confirmed;
 *   2. characters of installs without a live grant;
 *   3. every other catalog content;
 *   4. only then characters of installs with a live grant, which happens only when owned progress alone is
 *      over the target.
 * `live` is the set of installs whose grant is live now; with it the target is 80% of the limit.
 * When it is null (the grant lookup failed) nobody can tell whose progress is still shared: step 2 drops only
 * installs that hold no grant at all, step 4 never runs, and the catalog is trimmed only as far as a write needs
 * (85%), and not at all if the progress kept is already over that, since trimming could not make it fit; the
 * caller's size check then fails the run and the next one, with the lookup working, trims properly.
 * Returns what was dropped.
 */
export function trimCompletion(state: CompletionState, maxBytes: number, live: ReadonlySet<string> | null): { size: number; variants: number; characters: number } {
  let size = bytes(state);
  const out = { size, variants: 0, characters: 0 };
  if (size <= maxBytes * 0.9) return out;
  const target = live ? maxBytes * 0.8 : maxBytes * 0.85;
  const dropVariants = (pick: (v: Variant) => boolean) => {
    const all: { bucket: Record<string, Variant[]>; id: string; v: Variant }[] = [];
    for (const bucket of Object.values(state.catalog)) if (bucket) for (const [id, vs] of Object.entries(bucket)) for (const v of vs) if (pick(v)) all.push({ bucket, id, v });
    all.sort((x, y) => weaker(x.v, y.v));
    for (const { bucket, id, v } of all) {
      if (size <= target) return;
      const vs = bucket[id];
      if (!vs) continue;
      size -= bytes(v) + 1;
      out.variants++;
      const kept = vs.filter((x) => x !== v);
      if (kept.length) bucket[id] = kept; else { delete bucket[id]; size -= id.length + 4; }
    }
  };
  const dropCharacters = (pick: (installId: string) => boolean) => {
    const all: { installId: string; key: string; at: string }[] = [];
    for (const [installId, install] of Object.entries(state.owned)) {
      if (!pick(installId)) continue;
      for (const [key, c] of Object.entries(install.characters)) all.push({ installId, key, at: c.at });
    }
    all.sort((x, y) => x.at.localeCompare(y.at));
    for (const { installId, key } of all) {
      if (size <= target) return;
      const install = state.owned[installId];
      size -= bytes(install.characters[key]) + key.length + 4;
      delete install.characters[key];
      install.dropped++;
      out.characters++;
    }
  };
  dropVariants((v) => !confirmed(v));
  if (size > target) dropCharacters(live ? (installId) => !live.has(installId) : (installId) => state.owned[installId].grants.length === 0);
  if (size > target && (live || bytes(state.owned) <= target)) dropVariants(() => true);
  if (size > target && live) dropCharacters(() => true);
  out.size = bytes(state);
  return out;
}

/** Whether a state is the shape this code writes. A stored rollup that is not is unusable, not empty. */
export function isCompletionState(value: unknown): value is CompletionState {
  const s = value as Partial<CompletionState> | null;
  return !!s && s.version === 2 && !!s.catalog && typeof s.catalog === "object" && !!s.owned && typeof s.owned === "object" &&
    (["a", "f", "t", "q"] as const).every((k) => !!s.catalog![k] && typeof s.catalog![k] === "object");
}

type Agreed = Pick<CompletionFacts, "achievements" | "factions" | "titles" | "chains">;
type Criterion = { text: string; required: number };
const agreedCache = new WeakMap<CompletionState, Agreed>();

/** One entry per id: of the contents 3 voters back, the most supported, then the one confirmed first. */
function agreedOf<T>(bucket: Record<string, Variant[]>, build: (id: number, row: Record<string, unknown>) => T): Map<number, T> {
  const out = new Map<number, T>();
  for (const [id, variants] of Object.entries(bucket)) {
    const best = variants.filter(confirmed)
      .sort((x, y) => y.v.length - x.v.length || (x.f ?? Infinity) - (y.f ?? Infinity) || x.c.localeCompare(y.c))[0];
    if (best) out.set(Number(id), build(Number(id), JSON.parse(best.c) as Record<string, unknown>));
  }
  return out;
}

/** The agreed catalog of a state, computed once per state object (the store hands out the same one while cached). */
export function agreedCatalog(state: CompletionState): Agreed {
  const hit = agreedCache.get(state);
  if (hit) return hit;
  const criteria = agreedOf(state.catalog.c ?? {}, (_id, r) => (r.criteria as [string, number][]).map(([text, required]): Criterion => ({ text, required })));
  const agreed: Agreed = {
    achievements: agreedOf(state.catalog.a, (id, r) => {
      // The criteria list shows only beside an agreed entry, and only when it is as long as that entry says.
      const list = criteria.get(id);
      return { achievementId: id, name: String(r.name), category: String(r.category), points: Number(r.points), criteriaCount: Number(r.criteriaCount), ...(list && list.length === Number(r.criteriaCount) ? { criteria: list } : {}) };
    }),
    factions: agreedOf(state.catalog.f, (id, r) => ({ factionId: id, name: String(r.name), header: r.header as string | undefined, major: r.major === true })),
    titles: agreedOf(state.catalog.t, (id, r) => ({ titleId: id, name: String(r.name) })),
    chains: agreedOf(state.catalog.q, (id, r) => ({ questLineId: id, name: String(r.name), questIds: r.questIds as number[], truncated: r.truncated === true })),
  };
  agreedCache.set(state, agreed);
  return agreed;
}

/**
 * Installs whose current grant covers owned progress, among `only` when given (a page asks about one install).
 * Authority is read now, never remembered from upload time.
 */
export function authorizedOwners(state: CompletionState, authority: PublicationState, now: Date, only?: string): Set<string> {
  const allowed = new Set<string>();
  const ids = only === undefined ? Object.keys(state.owned) : (Object.hasOwn(state.owned, only) ? [only] : []);
  for (const installId of ids) {
    const probe = { kind: "title_owned", installId, eventId: "probe:1", capturedAt: now.toISOString(), characterKey: "00000000", class: "MAGE", level: 1, titleIds: [1] } as IntakeRecord;
    if (authorizeRecord(probe, state.owned[installId].grants, authority, now)) allowed.add(installId);
  }
  return allowed;
}

/** The facts the page and the MCP tool read: the agreed catalog, and owned progress for installs in `owners` (and `only`). */
export function completionFactsOf(state: CompletionState, owners: ReadonlySet<string> | "all", only?: string): CompletionFacts {
  const owned: OwnedCharacter[] = [];
  const dropped = new Map<string, number>();
  const ids = only === undefined ? Object.keys(state.owned) : (Object.hasOwn(state.owned, only) ? [only] : []);
  for (const installId of ids) {
    if (owners !== "all" && !owners.has(installId)) continue;
    const install = state.owned[installId];
    if (install.dropped > 0) dropped.set(installId, install.dropped);
    for (const [characterKey, c] of Object.entries(install.characters)) {
      owned.push({
        installId, characterKey, class: c.class, level: c.level,
        achievements: new Map(Object.entries(c.a).map(([id, a]) => [Number(id), { completed: a.c, earnedByMe: a.e, criteriaMet: a.m, criteriaTotal: a.t, quantity: a.q, required: a.r, earnedOn: a.d }])),
        factions: new Map(Object.entries(c.f).map(([id, f]) => [Number(id), { reaction: f.k, standing: f.s, floor: f.lo, ceiling: f.hi }])),
        titles: new Set(c.t), quests: new Set(c.q),
      });
    }
  }
  return { ...agreedCatalog(state), owned, dropped };
}

/** Facts straight from records, for tests and local tools: every owner is trusted, each install votes alone. */
export function completionFactsFromRecords(records: unknown[]): CompletionFacts {
  return completionFactsOf(foldCompletion(emptyCompletion(), [{ records, grants: [] }]), "all");
}
