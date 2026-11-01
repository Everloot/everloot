import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { readJsonFile } from "./json-file";
import type { Settings } from "../shared/types";

export const DEFAULT_ENDPOINT = "https://everloot.app";

export function defaultSettings(): Settings {
  return {
    gameFolder: null,
    keptGameFolder: null,
    endpoint: DEFAULT_ENDPOINT,
    upload: true,
    prices: true,
    census: true,
    players: false,
    ask: { enabled: false, mcpUrl: `${DEFAULT_ENDPOINT}/mcp`, tokenFile: null },
    market: { realms: [] },
    consentedAt: null,
    launchAtLogin: false,
    startInTray: true,
  };
}

const isHttp = (s: unknown): s is string => typeof s === "string" && /^https?:\/\/\S+$/.test(s);
const str = (s: unknown): string | null => (typeof s === "string" && s.trim() ? s.trim() : null);
const bool = (b: unknown, fallback: boolean): boolean => (typeof b === "boolean" ? b : fallback);

/**
 * Applies a patch from the page or a file onto known settings. Unknown keys are dropped and bad
 * values keep what was there, so a damaged file or a mistyped patch never leaves the app without
 * a usable configuration.
 */
export function mergeSettings(base: Settings, patch: unknown): Settings {
  const p = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  const ask = (p.ask && typeof p.ask === "object" ? p.ask : {}) as Record<string, unknown>;
  const market = (p.market && typeof p.market === "object" ? p.market : {}) as Record<string, unknown>;
  const realms = Array.isArray(market.realms)
    ? [...new Set(market.realms.filter((r): r is string => typeof r === "string").map((r) => r.trim()).filter((r) => r.length >= 2 && r.length <= 60))].slice(0, 20)
    : base.market.realms;
  return {
    gameFolder: "gameFolder" in p ? (p.gameFolder === null ? null : str(p.gameFolder) ?? base.gameFolder) : base.gameFolder,
    keptGameFolder: "keptGameFolder" in p ? (p.keptGameFolder === null ? null : str(p.keptGameFolder) ?? base.keptGameFolder) : base.keptGameFolder,
    endpoint: isHttp(p.endpoint) ? p.endpoint.replace(/\/+$/, "") : base.endpoint,
    upload: bool(p.upload, base.upload),
    prices: bool(p.prices, base.prices),
    census: bool(p.census, base.census),
    players: bool(p.players, base.players),
    ask: {
      enabled: bool(ask.enabled, base.ask.enabled),
      mcpUrl: isHttp(ask.mcpUrl) ? ask.mcpUrl : base.ask.mcpUrl,
      tokenFile: "tokenFile" in ask ? (ask.tokenFile === null ? null : str(ask.tokenFile) ?? base.ask.tokenFile) : base.ask.tokenFile,
    },
    market: { realms },
    consentedAt: "consentedAt" in p ? (p.consentedAt === null ? null : str(p.consentedAt) ?? base.consentedAt) : base.consentedAt,
    launchAtLogin: bool(p.launchAtLogin, base.launchAtLogin),
    startInTray: bool(p.startInTray, base.startInTray),
  };
}

export interface LoadedSettings { settings: Settings; error: string | null }

/**
 * Reads settings.json. A missing file is the defaults; a damaged one is the defaults plus an error to
 * show, and is moved aside to `settings.json.corrupt-<id>` first (as sent.json and answers.json are),
 * so the next Save does not write over what the player had.
 */
export function loadSettings(path: string): LoadedSettings {
  if (!existsSync(path)) return { settings: defaultSettings(), error: null };
  try {
    const parsed: unknown = readJsonFile(path);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SyntaxError("not an object");
    // A setup finished before the census switch agreed to a list without it: the census stays off until the player turns it on.
    const agreedBefore = !("census" in parsed) && Boolean((parsed as { consentedAt?: unknown }).consentedAt);
    const base = agreedBefore ? { ...defaultSettings(), census: false } : defaultSettings();
    return { settings: mergeSettings(base, parsed), error: null };
  } catch (err) {
    let kept = "";
    // Only a file that read but is not settings; one the system would not let the app read is left alone.
    if (err instanceof SyntaxError) {
      try { const backup = `${path}.corrupt-${randomUUID()}`; renameSync(path, backup); kept = `; the damaged file is kept as ${basename(backup)}`; } catch { /* left in place */ }
    }
    return { settings: defaultSettings(), error: `settings.json could not be read (${err instanceof Error ? err.message : String(err)}); using defaults${kept}` };
  }
}

/** Writes through a temp file and a rename, so a crash mid-write never leaves a half file. */
export function saveSettings(path: string, settings: Settings): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
  renameSync(tmp, path);
}
