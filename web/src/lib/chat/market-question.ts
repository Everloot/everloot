/**
 * Price questions, answered from the recorded market without a model. Website Chat, Desktop Chat and the
 * in-game /ask bridge all call answerMarketQuestion before anything else, so the same words get the same
 * answer everywhere. Pure and browser-safe: item lookup and the market_value call are passed in, because
 * each surface reaches them its own way (HTTP in the browser, MCP in the apps).
 *
 * Only a deliberate wording is a price question: price wording plus an item id, a shift-clicked link or an
 * item name, and optionally a realm. Anything else returns null and goes on to the usual search. The values
 * are the all-house community blend market_value gives, never a live listing, and a missing price is said to
 * be missing, never shown as zero.
 */

export const MARKET_ANSWER_BUDGET = 600;
/** The newest public day is called stale after this many days, as the game addon does. */
export const STALE_DAYS = 2;

/** What the question asks about: an item id (with the name the player gave it) or a name still to resolve. */
export interface MarketIntent { item: { id: number; label?: string } | { name: string }; realm: string | null }

/** What resolving an item name gives: its id, several candidates, or nothing. The site's item search (items.ts) returns this. */
export type NameMatch = { id: number } | { query: string } | null;

export interface MarketDeps {
  resolveItem(name: string, signal?: AbortSignal): Promise<NameMatch>;
  /** market_value for one realm and item, as its structured result; anything malformed is treated as unavailable. */
  lookup(realm: string, itemId: number, signal?: AbortSignal): Promise<unknown>;
  /** Realms to suggest when the question names none; never picked for the player. */
  realmChoices?: string[];
}

export type MarketKind = "connected" | "stale" | "thin" | "no-public" | "unavailable" | "clarify";
export interface MarketReply {
  kind: MarketKind;
  /** The short answer, at most MARKET_ANSWER_BUDGET characters. */
  text: string;
  /** The everloot.app page for this item and realm; null when the question was not specific enough to have one. */
  source: string | null;
  itemId: number | null;
  realm: string | null;
}

const ID = /^[1-9]\d{0,9}$/;
const MAX_SUBJECT = 80;
const ITEM_MARK = "\u0001";
const MARKET_WORDS = "(?:price|prices|pricing|market value|(?:ah|auction(?: house)?) value|cost)";
const WORTH_WORDS = "(?:worth|costs?|(?:sells?|goes?|going|selling) for|price|prices|market value|ah price|auction price)";

/** A realm name, as the protocol defines it: letters, digits, spaces, apostrophes and hyphens, 2 to 40 characters. */
export function validRealmName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  const realm = name.trim();
  return realm.length >= 2 && realm.length <= 40 && /^[\p{L}\p{N}][\p{L}\p{N} '’-]*$/u.test(realm);
}

/** Copper as gold, silver and copper, as the market tool writes it. */
export function formatCopper(value: number): string {
  const gold = Math.floor(value / 10000);
  const silver = Math.floor((value % 10000) / 100);
  const coins = value % 100;
  const parts: string[] = [];
  if (gold > 0) parts.push(`${gold}g`);
  if (silver > 0 || gold > 0) parts.push(`${silver}s`);
  parts.push(`${coins}c`);
  return parts.join(" ");
}

/** The public page for one item on one realm. */
export function marketPageUrl(realm: string, itemId: number): string {
  return `https://everloot.app/tools/auctions?${new URLSearchParams({ realm, item: String(itemId) })}`;
}

