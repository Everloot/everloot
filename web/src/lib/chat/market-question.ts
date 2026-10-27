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
/**
 * The most one price question may take, item search and market lookup together. Past it the answer is the usual
 * "unavailable", never a model's guess. 30 s is the lead's choice: a public lookup that has not come back by
 * then is not coming back soon, and a bridge that answers asks one after another must not wait on it forever.
 */
export const MARKET_QUERY_BUDGET_MS = 30_000;
/** A public day needs this many reporters (the server's AUCTION_AGREEMENT); a row claiming fewer is not a public price. */
const MIN_REPORTERS = 3;

/**
 * What the question asks about: an item id (with the name the player gave it), a name still to resolve, or a
 * reference that is not a usable item id (zero, too large, not a number): asked back, never shortened or guessed.
 */
export interface MarketIntent { item: { id: number; label?: string } | { name: string } | { invalid: string }; realm: string | null }

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
const LEAD = /^(?:(?:please|pls|hey|so|ok|okay|can you|could you|would you|tell me|show me|check|look up|lookup|find|do you know|what(?:'s| is| are| was)|whats),?\s+)*/i;

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

/** An item reference as written (its id text whole, not yet checked) and the name a shift-click link carried. */
interface ItemRef { raw: string; label?: string }

/** A written id as an item: a positive integer of at most ten digits (always a safe integer), or the text back as invalid. */
function itemOf(raw: string, label?: string): MarketIntent["item"] {
  return ID.test(raw) ? { id: Number(raw), ...(label ? { label } : {}) } : { invalid: raw };
}

/** The item references in a question, each swapped for a mark. The whole id is taken, so a long one is judged, never cut. */
function takeItemRefs(text: string): { text: string; refs: ItemRef[] } {
  const refs: ItemRef[] = [];
  const mark = (raw: string, label?: string) => { refs.push({ raw, ...(label?.trim() ? { label: label.trim() } : {}) }); return ITEM_MARK; };
  const out = text
    .replace(/(?:\|c[0-9a-f]{8})?\|Hitem:([^:|]*)(?::[^|]*)?(?:\|h\[([^\]|]{0,80})\]\|h)?(?:\|r)?/gi, (_m, id: string, label?: string) => mark(id, label))
    .replace(/https?:\/\/(?:www\.)?everloot\.app\/database\/items\/(\d+)\/?/gi, (_m, id: string) => mark(id))
    .replace(/\bitem:(\w+)/gi, (_m, id: string) => mark(id))
    .replace(/\bitem\s+(?:id\s+)?#?(\d+)\b/gi, (_m, id: string) => mark(id));
  return { text: out, refs };
}

function subjectOf(raw: string, refs: ItemRef[]): MarketIntent["item"] | null {
  // The name keeps a leading article: the item resolver tries the whole name first (a real item can be "The ...")
  // and drops a conversational article itself only when no item has that name. `bare` only judges what was asked.
  const s = raw.trim().replace(/^["“”\[]+|["“”\]]+$/g, "").trim().replace(/\s+item$/i, "").trim();
  const bare = s.replace(/^(?:the|a|an|some|one)\s+/i, "");
  if (bare === ITEM_MARK) return refs.length === 1 ? itemOf(refs[0].raw, refs[0].label) : null;
  if (!bare || bare.includes(ITEM_MARK) || s.length > MAX_SUBJECT || VAGUE.has(bare.toLowerCase()) || AUX.test(bare)) return null;
  if (/^\d+$/.test(bare)) return itemOf(bare);
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
  // The polite lead goes first: the "me" in "tell me the price of X" is not the player's own goods.
  const spoken = taken.text.replace(LEAD, "");
  if (taken.refs.length > 1 || PERSONAL.test(spoken.replace(/\[[^\]]*\]/g, ""))) return null;
  const { rest, realm } = takeRealm(spoken);
  const body = rest.trim();
  const subject =
    new RegExp(`^(?:the\\s+)?(?:(?:current|average|going|recorded|latest|ah|auction(?: house)?|market)\\s+)*${MARKET_WORDS}\\s+(?:check\\s+)?(?:(?:of|for|on)\\s+)?(.+)$`, "i").exec(body)?.[1]
    ?? new RegExp(`^how much\\s+(?:(?:is|are|does|do|would|will|did|should)\\s+)?(.+?)\\s+${WORTH_WORDS}$`, "i").exec(body)?.[1]
    ?? new RegExp(`^(.+?)\\s+${WORTH_WORDS}$`, "i").exec(body)?.[1];
  if (subject === undefined) return null;
  const item = subjectOf(subject, taken.refs);
  return item ? { item, realm } : null;
}

/** A market_value result read for one realm and item; null for anything else, including another realm's or item's answer. */
type Reading =
  | { kind: "value"; realm: string; value: { market: number | null; min: number; historical: number; quantity: number; day: string; ageDays: number; reporters: number; thin: boolean }; url: string | null }
  | { kind: "none"; realm: string; url: string | null };

const count = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** A day that is on the calendar (2026-02-30 and 2026-99-99 are not). Not compared with today: the server tolerates a clock a day ahead. */
function calendarDay(text: unknown): text is string {
  const m = typeof text === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) : null;
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const length = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return month >= 1 && month <= 12 && day >= 1 && day <= length;
}

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
    || !calendarDay(v.day) || typeof v.thin !== "boolean") return null;
  // A public day has at least three reporters; a row that says fewer contradicts itself and is not shown as a public price.
  if (v.reporters < MIN_REPORTERS) return null;
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
  // No recent market value. The result does not say why (old days, thin days or an outlier can each cause it), so
  // that is not claimed: the value is unrecorded, and the newest day's own state is described beside it.
  const thin = v.thin ? `The newest public day is thin (${v.quantity} listed), so it is not counted in a market value.` : "";
  const note = "Unrecorded is not zero, and this is not a live auction quote.";
  return { kind: v.thin && !stale ? "thin" : "stale", text: fitted(`${head}: recent market value unrecorded; ${prices}. ${seen}, ${v.quantity} listed.`, thin, staleNote, note) };
}

