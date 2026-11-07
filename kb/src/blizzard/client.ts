import type { DB } from "../db.js";
import { USER_AGENT } from "../http.js";
import { namespace, type Game, type NsKind, type Region } from "./namespaces.js";

export interface BlizzardConfig {
  clientId: string;
  clientSecret: string;
  region: Region;
  locale?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Blizzard Developer API Terms 2(s): data is refreshed at least every 30 days and kept no longer. */
const MAX_AGE_MS = 30 * 86_400_000;

/**
 * Battle.net API client. Responses are cached in `api_cache` on this machine only — Blizzard's terms
 * forbid redistributing the data, so the snapshot command always drops this table. Every request first
 * deletes rows fetched more than 30 days ago, no cached copy is served past 30 days, and a 404 deletes the
 * cached copy (terms 2(s): a character the API no longer has is not kept or shown).
 */
export class BlizzardClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly db: DB,
    private readonly cfg: BlizzardConfig,
  ) {}

  private http(): typeof fetch {
    return this.cfg.fetchImpl ?? fetch;
  }

  private clock(): number {
    return (this.cfg.now ?? Date.now)();
  }

  async get(path: string, game: Game, kind: NsKind, ttlSeconds = 86_400): Promise<unknown> {
    const ns = namespace(game, kind, this.cfg.region);
    const url = new URL(`https://${this.cfg.region}.api.blizzard.com${path}`);
    url.searchParams.set("namespace", ns);
    url.searchParams.set("locale", this.cfg.locale ?? "en_US");
    const key = url.toString();

    this.db.prepare("DELETE FROM api_cache WHERE fetched_at < ?").run(new Date(this.clock() - MAX_AGE_MS).toISOString());
    const cached = this.db.prepare("SELECT body, expires_at FROM api_cache WHERE key = ?").get(key) as
      | { body: string; expires_at: string }
      | undefined;
    if (cached && Date.parse(cached.expires_at) > this.clock()) return JSON.parse(cached.body);

    const res = await this.http()(key, {
      headers: { Authorization: `Bearer ${await this.accessToken()}`, "User-Agent": USER_AGENT },
    });
    if (res.status === 404) this.db.prepare("DELETE FROM api_cache WHERE key = ?").run(key);
    if (!res.ok) throw new Error(`Blizzard API HTTP ${res.status}: ${path} (${ns})`);
    const body = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error(`Blizzard API returned non-JSON for ${path} (${ns})`);
    }
    const now = this.clock();
    this.db
      .prepare(
        `INSERT INTO api_cache (key, body, fetched_at, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
      )
      .run(key, body, new Date(now).toISOString(), new Date(now + Math.min(ttlSeconds * 1000, MAX_AGE_MS)).toISOString());
    return parsed;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.clock() + 60_000) return this.token.value;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
    const res = await this.http()("https://oauth.battle.net/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`Blizzard OAuth HTTP ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, expiresAt: this.clock() + j.expires_in * 1000 };
    return this.token.value;
  }
}
