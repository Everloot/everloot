import type { Region } from "./api.js";
import type { CharacterRow, GuildRow, MemberRow } from "./parse.js";
export type Kind = "character" | "guild";
export interface QueueRow {
  slug: string;
  tries: number;
  stored: boolean;
}
export class ArmoryStore {
  constructor(
    private readonly cfg: {
      url: string;
      serviceKey: string;
      fetchImpl?: typeof fetch;
    },
  ) {}
  async rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const response = await (this.cfg.fetchImpl ?? fetch)(
      `${this.cfg.url.replace(/\/$/, "")}/rest/v1/rpc/${name}`,
      {
        method: "POST",
        headers: {
          apikey: this.cfg.serviceKey,
          Authorization: `Bearer ${this.cfg.serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(args),
      },
    );
    if (!response.ok) throw Error(`Armory RPC ${name} HTTP ${response.status}`);
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }
  seedFromPlayers() {
    return this.rpc<number>("armory_seed_from_players");
  }
  take(region: Region, kind: Kind, limit: number) {
    return this.rpc<QueueRow[]>("armory_take", {
      p_region: region,
      p_kind: kind,
      p_limit: limit,
    });
  }
  character(region: Region, slug: string) {
    return this.rpc<{ last_modified: string | null }[]>("armory_character", {
      p_region: region,
      p_slug: slug,
    });
  }
  upsertCharacters(region: Region, rows: CharacterRow[]) {
    return this.rpc<number>("armory_upsert_characters", {
      p_region: region,
      p_rows: rows,
    });
  }
  upsertGuild(region: Region, guild: GuildRow, members: MemberRow[]) {
    return this.rpc<number>("armory_upsert_guild", {
      p_region: region,
      p_guild: guild,
      p_members: members,
    });
  }
  touch(region: Region, kind: Kind, slugs: string[]) {
    return this.rpc<number>("armory_touch", {
      p_region: region,
      p_kind: kind,
      p_slugs: slugs,
    });
  }
  missing(region: Region, kind: Kind, slug: string) {
    return this.rpc<void>("armory_missing", {
      p_region: region,
      p_kind: kind,
      p_slug: slug,
    });
  }
  retry(region: Region, kind: Kind, slug: string, delay: string) {
    return this.rpc<void>("armory_retry", {
      p_region: region,
      p_kind: kind,
      p_slug: slug,
      p_delay: delay,
    });
  }
  purge() {
    return this.rpc<number>("armory_purge");
  }
}
export type CrawlStore = Pick<
  ArmoryStore,
  | "seedFromPlayers"
  | "take"
  | "character"
  | "upsertCharacters"
  | "upsertGuild"
  | "touch"
  | "missing"
  | "retry"
  | "purge"
>;