const UNAVAILABLE = "Everloot's market data could not be read just now, so there is no price to show. That is unrecorded, not zero. Try again in a few minutes.";

/**
 * Answers a price question from the recorded market, or returns null when the question is not one. A
 * missing item or realm, or several matching items, is a question back, never a guess; a lookup that fails
 * or returns the wrong realm or item is unavailable. `options.realm` is the realm the caller knows from
 * context (the game's /ask carries the player's realm): it fills in a missing one and never overrides one
 * the question names. A stopped answer throws the abort. The item search and the lookup share one budget,
 * MARKET_QUERY_BUDGET_MS: spent, the answer is "unavailable" (the deps are also told through their signal,
 * and the budget holds even for a dep that ignores it).
 */
export async function answerMarketQuestion(question: string, deps: MarketDeps, options: { realm?: string | null; signal?: AbortSignal } = {}): Promise<MarketReply | null> {
  const intent = parseMarketQuestion(question);
  if (!intent) return null;
  const { signal } = options;
  signal?.throwIfAborted();
  if ("invalid" in intent.item) return clarify(`That item id is not valid. Use the id from the item's page or shift-click the item link, for example: ${EXAMPLE}.`);
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
  const item = intent.item;
  let id: number | null = "id" in item ? item.id : null;
  const budget = new AbortController();
  let spent = false;
  const timer = setTimeout(() => { spent = true; budget.abort(new DOMException("The price query ran out of time.", "TimeoutError")); }, MARKET_QUERY_BUDGET_MS);
  const stop = () => budget.abort(signal!.reason);
  signal?.addEventListener("abort", stop, { once: true });
  // Rejects when the budget aborts, so a dep that ignores its signal still cannot hold the answer past it.
  const ended = new Promise<never>((_resolve, reject) => budget.signal.addEventListener("abort", () => reject(budget.signal.reason), { once: true }));
  const work = async (inner: AbortSignal): Promise<MarketReply> => {
    let label: string | undefined = "label" in item ? item.label : undefined;
    if ("name" in item) {
      const match = await deps.resolveItem(item.name, inner);
      inner.throwIfAborted();
      if (!match) return clarify(`I couldn't match "${item.name}" to an item. Use its item id or shift-click the item link, for example: ${EXAMPLE}.`);
      if (!("id" in match)) return clarify(`Several items match "${item.name}". Use the item id or shift-click the item link to pick one, for example: ${EXAMPLE}.`);
      id = match.id;
      label = item.name;
    }
    const found = id!;
    const page = marketPageUrl(realm, found);
    let raw: unknown;
    try {
      raw = await deps.lookup(realm, found, inner);
    } catch (err) {
      if (inner.aborted) throw err;
      raw = null;
    }
    inner.throwIfAborted();
    const reading = read(raw, realm, found);
    if (!reading) return { kind: "unavailable", text: UNAVAILABLE, source: page, itemId: found, realm };
    return { ...describe(who(found, label), reading.realm, reading), source: reading.url ?? page, itemId: found, realm: reading.realm };
  };
  const running = work(budget.signal);
  running.catch(() => {});
  try {
    return await Promise.race([running, ended]);
  } catch (err) {
    if (!spent || signal?.aborted) throw err;
    return { kind: "unavailable", text: UNAVAILABLE, source: id === null ? null : marketPageUrl(realm, id), itemId: id, realm };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}
