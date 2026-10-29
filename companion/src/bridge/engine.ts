import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { resolveItem } from "../../../web/src/lib/chat/items";
import { answerMarketQuestion, type MarketDeps } from "../../../web/src/lib/chat/market-question";

/** What the game knows about a question beyond its words: today, the realm the player was on. */
export interface AskContext { realm?: string }
export interface AnswerEngine { answer(question: string, context?: AskContext): Promise<{ answer: string; source: string }> }

export const MAX_ANSWER = 600;

/** One piece of answer_sources evidence, as far as the game needs it. */
export interface Piece { claim: string; kind: string; source: { url: string }; url?: string }

/** answer_sources for one question: the text a model reads, and the pieces as the tool structured them. */
export interface Sourced { text: string; evidence: Piece[] }

const NO_ANSWER = { answer: "No sourced answer found.", source: "none" };

/**
 * The first piece and its page. answer_sources orders them observed, curated, game files, then the 2023 wiki, and
 * the first three answer names the question carries, so the first piece is the most direct one. No piece means no
 * answer: nothing unsourced reaches the game.
 */
export function answerFromEvidence(sourced: Sourced): { answer: string; source: string } {
  const piece = sourced.evidence[0];
  if (!piece?.claim.trim()) return NO_ANSWER;
  return { answer: piece.claim.trim().slice(0, MAX_ANSWER), source: piece.url ?? piece.source.url };
}

const isPiece = (v: unknown): v is Piece => {
  const r = v as Partial<Piece> | null;
  return !!r && typeof r.claim === "string" && typeof r.kind === "string" && typeof r.source?.url === "string" && (r.url === undefined || typeof r.url === "string");
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
    return { text: content.find((c) => c.type === "text")?.text ?? "", evidence };
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
  return { answer: async (question) => answerFromEvidence(await mcpAnswerSources(options, question, 3)) };
}
