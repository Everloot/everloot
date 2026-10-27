import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { resolveItem } from "../../../web/src/lib/chat/items";
import { answerMarketQuestion, type MarketDeps } from "../../../web/src/lib/chat/market-question";

/** What the game knows about a question beyond its words: today, the realm the player was on. */
export interface AskContext { realm?: string }
export interface AnswerEngine { answer(question: string, context?: AskContext): Promise<{ answer: string; source: string }> }

export const MAX_ANSWER = 600;

/** The first hit's text and its Source line. No source means no answer: nothing unsourced reaches the game. */
export function answerFromSearch(text: string): { answer: string; source: string } {
  const lines = text.split("\n");
  const sourceAt = lines.findIndex((l) => l.startsWith("Source: "));
  if (sourceAt < 0) return { answer: "No sourced answer found.", source: "none" };
  const body = lines.slice(0, sourceAt).filter((l) => l.trim() && !/^\[[^\]]+\]/.test(l)).join(" ").trim();
  return { answer: (body || "No sourced answer found.").slice(0, MAX_ANSWER), source: lines[sourceAt].slice("Source: ".length).trim() };
}

type McpOptions = { url: string; token: string | null };
type McpSession = <T>(options: McpOptions, run: (client: Client) => Promise<T>) => Promise<T>;

/** One connection to the server for one piece of work. */
const withClient: McpSession = async (options, run) => {
  const client = new Client({ name: "everloot-companion", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(options.url), options.token
    ? { requestInit: { headers: { Authorization: `Bearer ${options.token}` } } }
    : {});
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
};

/** The knowledge server's search_knowledge text for one question: hits with their Source lines. */
export async function mcpSearch(options: McpOptions, question: string, limit: number): Promise<string> {
  return withClient(options, async (client) => {
    const result = await client.callTool({ name: "search_knowledge", arguments: { query: question, limit } });
    const content = (result.content as { type: string; text?: string }[] | undefined) ?? [];
    return content.find((c) => c.type === "text")?.text ?? "";
  });
}

/** A market_value result's structured answer; a tool error or a text-only result is not one. */
export function marketValueFrom(result: Record<string, unknown>): unknown {
  return result.isError === true ? null : (result.structuredContent ?? null);
}

/** market_value for one realm and item over MCP, as the tool's structured answer (null when it gave none). */
export async function mcpMarketValue(options: McpOptions, realm: string, itemId: number, signal?: AbortSignal, session: McpSession = withClient): Promise<unknown> {
  return session(options, async (client) => marketValueFrom(await client.callTool({ name: "market_value", arguments: { realm, itemId } }, undefined, { signal })));
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

/** Plain search answers: the top hit and its source. With providers configured, the CLI uses llmEngine instead. */
export function mcpEngine(options: McpOptions): AnswerEngine {
  return { answer: async (question) => answerFromSearch(await mcpSearch(options, question, 1)) };
}
