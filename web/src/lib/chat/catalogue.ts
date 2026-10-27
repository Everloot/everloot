/**
 * The model catalogue behind Chat, read by the website's /chat (lib/chat/providers.ts) and by the Desktop App's
 * Chat page (desktop/src/shared/providers.ts). The logic is per provider, never per model: every provider is a row
 * on one of two calling paths (Anthropic's Messages API, or an OpenAI-compatible chat completions endpoint) and
 * every model is a line of data. These lines are the shortlist and the offline fallback; the pickers read the
 * provider's own model list at runtime (listModels), so what they show is what the provider serves today and what
 * it costs today. Prices were read on 2026-10-21 and are per million tokens in / out; [?] marks what could not be
 * checked against the provider's own pages. No logo files: each provider is a monogram tile on its own colour.
 */
export type CatalogueKind =
  | "openrouter" | "anthropic" | "ollama"
  | "deepseek" | "moonshot" | "qwen" | "minimax" | "siliconflow" | "baidu" | "xiaomi" | "groq" | "google" | "mistral"
  | "zai" | "tencent" | "byteplus" | "stepfun" | "internlm" | "opencode" | "cerebras";

export interface CatalogueModel { id: string; label: string; note: string }

export interface CatalogueProvider {
  kind: CatalogueKind;
  /** The provider's own name, on its card and chips. */
  name: string;
  /** The picker's label: the name and what it is for. */
  label: string;
  /** The tile: one or two letters on the provider's colour (picked by eye, not from a brand sheet). */
  mark: string;
  colour: string;
  api: "anthropic" | "openai";
  baseUrl: string;
  /** What a pasted key must look like and where it comes from; null when no key is needed (a local Ollama). */
  key: { pattern: RegExp; hint: string } | null;
  /** Headers this provider asks for, sent to it alone (others refuse them in the browser's CORS check). */
  headers?: Record<string, string>;
  /** How its live model list is read. */
  list: "openrouter" | "anthropic" | "ollama" | "openai";
  /**
   * Whether its chat and model endpoints answered a browser's CORS check from https://everloot.app, so the website
   * may offer it. The test and its results: docs/2026-10-21-lane-model-catalogue-closeout.md.
   */
  browser: boolean;
  models: CatalogueModel[];
  /** What the player should know before sending questions there. */
  dataNote: string;
  getKey: { href: string; text: string };
}

/** A key with no known prefix: printable, no spaces, long enough to be a key. */
const ANY_KEY = /^[\x21-\x7e]{12,500}$/;
const SK_KEY = /^sk-[A-Za-z0-9_-]{16,}$/;
const FREE = "free, 50 requests a day until you buy $10 of credits";

