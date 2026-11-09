import type { ShowcaseInput } from "@/lib/character-showcase";
import { loadItemTips, loadSiteAssets } from "@/lib/game-assets";
import { loadListNames } from "@/lib/item-view";

/**
 * The showcase's gear with each item's name and icon where the item lists would show them: only for items whose
 * page shows its game file tooltip (`showsTip`, the rule /search and the item lists use), and only with the asset
 * files set (docs/ASSETS.md). A name players agree on comes first. Without the asset URL nothing is read and the
 * rows stay "Item <id>" with no icon. Pages only; never throws.
 */
export async function withGearArt(input: ShowcaseInput): Promise<ShowcaseInput> {
  if (input.gear.state !== "shown" || !input.gear.data.length) return input;
  try {
    const assets = await loadSiteAssets();
    if (!assets) return input;
    const shown = await loadListNames();
    const tips = await loadItemTips(assets, input.gear.data.map((r) => r.itemId).filter((id) => shown.showsTip(id)));
    const data = input.gear.data.map((r) => {
      const tip = tips.get(r.itemId);
      return tip ? { ...r, name: r.name ?? shown.agreed.get(r.itemId) ?? tip.name, icon: tip.icon } : r;
    });
    return { ...input, gear: { ...input.gear, data } };
  } catch {
    return input;
  }
}
