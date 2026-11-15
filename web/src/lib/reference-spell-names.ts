import "server-only";
import { loadSiteAssets, loadSpellNames } from "@/lib/game-assets";
import { loadCatalog, type TalentClassSlug } from "@/lib/talents/catalogs";
import { CLIENT_LAYER } from "@/lib/items";
import { CLASS_LAYOUTS, type ReferenceLayouts } from "@/data/reference-spells";

/** Page-only names and tooltip text, using the spell database's private readers and current build. */
export async function loadReferenceSpells(): Promise<ReferenceLayouts> {
  const [names, assets] = await Promise.all([
    loadSpellNames(CLIENT_LAYER.build.version),
    loadSiteAssets(),
  ]);
  return Object.fromEntries(await Promise.all(Object.entries(CLASS_LAYOUTS).map(async ([cls, layout]) => {
    const catalog = await loadCatalog(cls as TalentClassSlug);
    const definitions = new Map(catalog.nodes.flatMap((node) => node.entries.map((entry) => [entry.spellId, entry.definitionId] as const)));
    return [cls,
      Object.fromEntries(Object.entries(layout).map(([role, spell]) => {
        const tip = assets?.spellTips.get(spell.id);
        const definitionId = definitions.get(spell.id);
        const talent = definitionId == null ? undefined : assets?.talents.get(definitionId);
        return [role, { id: spell.id, name: names?.names.get(spell.id) || tip?.name || undefined, evidence: talent?.text || tip?.text || undefined }];
      })),
    ];
  })));
}