export const CATALOGUE: CatalogueProvider[] = [
  {
    kind: "openrouter", name: "OpenRouter", label: "OpenRouter (one key, many models)", mark: "OR", colour: "#6467F2",
    api: "openai", baseUrl: "https://openrouter.ai/api/v1", list: "openrouter", browser: true,
    key: { pattern: /^sk-or-[A-Za-z0-9_-]{20,}$/, hint: "A key from openrouter.ai/keys (sk-or-…). The free models need no credits." },
    // OpenRouter's attribution header; Moonshot, MiniMax, Google and Mistral refuse it in the CORS check.
    headers: { "x-title": "Everloot" },
    models: [
      { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", note: "$0.024 / $0.38" },
      { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2", note: "$0.21 / $0.31" },
      { id: "qwen/qwen3.7-flash", label: "Qwen 3.7 Flash", note: "$0.03 / $0.13" },
      { id: "qwen/qwen3-235b-a22b-2507", label: "Qwen3 235B", note: "$0.09 / $0.55" },
      { id: "qwen/qwen3-coder-30b-a3b-instruct", label: "Qwen3 Coder 30B", note: "$0.07 / $0.28" },
      { id: "z-ai/glm-5.3-flash", label: "GLM 5.3 Flash", note: "$0.15 / $0.50" },
      { id: "z-ai/glm-4.7-flash", label: "GLM 4.7 Flash", note: "$0.06 / $0.40" },
      { id: "minimax/minimax-m3.1-flash:free", label: "MiniMax M3.1 Flash (free)", note: FREE },
      { id: "minimax/minimax-m2.5", label: "MiniMax M2.5", note: "$0.27 / $0.95" },
      { id: "moonshotai/kimi-k2.5", label: "Kimi K2.5", note: "$0.50 / $2.50, Kimi's cheapest" },
      { id: "bytedance-seed/seed-2.0-mini", label: "Seed 2.0 Mini (Doubao)", note: "$0.10 / $0.40" },
      { id: "tencent/hy3", label: "Hunyuan Hy3", note: "$0.083 / $0.33" },
      { id: "stepfun/step-3.5-flash", label: "Step 3.5 Flash", note: "$0.10 / $0.30" },
      { id: "xiaomi/mimo-v2.6-flash", label: "MiMo V2.6 Flash", note: "$0.14 / $0.28" },
      { id: "inclusionai/ling-3.1-flash", label: "Ling 3.1 Flash", note: "$0.075 / $0.23" },
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", note: "$0.15 / $0.60" },
      { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", note: "$0.03 / $0.13" },
      { id: "google/gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", note: "$0.15 / $1.25" },
      { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5", note: "$0.10 / $0.50" },
      { id: "mistralai/mistral-small-3.2-24b-instruct", label: "Mistral Small 3.2", note: "$0.094 / $0.25" },
      { id: "nvidia/nemotron-3.5-lightning:free", label: "Nemotron 3.5 Lightning (free)", note: FREE },
      { id: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nemotron 3 Super (free)", note: FREE },
      { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B (free)", note: FREE },
      { id: "google/gemma-4-26b-a4b-it:free", label: "Gemma 4 26B (free)", note: FREE },
      { id: "poolside/laguna-s-2.1:free", label: "Laguna S 2.1 (free)", note: FREE },
      { id: "openrouter/free", label: "Any free model (OpenRouter picks)", note: FREE },
      { id: "typesafe/jev-router", label: "TypeSafe Jev Router", note: "price set per request [?]" },
    ],
    dataNote: "OpenRouter skips providers that log prompts unless you allow it in your OpenRouter settings. Free models may be served by providers that do.",
    getKey: { href: "https://openrouter.ai/keys", text: "Get a key at openrouter.ai" },
  },
  {
    kind: "anthropic", name: "Anthropic", label: "Anthropic (Claude)", mark: "A", colour: "#D97757",
    api: "anthropic", baseUrl: "https://api.anthropic.com/v1", list: "anthropic", browser: true,
    key: { pattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/, hint: "An API key from console.anthropic.com (sk-ant-…). A Claude.ai subscription cannot be used here." },
    models: [
      { id: "claude-sonnet-5-5", label: "Sonnet 5.5", note: "$3 / $15" },
      { id: "claude-haiku-5-5", label: "Haiku 5.5", note: "$1 / $5, fast" },
      { id: "claude-opus-5-5", label: "Opus 5.5", note: "$15 / $75, best" },
    ],
    dataNote: "API traffic is not used to train Anthropic's models.",
    getKey: { href: "https://console.anthropic.com/settings/keys", text: "Get a key at console.anthropic.com" },
  },
  {
    kind: "ollama", name: "Ollama", label: "Ollama on this computer", mark: "Ol", colour: "#F2F2F2",
    api: "openai", baseUrl: "http://localhost:11434/v1", list: "ollama", browser: true,
    key: null,
    // One small model that calls tools, so a player's first local model is light on their machine.
    models: [{ id: "qwen3:4b", label: "Qwen3 4B", note: "2.5 GB download, light enough for most computers" }],
    dataNote: "Runs on your computer: private and free, but slower than a cloud model, and it uses your computer's memory while it answers. Start with qwen3:4b (ollama pull qwen3:4b). If answers are slow, switch back to a free cloud model.",
    getKey: { href: "https://ollama.com/download", text: "Get Ollama at ollama.com" },
  },
  {
    kind: "deepseek", name: "DeepSeek", label: "DeepSeek (direct)", mark: "DS", colour: "#4D6BFE",
    api: "openai", baseUrl: "https://api.deepseek.com", list: "openai", browser: true,
    key: { pattern: SK_KEY, hint: "A key from platform.deepseek.com (sk-…)." },
    models: [
      { id: "deepseek-flash", label: "DeepSeek V4.1 Flash", note: "$0.15 / $0.60 off-peak, $0.30 / $1.20 at peak" },
    ],
    dataNote: "Served from China under DeepSeek's terms; read its privacy policy before sending anything personal.",
    getKey: { href: "https://platform.deepseek.com/api_keys", text: "Get a key at platform.deepseek.com" },
  },
  {
    kind: "moonshot", name: "Moonshot", label: "Moonshot (Kimi, direct)", mark: "K", colour: "#1783FF",
    api: "openai", baseUrl: "https://api.moonshot.ai/v1", list: "openai", browser: true,
    key: { pattern: SK_KEY, hint: "A key from platform.kimi.ai (sk-…)." },
    models: [
      { id: "kimi-k2.6", label: "Kimi K2.6", note: "price [?]" },
    ],
    dataNote: "Served under Moonshot's terms; read its privacy policy before sending anything personal.",
    getKey: { href: "https://platform.kimi.ai/console/api-keys", text: "Get a key at platform.kimi.ai" },
  },
  {
    kind: "qwen", name: "Qwen", label: "Qwen (Alibaba Model Studio, direct)", mark: "Qw", colour: "#615CED",
    api: "openai", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", list: "openai", browser: true,
    key: { pattern: SK_KEY, hint: "A Model Studio key from the Singapore region (sk-…)." },
    models: [
      { id: "qwen-flash", label: "Qwen Flash", note: "$0.05 / $0.40" },
      { id: "qwen3.8-flash", label: "Qwen 3.8 Flash", note: "$0.15 / $0.47" },
    ],
    dataNote: "New accounts get a million free tokens per model for 90 days.",
    getKey: { href: "https://modelstudio.console.alibabacloud.com/", text: "Get a key at Alibaba Model Studio" },
  },
  {
    kind: "minimax", name: "MiniMax", label: "MiniMax (direct)", mark: "MM", colour: "#E73562",
    api: "openai", baseUrl: "https://api.minimax.io/v1", list: "openai", browser: true,
    key: { pattern: ANY_KEY, hint: "An API key from platform.minimax.io." },
    models: [
      { id: "MiniMax-M3.1-Flash", label: "MiniMax M3.1 Flash", note: "$0.15 / $0.60" },
    ],
    dataNote: "Served under MiniMax's terms; read its privacy policy before sending anything personal.",
    getKey: { href: "https://platform.minimax.io/", text: "Get a key at platform.minimax.io" },
  },
  {
    kind: "siliconflow", name: "SiliconFlow", label: "SiliconFlow (Chinese open models)", mark: "SF", colour: "#7C3AED",
    api: "openai", baseUrl: "https://api.siliconflow.com/v1", list: "openai", browser: true,
    key: { pattern: SK_KEY, hint: "A key from cloud.siliconflow.com (sk-…). Your model list loads once the key is saved." },
    models: [
      { id: "Qwen/Qwen3-8B", label: "Qwen3 8B", note: "free [?]" },
      { id: "deepseek-ai/DeepSeek-V3.2", label: "DeepSeek V3.2", note: "price [?]" },
    ],
    dataNote: "Hosts DeepSeek, Qwen, GLM, Kimi and other open models; some small ones are free. It may ask for identity verification.",
    getKey: { href: "https://cloud.siliconflow.com/account/ak", text: "Get a key at cloud.siliconflow.com" },
  },
  {
    kind: "baidu", name: "Baidu Qianfan", label: "Baidu Qianfan (ERNIE, direct)", mark: "Bd", colour: "#2932E1",
    api: "openai", baseUrl: "https://qianfan.baidubce.com/v2", list: "openai", browser: true,
    key: { pattern: ANY_KEY, hint: "A Qianfan API key from the Baidu AI Cloud console." },
    models: [
      { id: "ernie-speed-pro-128k", label: "ERNIE Speed Pro", note: "price [?], Baidu's cheapest" },
      { id: "ernie-5.1", label: "ERNIE 5.1", note: "price [?]" },
    ],
    dataNote: "Prices are in CNY; the account is a Baidu AI Cloud account.",
    getKey: { href: "https://console.bce.baidu.com/qianfan/", text: "Get a key at Baidu AI Cloud" },
  },
  {
    kind: "xiaomi", name: "Xiaomi MiMo", label: "Xiaomi MiMo (direct)", mark: "Mi", colour: "#FF6900",
    api: "openai", baseUrl: "https://api.xiaomimimo.com/v1", list: "openai", browser: true,
    key: { pattern: ANY_KEY, hint: "An API key from Xiaomi's MiMo platform." },
    models: [
      { id: "mimo-v2.6-flash", label: "MiMo V2.6 Flash", note: "price [?]; $0.14 / $0.28 on OpenRouter" },
    ],
    dataNote: "Served under Xiaomi's terms; read its privacy policy before sending anything personal.",
    getKey: { href: "https://platform.xiaomimimo.com/", text: "Get a key from Xiaomi MiMo" },
  },
  {
    kind: "groq", name: "Groq", label: "Groq (fast, free tier)", mark: "Gq", colour: "#F55036",
    api: "openai", baseUrl: "https://api.groq.com/openai/v1", list: "openai", browser: true,
    key: { pattern: /^gsk_[A-Za-z0-9]{20,}$/, hint: "A key from console.groq.com (gsk_…). The free plan has daily limits." },
    models: [
      { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", note: "$0.075 / $0.30, free plan" },
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", note: "$0.15 / $0.60, free plan" },
    ],
    dataNote: "Every model on Groq supports tool calling.",
    getKey: { href: "https://console.groq.com/keys", text: "Get a key at console.groq.com" },
  },
  {
    kind: "google", name: "Google AI Studio", label: "Google AI Studio (Gemini, free tier)", mark: "G", colour: "#4285F4",
    api: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", list: "openai", browser: true,
    key: { pattern: /^AIza[0-9A-Za-z_-]{30,}$/, hint: "A Gemini API key from aistudio.google.com (AIza…)." },
    models: [
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", note: "free tier, then $0.10 / $0.40" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", note: "free tier, then $0.30 / $2.50" },
    ],
    dataNote: "On the free tier Google may use your prompts to improve its products.",
    getKey: { href: "https://aistudio.google.com/apikey", text: "Get a key at aistudio.google.com" },
  },
  {
    kind: "mistral", name: "Mistral", label: "Mistral (direct)", mark: "Ms", colour: "#FA520F",
    api: "openai", baseUrl: "https://api.mistral.ai/v1", list: "openai", browser: true,
    key: { pattern: ANY_KEY, hint: "A key from console.mistral.ai." },
    models: [
      { id: "ministral-8b-latest", label: "Ministral 8B", note: "$0.15 / $0.15" },
      { id: "mistral-small-latest", label: "Mistral Small", note: "$0.15 / $0.60" },
    ],
    dataNote: "Mistral's free plan may use your prompts to train its models; the paid plan does not.",
    getKey: { href: "https://console.mistral.ai/api-keys", text: "Get a key at console.mistral.ai" },
  },
  // The rest refused the browser's CORS check, so only the Desktop App offers them.
  {
    kind: "zai", name: "Z.ai", label: "Z.ai (GLM, free Flash models)", mark: "Z", colour: "#2D5BFF",
    api: "openai", baseUrl: "https://api.z.ai/api/paas/v4", list: "openai", browser: false,
    key: { pattern: ANY_KEY, hint: "An API key from z.ai." },
    models: [
      { id: "glm-4.7-flash", label: "GLM 4.7 Flash (free)", note: "free" },
      { id: "glm-4.5-flash", label: "GLM 4.5 Flash (free)", note: "free" },
      { id: "glm-5.3-flash", label: "GLM 5.3 Flash", note: "$0.15 / $0.50" },
    ],
    dataNote: "Served under Z.ai's terms; read its privacy policy before sending anything personal.",
    getKey: { href: "https://z.ai/manage-apikey/apikey-list", text: "Get a key at z.ai" },
  },
  {
    kind: "tencent", name: "Tencent Hunyuan", label: "Tencent Hunyuan (direct)", mark: "Hy", colour: "#0052D9",
    api: "openai", baseUrl: "https://api.hunyuan.cloud.tencent.com/v1", list: "openai", browser: false,
    key: { pattern: ANY_KEY, hint: "A Hunyuan API key from the Tencent Cloud console." },
    models: [
      { id: "hunyuan-a13b", label: "Hunyuan A13B", note: "0.5 / 2 CNY, a million free tokens for a year [?]" },
    ],
    dataNote: "Tencent is moving Hunyuan to TokenHub; this address may change [?].",
    getKey: { href: "https://console.cloud.tencent.com/hunyuan/api-key", text: "Get a key at Tencent Cloud" },
  },
  {
    kind: "byteplus", name: "BytePlus", label: "BytePlus ModelArk (Doubao Seed)", mark: "BP", colour: "#3370FF",
    api: "openai", baseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3", list: "openai", browser: false,
    key: { pattern: ANY_KEY, hint: "A ModelArk API key from the BytePlus console." },
    models: [
      { id: "seed-2-0-lite-260428", label: "Seed 2.0 Lite", note: "$0.25 / $2.00 [?]" },
    ],
    dataNote: "Seed 2.0 Mini is cheaper on OpenRouter.",
    getKey: { href: "https://console.byteplus.com/ark", text: "Get a key at BytePlus" },
  },
  {
    kind: "stepfun", name: "StepFun", label: "StepFun (Step, direct)", mark: "St", colour: "#0F6EFF",
    api: "openai", baseUrl: "https://api.stepfun.com/v1", list: "openai", browser: false,
    key: { pattern: ANY_KEY, hint: "An API key from platform.stepfun.com." },
    models: [
      { id: "step-3.5-flash", label: "Step 3.5 Flash", note: "about $0.10 / $0.30 [?]" },
    ],
    dataNote: "Served under StepFun's terms; read its privacy policy before sending anything personal.",
    getKey: { href: "https://platform.stepfun.com/interface-key", text: "Get a key at platform.stepfun.com" },
  },
  {
    kind: "internlm", name: "InternLM", label: "InternLM (Shanghai AI Lab)", mark: "IL", colour: "#1A5CFF",
    api: "openai", baseUrl: "https://chat.intern-ai.org.cn/api/v1", list: "openai", browser: false,
    key: { pattern: ANY_KEY, hint: "A token from internlm.intern-ai.org.cn." },
    models: [
      { id: "internlm2.5-latest", label: "InternLM 2.5", note: "free [?]" },
    ],
    dataNote: "Served under Shanghai AI Lab's terms [?].",
    getKey: { href: "https://internlm.intern-ai.org.cn/api/tokens", text: "Get a token at intern-ai.org.cn" },
  },
  {
    kind: "opencode", name: "OpenCode Zen", label: "OpenCode Zen (free models)", mark: "OC", colour: "#211E1E",
    api: "openai", baseUrl: "https://opencode.ai/inference/openai/v1", list: "openai", browser: false,
    key: { pattern: ANY_KEY, hint: "A key from opencode.ai/zen. The free models are free for a limited time." },
    models: [
      { id: "glm-5.3-flash-free", label: "GLM 5.3 Flash (free)", note: "free, zero retention" },
      { id: "deepseek-v4.1-flash-free", label: "DeepSeek V4.1 Flash (free)", note: "free, zero retention" },
      { id: "longcat-2.5-preview-free", label: "LongCat 2.5 Preview (free)", note: "free, zero retention" },
    ],
    dataNote: "Only Zen's zero-retention free models are listed; its other free models may train on your prompts.",
    getKey: { href: "https://opencode.ai/zen", text: "Get a key at opencode.ai" },
  },
  {
    kind: "cerebras", name: "Cerebras", label: "Cerebras (fast, trial credit)", mark: "Cb", colour: "#F15A29",
    api: "openai", baseUrl: "https://api.cerebras.ai/v1", list: "openai", browser: false,
    key: { pattern: ANY_KEY, hint: "A key from cloud.cerebras.ai. The trial is a one-time $5 credit." },
    models: [
      { id: "gpt-oss-120b", label: "GPT-OSS 120B", note: "price [?]" },
      { id: "qwen-3.8-27b", label: "Qwen 3.8 27B", note: "price [?]" },
    ],
    dataNote: "Served under Cerebras's terms; read its privacy policy before sending anything personal.",
    getKey: { href: "https://cloud.cerebras.ai/", text: "Get a key at cloud.cerebras.ai" },
  },
];

export function catalogueProvider(kind: string): CatalogueProvider | null {
  return CATALOGUE.find((p) => p.kind === kind) ?? null;
}

/** Black or white letters, whichever reads better on the tile's colour. */
export function inkOn(hex: string): "#000000" | "#FFFFFF" {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (lum + 0.05) / 0.05 > 1.05 / (lum + 0.05) ? "#000000" : "#FFFFFF";
}

/** A price per million tokens as the picker shows it: "$0.03 / $0.13", or "free". */
export function priceNote(input: number, output: number): string {
  if (input === 0 && output === 0) return "free";
  // Two places, or two significant figures for a price under a dime: $0.40, $2.50, $15, $0.024.
  const usd = (raw: number) => {
    const n = +raw.toPrecision(6); // 0.0000001 * 1e6 is 0.09999…
    return `$${n < 0.1 ? +n.toPrecision(2) : n.toFixed(2).replace(/\.00$/, "")}`;
  };
  return `${usd(input)} / ${usd(output)}`;
}

/** Ids in a provider's list that are not chat models. */
const NOT_CHAT = /embed|whisper|tts|speech|audio|image|dall-e|rerank|moderation|ocr|transcri/i;
/** OpenRouter models past this price, in and out, are left to "Another model id" unless the catalogue lists them. */
const CHEAP = 1;

type ListSource = Pick<CatalogueProvider, "list" | "baseUrl" | "models">;

/**
 * The provider's own model list, the catalogue's lines first and then the rest, for the pickers. OpenRouter's list
 * is public and carries prices: every model there that calls tools and is free or under a dollar a million tokens
 * either way. Anthropic and the OpenAI-compatible providers list what the key may use; Ollama lists what the player
 * pulled. Null when the list cannot be read (offline, no key yet, refused), so the catalogue is shown instead.
 */
export async function listModels(p: ListSource, key: string, send: typeof fetch = fetch): Promise<CatalogueModel[] | null> {
  const known = new Map(p.models.map((m) => [m.id, m]));
  const get = async (url: string, headers: Record<string, string> = {}) => {
    const res = await send(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  };
  let live: CatalogueModel[];
  try {
    if (p.list === "openrouter") {
      // The whole list, filtered here: OpenRouter's own tools filter leaves its routers out.
      const body = await get(`${p.baseUrl}/models`);
      live = ((body.data ?? []) as { id: string; name?: string; pricing?: { prompt?: string; completion?: string }; supported_parameters?: string[] }[])
        // Batch variants answer later, not in a chat.
        .filter((m) => typeof m.id === "string" && !m.id.endsWith(":batch") && (m.supported_parameters ?? []).includes("tools"))
        .flatMap((m) => {
          const input = Number(m.pricing?.prompt) * 1e6, output = Number(m.pricing?.completion) * 1e6;
          const priced = Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0;
          if (!known.has(m.id) && (!priced || input > CHEAP || output > CHEAP)) return [];
          const note = priced ? (input === 0 && output === 0 && known.get(m.id)?.note) || priceNote(input, output) : known.get(m.id)?.note ?? "";
          return [{ id: m.id, label: known.get(m.id)?.label ?? m.name ?? m.id, note }];
        });
    } else if (p.list === "anthropic") {
      if (!key) return null;
      const body = await get(`${p.baseUrl}/models?limit=100`, { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });
      live = ((body.data ?? []) as { id: string; display_name?: string }[]).map((m) => ({ id: m.id, label: known.get(m.id)?.label ?? m.display_name ?? m.id, note: known.get(m.id)?.note ?? "" }));
    } else if (p.list === "ollama") {
      const body = await get(`${p.baseUrl.replace(/\/v1\/?$/, "")}/api/tags`);
      return ((body.models ?? []) as { name: string; size?: number }[]).map((m) => ({ id: m.name, label: m.name, note: m.size ? `${(m.size / 1e9).toFixed(1)} GB, on this computer` : "on this computer" }));
    } else {
      // A server without keys (a custom one) is asked as it is; the callers do not ask a keyed provider without its key.
      const body = await get(`${p.baseUrl}/models`, key ? { authorization: `Bearer ${key}` } : {});
      live = ((body.data ?? []) as { id: string }[]).filter((m) => typeof m.id === "string" && !NOT_CHAT.test(m.id)).map((m) => known.get(m.id) ?? { id: m.id, label: m.id, note: "" });
    }
  } catch {
    return null;
  }
  if (live.length === 0) return null;
  const ids = new Set(live.map((m) => m.id));
  const first = p.models.filter((m) => ids.has(m.id)).map((m) => live.find((l) => l.id === m.id)!);
  return [...first, ...live.filter((m) => !known.has(m.id))];
}
