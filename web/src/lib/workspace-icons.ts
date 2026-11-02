import { classAndProfessionIcons, emblems, type SiteAssets } from "./game-assets";

/** The game icons Plans and Alts on this device draw, as plain records a client component can take. Empty without
 *  the asset folder: the pages then show names and colours only. */
export interface WorkspaceIcons {
  /** Class slug -> icon URL. */
  classes: Record<string, string>;
  /** Profession name as the workspace keeps it ("First Aid") -> icon URL. */
  professions: Record<string, string>;
  /** "alliance", "horde" -> emblem URL. */
  factions: Record<string, string>;
}

export const NO_ICONS: WorkspaceIcons = { classes: {}, professions: {}, factions: {} };

export function workspaceIcons(assets: SiteAssets | null): WorkspaceIcons {
  if (!assets) return NO_ICONS;
  const { classes, professions } = classAndProfessionIcons(assets);
  return {
    classes: Object.fromEntries(classes.map((c) => [c.key, c.icon])),
    professions: Object.fromEntries(professions.map((p) => [p.key, p.icon])),
    factions: Object.fromEntries([...emblems(assets).factions].map(([name, icon]) => [name.toLowerCase(), icon])),
  };
}
