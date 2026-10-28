import type { CategoryId } from "./map-view";

/**
 * The marks on the world map and in its legend. A pin's kind names one legend category, so the legend row and
 * the pins it switches are drawn from the same source: the game's own minimap icon where the asset upload has
 * one (docs/ASSETS.md, "Map legend icons"), else the site's glyph from the stylesheet.
 */

/** The kinds a pin on the map can be. */
export type PinKind = "dungeon" | "raid" | "flight" | "npc" | "vendor" | "chest";

/** The legend category each pin kind belongs to. */
export const PIN_CATEGORY: Record<PinKind, CategoryId> = { dungeon: "dungeon", raid: "raid", flight: "flight", npc: "npc", vendor: "vendor", chest: "chest" };

/** Legend category id -> the URL of the game's icon for it, for the categories the upload covers. */
export type PoiIcons = Partial<Record<CategoryId, string>>;

/** The categories whose row and pins can carry a game icon. Zones and flight paths are shapes, never icons. */
export const ICON_CATEGORIES: readonly CategoryId[] = ["flight", "dungeon", "raid", "vendor", "trainer", "quest", "service", "npc", "herb", "ore", "chest"];

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The game's icon for a pin kind, or null when the upload has none for its category. */
export const pinIconUrl = (kind: PinKind, icons: PoiIcons): string | null => icons[PIN_CATEGORY[kind]] ?? null;

/** What goes inside a pin's element: the game's icon as an image, or the empty span the stylesheet draws a glyph on. */
export function pinMarkHtml(kind: PinKind, icons: PoiIcons): string {
  const url = pinIconUrl(kind, icons);
  return url ? `<img src="${escapeAttr(url)}" alt="" draggable="false">` : "<span></span>";
}
