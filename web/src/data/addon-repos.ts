// Where an addon's author publishes it, by the addon's folder name as the AddOns list shows it.
// Checked by hand: add an addon only after reading its repository and confirming it is the same
// addon players run on Forever. The links are the author's own pages; Everloot reads GitHub's public
// API for `repo` and nothing from the other hosts, which are plain links.
// Reading `## X-Website` from the .toc through the addon-list opt-in would replace this map, but it
// needs an addon release first.
import registryFile from "../../../kb/curated/ecosystem.json";
import { parseRegistry } from "../../../kb/src/ecosystem";

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

/** The ecosystem registry (kb/curated/ecosystem.json): projects a maintainer checked by hand, with their folder names. */
const REGISTRY = parseRegistry(registryFile).projects;

/** Every approved folder name, each spelled once: the curated map's spelling first, then the registry's. */
export function approvedAddonNames(): string[] {
  const names = Object.keys(ADDON_SOURCES);
  for (const name of REGISTRY.flatMap((p) => p.addonNames)) {
    if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  return names;
}

/** An addon the owner approved: the only kind that gets a public catalog page, title and source on this site. */
export interface ApprovedAddon {
  /** The folder name as the owner spelled it. */
  name: string;
  /** The title the site shows, never one an upload reports. */
  title: string;
  /** Where the author publishes it. */
  source: AddonSource;
}

/**
 * The owner-approved entry for a folder name, ignoring case, or null. Approved means named in the curated source map
 * (addon-repos.ts) or by a project in the ecosystem registry; both are edited by hand in this repository, so a
 * release changes the set and an upload never does. The curated map's links win, since they carry the author's
 * download pages; a registry project supplies its repository. Install counts (a live, anonymous aggregate) are
 * joined to an approved entry by the page and never decide what is approved, how it is titled or where it is published.
 */
export function approvedAddon(name: string): ApprovedAddon | null {
  const wanted = name.toLowerCase();
  const project = REGISTRY.find((p) => p.addonNames.some((n) => n.toLowerCase() === wanted));
  const curated = curatedAddon(name);
  if (curated) return { name: curated.name, title: project?.name ?? curated.name, source: curated.source };
  const folder = project?.addonNames.find((n) => n.toLowerCase() === wanted);
  return project && folder ? { name: folder, title: project.name, source: { repo: project.repo } } : null;
}
