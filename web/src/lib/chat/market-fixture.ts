/**
 * One synthetic item and realm, as `market_value` answers for it, shared by the parity tests of the three
 * places that answer a price question: website Chat, Desktop Chat and the in-game /ask bridge. The numbers
 * are made up. market-question.test.ts checks them against what kb/src/market.ts derives from three scans,
 * so this file cannot drift from the server.
 */

export const FIXTURE_REALM = "Forever";
export const FIXTURE_ITEM = 2589;
export const FIXTURE_LABEL = "Linen Cloth";
export const FIXTURE_URL = "https://everloot.app/tools/auctions?realm=Forever&item=2589";
export const FIXTURE_DATA_AS_OF = "2026-10-20T06:30:00.000Z";

/** What the tool returns for three reporters who scanned on 2026-10-20: market 310, minimum 300, historical 310 copper. */
export const FIXTURE_STRUCTURED = {
  connected: true,
  dataAsOf: FIXTURE_DATA_AS_OF,
  url: FIXTURE_URL,
  page: {
    realm: FIXTURE_REALM,
    itemId: FIXTURE_ITEM,
    value: { itemId: FIXTURE_ITEM, market: 310, min: 300, historical: 310, quantity: 100, day: "2026-10-20", ageDays: 0, reporters: 3, thin: false },
    history: [{ day: "2026-10-20", min: 300, market: 310, quantity: 100, reporters: 3, thin: false }],
  },
};

/** The deterministic answer every surface gives for that result, with the item's name known. */
export const FIXTURE_ANSWER =
  "Linen Cloth (item 2589) on Forever, all houses: market 3s 10c, minimum 3s 0c, historical 3s 10c each. " +
  "Newest public day 2026-10-20, 3 reporters, 100 listed. A recorded community blend, not a live auction quote.";
