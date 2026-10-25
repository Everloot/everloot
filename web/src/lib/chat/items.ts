/**
 * The item a chat question is about, found the way the site's search boxes find it (/search/suggest?in=item).
 * Those names are the pages' own, so they stay in this page: a conversation keeps only the item's id (or the
 * player's own words when they still have to pick one), and neither the model nor its tools ever see them.
 */

/** What an answer keeps of its item: the id it resolved to, or the player's words when several items match. */
export type ItemRef = { id: number } | { query: string };
export interface ItemChoice { id: number; label: string; quality: number | null }

/** A keyless answer about one item: the card below it says the rest. */
export const ITEM_FOUND = "Here is the item in Everloot's database.";

const MAX_QUERY = 200;
const ID = /^[1-9]\d{0,9}$/;

// "Where does X drop?", "where do I get X", "where can I farm X", "what drops X", "who drops the X".
const ASKS = [
  /^where\s+(?:does|do|did|can|could|would|should|to)\s+(?:i\s+|you\s+|we\s+)?(?:(?:get|find|farm|loot|buy)\s+)?(.+?)(?:\s+(?:drop|drops|come\s+from))?$/i,
  /^(?:what|who|which\s+\w+)\s+(?:drops|drop)\s+(.+)$/i,
  /^(?:show me|what is|tell me about)\s+(.+)$/i,
  /^(.+?)\s+drop\s*rates?$/i,
];
const VAGUE = new Set(["it", "this", "that", "them", "these", "those", "one"]);

/** The item name an item question asks about, or null when the question is not one ("Where is Leeroy?"). */
export function itemQuery(question: string): string | null {
  let q = question.trim().replace(/[?.!]+$/, "").replace(/\s+/g, " ");
  if (/^where\s/i.test(q)) q = q.replace(/\s+in\s+(?:WoW:\s*)?Forever$/i, "").replace(/\s+from$/i, "");
  for (const re of ASKS) {
    const m = re.exec(q);
    if (!m) continue;
    // "where does X" alone is a place question, not an item one: it needs a get/find/farm/loot or a drop at the end.
    if (re === ASKS[0] && !/\b(?:get|find|farm|loot|buy|drops?|come from)\b/i.test(q)) return null;
    const name = m[1].replace(/\s+drop\s*rates?$/i, "").trim();
    return name && name.length <= MAX_QUERY && !VAGUE.has(name.toLowerCase()) ? name : null;
  }
  return null;
}

/** The item rows the site's type-ahead has for `query`, kept only when each is an item page on this site. */
export async function suggestItems(query: string, signal?: AbortSignal, send: typeof fetch = fetch): Promise<ItemChoice[]> {
  let body: { results?: unknown };
  try {
    const res = await send(`/search/suggest?${new URLSearchParams({ q: query, in: "item" })}`, { signal });
    if (!res.ok) return [];
    body = (await res.json()) as { results?: unknown };
  } catch (err) {
    if (signal?.aborted) throw err;
    return [];
  }
  const rows = Array.isArray(body.results) ? (body.results as Record<string, unknown>[]) : [];
  return rows.flatMap((r) => (r && r.type === "item" && typeof r.id === "number" && ID.test(String(r.id)) && r.href === `/database/items/${r.id}` && typeof r.label === "string"
    ? [{ id: r.id, label: r.label, quality: typeof r.quality === "number" ? r.quality : null }] : []));
}

/** The one item named exactly `query`; several or only similar names are choices; nothing found or a failure is null. */
export async function resolveItem(query: string, signal?: AbortSignal, send: typeof fetch = fetch): Promise<ItemRef | null> {
  let name = query.trim();
  let rows = await suggestItems(name, signal, send);
  // Keep real names beginning with an article. Retry conversational articles only when no exact item exists.
  if (!rows.some((r) => r.label.trim().toLowerCase() === name.toLowerCase()) && /^(?:the|a|an|some)\s+/i.test(name)) {
    name = name.replace(/^(?:the|a|an|some)\s+/i, "");
    rows = await suggestItems(name, signal, send);
  }
  if (rows.length === 0) return null;
  const exact = rows.filter((r) => r.label.trim().toLowerCase() === name.toLowerCase());
  if (exact.length === 1) return { id: exact[0].id };
  // Prefix words allow a partial item name without treating Hogger's Trousers as the NPC Hogger.
  return exact.length > 1 || rows.some((r) => r.label.toLowerCase().startsWith(`${name.toLowerCase()} `)) ? { query: name } : null;
}

/** A saved reference read back: only an id or the player's words survive; anything else is dropped. */
export function itemRef(raw: unknown): ItemRef | undefined {
  const r = raw as { id?: unknown; query?: unknown } | null;
  if (!r || typeof r !== "object") return undefined;
  if (typeof r.id === "number" && ID.test(String(r.id))) return { id: r.id };
  if (typeof r.query === "string" && r.query.trim() && r.query.length <= MAX_QUERY) return { query: r.query };
  return undefined;
}
