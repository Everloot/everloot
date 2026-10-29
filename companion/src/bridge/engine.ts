import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { resolveItem } from "../../../web/src/lib/chat/items";
import { answerMarketQuestion, type MarketDeps } from "../../../web/src/lib/chat/market-question";

/** The player's question just before this one, and what they were told, when this one reads as its follow-up. */
export interface Earlier { question: string; answer: string }

/** Who asked, as the game said when they asked: the class token ("MAGE"), the level and the zone. Used for that answer only. */
export interface Player { class?: string; level?: number; zone?: string }

/** What the game knows about a question beyond its words: the realm the player was on, who asked, and the question it follows. */
export interface AskContext { realm?: string; earlier?: Earlier; player?: Player }

const CLASS_NAMES: Readonly<Record<string, string>> = {
  WARRIOR: "Warrior", PALADIN: "Paladin", HUNTER: "Hunter", ROGUE: "Rogue", PRIEST: "Priest",
  SHAMAN: "Shaman", MAGE: "Mage", WARLOCK: "Warlock", DRUID: "Druid",
};

/** The class as the pages name it, from the game's token; an unknown token names nothing. */
export const className = (token?: string) => (token ? CLASS_NAMES[token] : undefined);

const HERE = /(?<![\p{L}\p{N}])(?:around here|this zone|here|esta zona|aquí|aqui|acá|aca)(?![\p{L}\p{N}])/iu;
const MY_CLASS = /(?<![\p{L}\p{N}])(?:my class|mi clase)(?![\p{L}\p{N}])/iu;

/** The question with "here" as the player's zone and "my class" as their class, so the lookup has a name to find. */
export function withPlayer(question: string, player?: Player): string {
  let q = question;
  if (player?.zone) q = q.replace(HERE, player.zone);
  const cls = className(player?.class);
  if (cls) q = q.replace(MY_CLASS, cls);
  return q;
}

/** One line for a model: who is asking, so "which talents should I take" can be answered for them. Empty when nothing is known. */
export function playerLine(player?: Player): string {
  const cls = className(player?.class);
  if (!cls && !player?.level && !player?.zone) return "";
  const who = [player?.level ? `level ${player.level}` : "", cls ?? "player"].filter(Boolean).join(" ");
  return `The player asking is a ${who}${player?.zone ? ` in ${player.zone}` : ""}.\n\n`;
}

const FOLLOW_ON = /^(?:and|also|what about|how about)\b/i;
const PRONOUN = /\b(?:he|she|it|they|him|her|them|his|its|their)\b/i;

/**
 * A question that may lean on the one before it: it opens with "and", "also", "what about" or "how about", or it says
 * "he" or "it" and capitalises no name. Players type names in lowercase too, so this only makes a candidate:
 * `sourcedFor` uses the earlier question only when this one's own evidence names nothing.
 */
export function readsAsFollowUp(question: string): boolean {
  const q = question.trim();
  if (FOLLOW_ON.test(q)) return true;
  const names = q.split(/\s+/).slice(1).some((w) => /^[A-Z]/.test(w) && w !== "I");
  return PRONOUN.test(q) && !names;
}

/** What the lookup reads: the question, and for a follow-up the earlier question, whose names it needs. */
export function lookupText(question: string, context?: AskContext): string {
  return context?.earlier ? `${question} (${context.earlier.question})` : question;
}

export interface AnswerEngine { answer(question: string, context?: AskContext): Promise<{ answer: string; source: string }> }

export const MAX_ANSWER = 600;

/** One piece of answer_sources evidence, as far as the game needs it: the claim, where it is from, and its licence. */
export interface Piece { claim: string; kind: string; source: { url: string; title?: string }; licence: string; asOf?: string | null; url?: string }

/**
 * answer_sources for one question: the text a model reads, the pieces as the tool structured them, and whether no page
 * held every asked word (the tool says so only in its text, so its pieces are the closest pages, not an answer).
 */
export interface Sourced { text: string; evidence: Piece[]; someWords?: boolean }

/** The first line answer_sources writes when no page held every asked word (kb/src/search.ts, SOME_WORDS). */
export const SOME_WORDS = "No page has every word you asked for. Pages with some of them:";

const NO_ANSWER = { answer: "No sourced answer found.", source: "none" };

/**
 * The in-game source line for a piece, with its licence, as search_knowledge's Source line had it. A wiki excerpt
 * names the wiki page it quotes (CC BY-SA asks for the source); a game-files fact keeps its label and build
 * ("found in game files, unconfirmed"); the rest name their everloot.app page.
 */
export function sourceLine(piece: Piece): string {
  const asOf = piece.asOf ? `, as of ${piece.asOf.slice(0, 10)}` : "";
  if (piece.kind === "lore") return `${piece.source.url} (${piece.licence}${asOf})`;
  const label = piece.kind === "files" && piece.source.title ? `${piece.source.title}; ` : "";
  return `${piece.url ?? piece.source.url} (${label}${piece.licence}${asOf})`;
}

/** The evidence names something the question carries: its first piece is observed, curated or a game-files fact, not only wiki pages. */
export function namesSomething(sourced: Sourced): boolean {
  const first = sourced.evidence[0];
  return !!first && first.kind !== "lore" && !sourced.someWords;
}

/**
 * The evidence for a question: its own first. A candidate follow-up whose own evidence names nothing is looked up again
 * with the question it follows (`leaned`), so "what does he drop" after "where is Edwin VanCleef" finds VanCleef,
 * while "is there a mailbox in orgrimmar" finds Orgrimmar itself and keeps to it.
 */
