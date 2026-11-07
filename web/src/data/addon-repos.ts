// Where an addon's author publishes it, by the addon's folder name as the AddOns list shows it.
// Checked by hand: add an addon only after reading its repository and confirming it is the same
// addon players run on Forever. The links are the author's own pages; Everloot reads GitHub's public
// API for `repo` and nothing from the other hosts, which are plain links.
// Reading `## X-Website` from the .toc through the addon-list opt-in would replace this map, but it
// needs an addon release first.

export interface AddonSource {
  /** GitHub "owner/name". */
  repo: string;
  curseforge?: string;
  wago?: string;
  wowinterface?: string;
}

export const ADDON_SOURCES: Readonly<Record<string, AddonSource>> = {
  Polestar: { repo: "fitzforge/polestar", curseforge: "https://www.curseforge.com/wow/addons/polestar-guides" },
};

/** The curated entry for a folder name, ignoring case, with the name as the map spells it. */
export function curatedAddon(name: string): { name: string; source: AddonSource } | null {
  const wanted = name.toLowerCase();
  const key = Object.keys(ADDON_SOURCES).find((k) => k.toLowerCase() === wanted);
  return key ? { name: key, source: ADDON_SOURCES[key] } : null;
}

/**
 * The name the site shows for an addon: the owner-approved spelling when the folder is curated, else the name
 * the installs report. A live report can never replace the curated one, so an unapproved upload cannot stand in
 * for a verified addon's page or take its source link. Null when neither names it.
 */
export function canonicalAddonName(typed: string, live: string | null): string | null {
  return curatedAddon(typed)?.name ?? live;
}