// Words that, trailing "in" or "on", are a place in the game rather than a realm.
const NOT_REALMS = new Set(["game", "the game", "wow", "ah", "the ah", "auction house", "the auction house", "general", "trade"]);
const PERSONAL = /\b(?:my|mine|me|myself|our|ours|we|i|i'm|i've)\b/i;
const VAGUE = new Set(["it", "this", "that", "them", "these", "those", "one"]);
const AUX = /^(?:is|are|does|do|did|can|could|will|would|should|it|this|that|whether|if|how|why|when|where|who|which)\b/i;
const LEAD = /^(?:(?:please|pls|hey|so|ok|okay|can you|could you|would you|tell me|show me|check|look up|lookup|find|do you know|what(?:'s| is| are| was)|whats)\s+)*/i;

/** The realm named at the end ("on Forever", "in Dawn's Reach"), and the question without it. */
function takeRealm(text: string): { rest: string; realm: string | null } {
  let at = -1;
  for (const m of text.matchAll(/\s(?:on|in|at)\s+/gi)) at = m.index!;
  if (at < 0) return { rest: text, realm: null };
  const tail = text.slice(at).replace(/^\s(?:on|in|at)\s+/i, "").replace(/^the\s+/i, "").replace(/^realm\s+/i, "").replace(/\s+(?:realm|server)$/i, "").trim();
  // "in the auction house" says where, not which realm: it is dropped and no realm is named.
  if (NOT_REALMS.has(tail.toLowerCase())) return { rest: text.slice(0, at), realm: null };
  if (!tail || tail.length > 40 || tail.split(/\s+/).length > 5 || !/^[\p{L}\p{N}][\p{L}\p{N} '’;:,.-]*$/u.test(tail)) return { rest: text, realm: null };
  return { rest: text.slice(0, at), realm: tail };
}

/** The item references in a question, each swapped for a mark; the first one's id and name. */
function takeItemRefs(text: string): { text: string; refs: { id: number; label?: string }[] } {
  const refs: { id: number; label?: string }[] = [];
  const mark = (id: string, label?: string) => { refs.push({ id: Number(id), ...(label ? { label: label.trim() } : {}) }); return ITEM_MARK; };
  const out = text
    .replace(/(?:\|c[0-9a-f]{8})?\|Hitem:(\d{1,10})[^|]*(?:\|h\[([^\]|]{0,80})\]\|h)?(?:\|r)?/gi, (_m, id: string, label?: string) => mark(id, label))
    .replace(/https?:\/\/(?:www\.)?everloot\.app\/database\/items\/(\d{1,10})\/?/gi, (_m, id: string) => mark(id))
    .replace(/\bitem:(\d{1,10})\b/gi, (_m, id: string) => mark(id))
    .replace(/\bitem\s+(?:id\s+)?#?(\d{1,10})\b/gi, (_m, id: string) => mark(id));
  return { text: out, refs };
}

function subjectOf(raw: string, refs: { id: number; label?: string }[]): MarketIntent["item"] | null {
  let s = raw.trim().replace(/^["“”\[]+|["“”\]]+$/g, "").trim().replace(/^(?:the|a|an|some|one)\s+/i, "").replace(/\s+item$/i, "").trim();
  if (s === ITEM_MARK) return refs.length === 1 ? refs[0] : null;
  if (!s || s.includes(ITEM_MARK) || s.length > MAX_SUBJECT || VAGUE.has(s.toLowerCase()) || AUX.test(s)) return null;
  if (ID.test(s)) return { id: Number(s) };
  return /^[\p{L}\p{N}][\p{L}\p{N} '’,.:()-]*$/u.test(s) ? { name: s } : null;
}

/**
 * The item and realm a price question names, or null when it is not one. Bounded wording only, with no
 * language model: "price 2589 on Forever", "what is the price of Linen Cloth on Forever", "how much does
 * Runecloth cost in Nightslayer", "Linen Cloth price", an item link, "item:2589". A question about the
 * player's own gold or goods is never one.
 */
export function parseMarketQuestion(question: string): MarketIntent | null {
  if (typeof question !== "string" || question.length > 2000) return null;
  const taken = takeItemRefs(question.replace(/\s+/g, " ").trim().replace(/[?.!\s]+$/, ""));
  if (taken.refs.length > 1 || PERSONAL.test(taken.text.replace(/\[[^\]]*\]/g, ""))) return null;
  const { rest, realm } = takeRealm(taken.text);
  const body = rest.trim().replace(LEAD, "");
  const subject =
    new RegExp(`^(?:the\\s+)?(?:(?:current|average|going|recorded|latest|ah|auction(?: house)?|market)\\s+)*${MARKET_WORDS}\\s+(?:check\\s+)?(?:(?:of|for|on)\\s+)?(.+)$`, "i").exec(body)?.[1]
    ?? new RegExp(`^how much\\s+(?:(?:is|are|does|do|would|will|did|should)\\s+)?(.+?)\\s+${WORTH_WORDS}$`, "i").exec(body)?.[1]
    ?? new RegExp(`^(?:the\\s+)?(.+?)\\s+${WORTH_WORDS}$`, "i").exec(body)?.[1];
  if (subject === undefined) return null;
  const item = subjectOf(subject, taken.refs);
  return item ? { item, realm } : null;
}

/** A market_value result read for one realm and item; null for anything else, including another realm's or item's answer. */
type Reading =
  | { kind: "value"; realm: string; value: { market: number | null; min: number; historical: number; quantity: number; day: string; ageDays: number; reporters: number; thin: boolean }; url: string | null }
  | { kind: "none"; realm: string; url: string | null };

const count = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

function read(raw: unknown, realm: string, itemId: number): Reading | null {
  const r = raw as { connected?: unknown; url?: unknown; page?: { realm?: unknown; itemId?: unknown; value?: unknown } } | null;
  if (!r || typeof r !== "object" || r.connected !== true || !r.page || typeof r.page !== "object") return null;
  const page = r.page;
  if (typeof page.realm !== "string" || page.realm.trim().toLowerCase() !== realm.trim().toLowerCase() || page.itemId !== itemId) return null;
  const url = typeof r.url === "string" && /^https:\/\/(?:www\.)?everloot\.app\//.test(r.url) && r.url.length <= 300 ? r.url : null;
  if (page.value === null) return { kind: "none", realm: page.realm.trim(), url };
  const v = page.value as Record<string, unknown> | undefined;
  if (!v || typeof v !== "object" || v.itemId !== itemId) return null;
  if (!(v.market === null || count(v.market)) || !count(v.min) || !count(v.historical) || !count(v.quantity) || !count(v.ageDays) || !count(v.reporters)
    || typeof v.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.day) || typeof v.thin !== "boolean") return null;
  return { kind: "value", realm: page.realm.trim(), url, value: { market: v.market, min: v.min, historical: v.historical, quantity: v.quantity, day: v.day, ageDays: v.ageDays, reporters: v.reporters, thin: v.thin } };
}

const EXAMPLE = "price 2589 on Forever";
const clarify = (text: string, itemId: number | null = null): MarketReply => ({ kind: "clarify", text, source: null, itemId, realm: null });

const who = (id: number, label?: string) => (label ? `${label} (item ${id})` : `Item ${id}`);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const ago = (days: number) => (days === 1 ? "1 day" : `${days} days`);

/** The short answer for a reading: the essentials first, optional notes only while they fit. */
function describe(name: string, realm: string, reading: Reading): { kind: MarketKind; text: string } {
  const head = `${name} on ${realm}, all houses`;
  if (reading.kind === "none") {
    return { kind: "no-public", text: `No public price for ${head} yet. A day becomes public after 3 reporters' full scans, so this is missing data, not a price of zero. Your own scan, if you made one, shows in game with /everloot price.` };
  }
  const v = reading.value;
  const stale = v.ageDays > STALE_DAYS;
  const closing = "A recorded community blend, not a live auction quote.";
  const staleNote = stale ? `Stale: the newest public day is ${ago(v.ageDays)} old.` : "";
  const fitted = (essential: string, ...notes: string[]) => {
    let text = essential;
    for (const note of notes.filter(Boolean)) if (`${text} ${note}`.length <= MARKET_ANSWER_BUDGET) text = `${text} ${note}`;
    return text.slice(0, MARKET_ANSWER_BUDGET);
  };
  const seen = `Newest public day ${v.day}, ${plural(v.reporters, "reporter")}`;
  const days = `${seen}, ${v.quantity} listed.`;
  const prices = `minimum ${formatCopper(v.min)}, historical ${formatCopper(v.historical)} each`;
  if (v.market !== null) {
    const thin = v.thin ? "The newest day is thin, so it is not counted in the market value." : "";
    return { kind: stale ? "stale" : "connected", text: fitted(`${head}: market ${formatCopper(v.market)}, ${prices}. ${days}`, staleNote, thin, closing) };
  }
  if (v.thin) {
    return { kind: "thin", text: fitted(`${head}: market value unrecorded because the newest public day is thin (${v.quantity} listed); ${prices}. ${seen}.`, staleNote, "Unrecorded is not zero, and this is not a live auction quote.") };
  }
  return { kind: "stale", text: fitted(`${head}: market value unrecorded, with no solid public day in the last 14 days. Last public day ${v.day} (${ago(v.ageDays)} ago): ${prices}, ${plural(v.reporters, "reporter")}.`, "Stale data, not a live auction quote.") };
}

const UNAVAILABLE = "Everloot's market data could not be read just now, so there is no price to show. That is unrecorded, not zero. Try again in a few minutes.";

/**
 * Answers a price question from the recorded market, or returns null when the question is not one. A
 * missing item or realm, or several matching items, is a question back, never a guess; a lookup that fails
 * or returns the wrong realm or item is unavailable. `options.realm` is the realm the caller knows from
 * context (the game's /ask carries the player's realm): it fills in a missing one and never overrides one
 * the question names. A stopped answer throws the abort.
 */
export async function answerMarketQuestion(question: string, deps: MarketDeps, options: { realm?: string | null; signal?: AbortSignal } = {}): Promise<MarketReply | null> {
  const intent = parseMarketQuestion(question);
  if (!intent) return null;
  const { signal } = options;
  signal?.throwIfAborted();
  const named = intent.realm !== null;
  const wanted = named ? intent.realm! : (options.realm ?? "");
  const realm = validRealmName(wanted) ? wanted.trim() : null;
  const choices = (deps.realmChoices ?? []).filter(validRealmName).slice(0, 8);
  if (!realm) {
    const known = "id" in intent.item ? intent.item.id : null;
    const subject = "id" in intent.item ? EXAMPLE : `price of ${intent.item.name} on Forever`;
    const lead = named ? `"${intent.realm}" is not a realm name.` : "Which realm?";
    return clarify(`${lead} Prices are per realm, so name one, for example: ${subject}.${choices.length ? ` Realms you follow: ${choices.join(", ")}.` : ""}`, known);
  }
  let id: number;
  let label: string | undefined;
  if ("id" in intent.item) {
    id = intent.item.id;
    label = intent.item.label;
  } else if (/^\d+$/.test(intent.item.name)) {
    return clarify(`That item id is not valid. Use the id from the item's page or shift-click the item link, for example: ${EXAMPLE}.`);
  } else {
    const match = await deps.resolveItem(intent.item.name, signal);
    signal?.throwIfAborted();
    if (!match) return clarify(`I couldn't match "${intent.item.name}" to an item. Use its item id or shift-click the item link, for example: ${EXAMPLE}.`);
    if (!("id" in match)) return clarify(`Several items match "${intent.item.name}". Use the item id or shift-click the item link to pick one, for example: ${EXAMPLE}.`);
    id = match.id;
    label = intent.item.name;
  }
  const page = marketPageUrl(realm, id);
  let raw: unknown;
  try {
    raw = await deps.lookup(realm, id, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    raw = null;
  }
  signal?.throwIfAborted();
  const reading = read(raw, realm, id);
  if (!reading) return { kind: "unavailable", text: UNAVAILABLE, source: page, itemId: id, realm };
  return { ...describe(who(id, label), reading.realm, reading), source: reading.url ?? page, itemId: id, realm: reading.realm };
}
