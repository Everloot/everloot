import { MONEY_CATEGORIES } from "../../../kb/src/gold-ledger";

/**
 * The addon's local gold ledger categories (addon/modules/ledger.lua, L.INCOME and L.SPENDING, in its order): the
 * nine the upload carries (kb/src/gold-ledger.ts) plus six the addon keeps only in EverlootDB.ledger. The Characters
 * page reads that table from the save file; nothing here is uploaded.
 */
export const LEDGER_INCOME: readonly string[] = ["loot", "quest", "vendor", "auction", "trade_in", "mail_in"];
export const LEDGER_SPENDING: readonly string[] = ["flight", "postage", "barber", "respec", "auction_spend", "repair", "vendor_spend", "trade_out", "mail_out"];

/** The addon's own names for the categories (addon/modules/ledger.lua, L.LABELS). */
export const LEDGER_LABELS: Readonly<Record<string, string>> = {
  loot: "Loot", quest: "Quest rewards", vendor: "Vendor sales", auction: "Auction sales",
  trade_in: "Trades in", mail_in: "Mail in",
  flight: "Flight paths", postage: "Postage", barber: "Barber", respec: "Respecs", auction_spend: "Auction purchases",
  repair: "Repairs", vendor_spend: "Vendor purchases", trade_out: "Trades out", mail_out: "Mail out",
};
/** The category's name as the addon shows it; a category it has no name for is shown as it is written. */
export const categoryLabel = (category: string): string => LEDGER_LABELS[category] ?? category.replace(/_/g, " ");

/** The ledger categories a money_event record never carries: repairs, vendor purchases, trades and mail. */
export const LOCAL_ONLY_CATEGORIES: readonly string[] = [...LEDGER_INCOME, ...LEDGER_SPENDING].filter((c) => !(MONEY_CATEGORIES as readonly string[]).includes(c));

/** "out" for a spending category, "in" for anything else, as the addon's L.Direction and the web's directionOf. */
export const directionOf = (category: string): "in" | "out" => (LEDGER_SPENDING.includes(category) ? "out" : "in");

export const DAY_MS = 24 * 3600 * 1000;
/** The Gold tab's periods include today and preceding whole UTC days. */
export const utcDay = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;
export const periodStart = (now: number, days: number): number => utcDay(now) - (days - 1) * DAY_MS;
