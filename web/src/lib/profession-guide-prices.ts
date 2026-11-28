import { auctionCut } from "@kb/auction-fees";

type Material = { itemId: number; count: number };
type QuoteInputs = {
  reagents: readonly Material[];
  unlockReagents?: readonly Material[];
  output: {
    itemId: number;
    minimum: number | null;
    maximum: number | null;
    vendorSellCopper?: number | null;
  } | null;
};
export type GuideDisenchants = Readonly<Record<number, readonly Material[]>>;
export type VendorPrices = Readonly<Record<number, number>>;

/** The items we actually need, including priced results and the materials they can disenchant into. */
export function requestedGuideItems(recipes: readonly QuoteInputs[], disenchants: GuideDisenchants): number[] {
  const ids = new Set<number>();
  for (const { reagents, unlockReagents, output } of recipes) {
    for (const reagent of reagents) ids.add(reagent.itemId);
    for (const reagent of unlockReagents ?? []) ids.add(reagent.itemId);
    if (!output) continue;
    ids.add(output.itemId);
    for (const material of disenchants[output.itemId] ?? []) ids.add(material.itemId);
  }
  return [...ids].sort((a, b) => a - b);
}

export function guideBuyPrice(itemId: number, market: ReadonlyMap<number, number>, vendor: VendorPrices): number | null {
  const auction = market.get(itemId);
  const buy = vendor[itemId];
  if (auction === undefined) return buy ?? null;
  return buy === undefined ? auction : Math.min(auction, buy);
}

function total(rows: readonly Material[], unit: (item: number) => number | null): number | null {
  let copper = 0;
  for (const { itemId, count } of rows) {
    const price = unit(itemId);
    if (price === null) return null;
    copper += price * count;
  }
  return copper;
}

/** Missing input prices, yields and return quotes stay unknown. A no-item enchant has no resale credit. */
export function priceGuideRecipe(
  recipe: QuoteInputs,
  market: ReadonlyMap<number, number>,
  vendor: VendorPrices,
  house: string | null,
  disenchants?: readonly Material[],
) {
  const materials = total(recipe.reagents, (id) => guideBuyPrice(id, market, vendor));
  if (materials === null) return { materials, vendor: null, auction: null, disenchant: null };
  if (!recipe.output) return { materials, vendor: materials, auction: materials, disenchant: materials };
  const { itemId, minimum, maximum, vendorSellCopper } = recipe.output;
  if (minimum === null || maximum === null) return { materials, vendor: null, auction: null, disenchant: null };
  const averageYield = (minimum + maximum) / 2;
  const net = (price: number | null, cut = 0) => price === null ? null : materials - Math.round(price * averageYield * (1 - cut));
  const outputQuote = market.get(itemId) ?? null;
  const shards = disenchants?.length ? total(disenchants, (id) => market.get(id) ?? null) : null;
  return {
    materials,
    vendor: net(vendorSellCopper ?? null),
    auction: net(outputQuote, auctionCut(house)),
    disenchant: net(shards, auctionCut(house)),
  };
}
