import type { Region } from "../armory/api.js";
import { StoreError } from "../armory/store.js";
import type { PriceRow } from "./summary.js";

export interface HouseSnapshot {
  house_id: number;
  name: string;
  snapshot_at: string;
}

/**
 * The functions of 20261113120000_blizzard_auctions.sql, called with the service key. Blizzard auction data has its
 * own tables: it never joins the player-reported market (kb/src/market.ts).
 */
export class AuctionStore {
  constructor(private readonly cfg: { url: string; serviceKey: string; fetchImpl?: typeof fetch }) {}

  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await (this.cfg.fetchImpl ?? fetch)(`${this.cfg.url.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
        headers: {
          apikey: this.cfg.serviceKey,
          Authorization: `Bearer ${this.cfg.serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      });
    } catch {
      throw new StoreError(null);
    }
    if (!response.ok) throw new StoreError(response.status);
    const text = await response.text().catch(() => {
      throw new StoreError(null);
    });
    return (text ? JSON.parse(text) : null) as T;
  }

  /** Replace a house's summaries with a newer snapshot. Null when the stored snapshot is as new or newer. */
  put(region: Region, house: HouseSnapshot, rows: PriceRow[]) {
    return this.rpc<number | null>("blizzard_auctions_put", { p_region: region, p_house: house, p_rows: rows });
  }

  /** Delete every summary and house older than 30 days; returns the rows deleted. */
  purge() {
    return this.rpc<number>("blizzard_auctions_purge", {});
  }
}

export type JobStore = Pick<AuctionStore, "put" | "purge">;
