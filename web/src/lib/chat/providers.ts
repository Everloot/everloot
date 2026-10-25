import { CATALOGUE, type CatalogueKind, type CatalogueModel, type CatalogueProvider } from "./catalogue";

/**
 * The providers the /chat page offers, from the shared catalogue (./catalogue.ts). The player brings their own key;
 * it is kept in this tab (sessionStorage) and sent from the page straight to that provider, never to Everloot.
 * Only providers whose APIs answered a browser's CORS check from everloot.app are listed (`browser` in the
 * catalogue); a local Ollama does once it allows the site's origin. The rest stay in the Desktop App only.
 */
export type ChatProviderKind = CatalogueKind;

export type ChatModel = CatalogueModel;

export interface ChatProviderPreset {
  kind: ChatProviderKind;
  /** The provider's own name, on its card. */
  name: string;
  label: string;
  /** Anthropic's Messages API, or an OpenAI-compatible base URL. */
  api: "anthropic" | "openai";
  baseUrl: string;
  /** What a pasted key must look like; null when no key is needed. */
  keyPattern: RegExp | null;
  keyHint: string;
  /** Headers this provider asks for, sent to it alone. */
  headers: Record<string, string>;
  list: CatalogueProvider["list"];
  /** The catalogue's models: the shortlist, and what the picker shows when the provider's own list cannot be read. */
  models: ChatModel[];
  /** What the player should know before sending questions there. */
  dataNote: string;
  /** Where the provider issues keys (for Ollama, where to get it), for the provider's card on /account. */
  getKey: { href: string; text: string };
  /** The card's monogram tile: its letters and the provider's colour. */
  mark: string;
  colour: string;
}

const OLLAMA_NOTE = "Nothing leaves your computer. Start Ollama with OLLAMA_ORIGINS=https://everloot.app so this page may reach it, and pick a model that supports tool calling, such as qwen3.";

export const CHAT_PROVIDERS: ChatProviderPreset[] = CATALOGUE.filter((p) => p.browser).map((p) => ({
  kind: p.kind, name: p.name, label: p.label, api: p.api, baseUrl: p.baseUrl,
  keyPattern: p.key?.pattern ?? null, keyHint: p.key?.hint ?? "", headers: p.headers ?? {}, list: p.list,
  models: p.models, dataNote: p.kind === "ollama" ? OLLAMA_NOTE : p.dataNote, getKey: p.getKey, mark: p.mark, colour: p.colour,
}));

export function chatProvider(kind: string): ChatProviderPreset | null {
  return CHAT_PROVIDERS.find((p) => p.kind === kind) ?? null;
}

/** Model ids are provider/model names with the odd colon or dot; anything else is a paste of the wrong thing. */
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,120}$/;
