import { existsSync, readFileSync } from "node:fs";
import { createAnthropicProvider } from "./anthropic";
import type { Provider } from "./chain";
import { createOpenAICompatibleProvider } from "./openai-compatible";

/**
 * Providers the user enabled, in their order, from config.json in the companion's data folder.
 * Keys live in their own files (apiKeyFile); a key written into the config is refused.
 * No config file means no providers: answers stay plain search.
 */
/**
 * loadProviders, run when first asked for and kept once it works. A failure is not kept (a repaired config is read
 * the next time) and is the caller's to report: it is only a question that needs a provider that has to fail on it.
 */
export function providersOnDemand(configPath: string): () => Provider[] {
  let loaded: Provider[] | undefined;
  return () => (loaded ??= loadProviders(configPath));
}

export function loadProviders(configPath: string): Provider[] {
  if (!existsSync(configPath)) return [];
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { providers?: unknown };
  if (!Array.isArray(config.providers)) return [];
  return config.providers.map((raw, i) => {
    const p = raw as Record<string, unknown>;
    if ("apiKey" in p) throw new Error(`providers[${i}]: put the key in a file and name it with apiKeyFile.`);
    const key = typeof p.apiKeyFile === "string" ? readFileSync(p.apiKeyFile, "utf8").trim() : undefined;
    const model = typeof p.model === "string" ? p.model : undefined;
    if (p.type === "anthropic") {
      if (!key) throw new Error(`providers[${i}]: anthropic needs apiKeyFile.`);
      return createAnthropicProvider({ apiKey: key, ...(model ? { model } : {}) });
    }
    if (p.type === "openai-compatible") {
      if (typeof p.baseUrl !== "string" || !model) throw new Error(`providers[${i}]: openai-compatible needs baseUrl and model.`);
      return createOpenAICompatibleProvider({ baseUrl: p.baseUrl, model, ...(key ? { apiKey: key } : {}) });
    }
    throw new Error(`providers[${i}]: unknown type ${String(p.type)}.`);
  });
}