export async function sourcedFor(
  question: string, context: AskContext | undefined, sources: (question: string) => Promise<Sourced>,
): Promise<{ sourced: Sourced; leaned: boolean }> {
  const asked = withPlayer(question, context?.player);
  const alone = await sources(asked);
  if (!context?.earlier || namesSomething(alone)) return { sourced: alone, leaned: false };
  return { sourced: await sources(lookupText(asked, context)), leaned: true };
}

/** Every piece's source line, once each: what a model's answer, written from all of them, has to credit. */
export function sourceLines(sourced: Sourced): string {
  return [...new Set(sourced.evidence.map(sourceLine))].join(" | ");
}

/**
 * The first piece and its source line. answer_sources orders them observed, curated, game files, then the 2023 wiki,
 * and the first three answer names the question carries, so the first piece is the most direct one. When no page held
 * every word, the answer says it is only the closest page. No piece means no answer: nothing unsourced reaches the game.
 */
export function answerFromEvidence(sourced: Sourced): { answer: string; source: string } {
  const piece = sourced.evidence[0];
  if (!piece?.claim.trim()) return NO_ANSWER;
  const lead = sourced.someWords ? "No page matched every word; the closest: " : "";
  return { answer: `${lead}${piece.claim.trim()}`.slice(0, MAX_ANSWER), source: sourceLine(piece) };
}

const optional = (v: unknown) => v === undefined || typeof v === "string";
const isPiece = (v: unknown): v is Piece => {
  const r = v as Partial<Piece> | null;
  return !!r && typeof r.claim === "string" && typeof r.kind === "string" && typeof r.licence === "string" && typeof r.source?.url === "string"
    && optional(r.source.title) && optional(r.url) && (r.asOf === null || optional(r.asOf));
};

type McpOptions = { url: string; token: string | null };
type McpSession = <T>(options: McpOptions, run: (client: Client) => Promise<T>, signal?: AbortSignal) => Promise<T>;

/**
 * One connection to the server for one piece of work. A stop reaches the whole of it: the handshake as well as
 * the tool call, and whatever was opened is closed however it ends (a handshake the server never answers
 * included), so an aborted or timed-out question leaves no half-open connection behind.
 */
const withClient: McpSession = async (options, run, signal) => {
  signal?.throwIfAborted();
  const client = new Client({ name: "everloot-companion", version: "0.1.0" });
  const requestInit: RequestInit = {
    ...(options.token ? { headers: { Authorization: `Bearer ${options.token}` } } : {}),
    ...(signal ? { signal } : {}),
  };
  const transport = new StreamableHTTPClientTransport(new URL(options.url), { requestInit });
  try {
    // The SDK ends a pending initialize only through the request's own signal (it sets its own on each fetch).
    await client.connect(transport, { signal });
    return await run(client);
  } finally {
    await client.close().catch(() => {});
  }
};

/**
 * The knowledge server's answer_sources for one question: the evidence the site's chat uses, with the game files'
 * facts for the names it carries. A tool error, or pieces in a shape this does not know, give no evidence.
 */
export async function mcpAnswerSources(options: McpOptions, question: string, limit: number): Promise<Sourced> {
  return withClient(options, async (client) => {
    const result = await client.callTool({ name: "answer_sources", arguments: { question, limit } });
    const content = (result.content as { type: string; text?: string }[] | undefined) ?? [];
    const pieces = (result.structuredContent as { evidence?: unknown } | undefined)?.evidence;
    const evidence = result.isError !== true && Array.isArray(pieces) && pieces.every(isPiece) ? pieces : [];
    const text = content.find((c) => c.type === "text")?.text ?? "";
    return { text, evidence, ...(text.startsWith(SOME_WORDS) ? { someWords: true } : {}) };
  });
}

/** A market_value result's structured answer; a tool error or a text-only result is not one. */
export function marketValueFrom(result: Record<string, unknown>): unknown {
  return result.isError === true ? null : (result.structuredContent ?? null);
}

/** market_value for one realm and item over MCP, as the tool's structured answer (null when it gave none). */
export async function mcpMarketValue(options: McpOptions, realm: string, itemId: number, signal?: AbortSignal, session: McpSession = withClient): Promise<unknown> {
  return session(options, async (client) => marketValueFrom(await client.callTool({ name: "market_value", arguments: { realm, itemId } }, undefined, { signal })), signal);
}

/** Item names resolve through the site's own item search, as the website's chat does. */
export function siteItemSearch(endpoint: string, fetcher: typeof fetch = fetch): MarketDeps["resolveItem"] {
  const send = ((input: string, init?: RequestInit) => fetcher(`${endpoint.replace(/\/$/, "")}${input}`, init)) as typeof fetch;
  return (name, signal) => resolveItem(name, signal, send);
}

/**
 * A price question is answered from the recorded market, with no model and no search; every other question goes
 * on to `next` unchanged. The realm the ask carried fills in a missing one; a question that names a realm wins.
 */
export function withMarket(next: AnswerEngine, market: MarketDeps): AnswerEngine {
  return {
    async answer(question, context) {
      const reply = await answerMarketQuestion(question, market, { realm: context?.realm });
      return reply ? { answer: reply.text.slice(0, MAX_ANSWER), source: reply.source ?? "none" } : next.answer(question, context);
    },
  };
}

/**
 * An engine built when a question first reaches it. Building can fail (a provider setting is wrong); that then fails
 * only the questions that get this far, not the price questions `withMarket` answers before it.
 */
export function lazyEngine(build: () => AnswerEngine): AnswerEngine {
  return { answer: async (question, context) => build().answer(question, context) };
}

/** Answers with no model: the first piece of evidence and its page. With providers configured, the CLI uses llmEngine instead. */
export function mcpEngine(options: McpOptions): AnswerEngine {
  return { answer: async (question, context) => answerFromEvidence((await sourcedFor(question, context, (q) => mcpAnswerSources(options, q, 3))).sourced) };
}
