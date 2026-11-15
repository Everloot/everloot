import { pageMetadata } from "./seo";
import { REFERENCE_GUIDES_PUBLISHED } from "./reference-guide-status";
export { REFERENCE_GUIDES_PUBLISHED } from "./reference-guide-status";

export const REFERENCE_GUIDES = [
  { slug: "glossary", title: "WoW glossary", summary: "Plain definitions for WoW terms, with an A–Z index and a first-week checklist that you can save on this device as you learn." },
  { slug: "keybinds", title: "Keybinds by class", summary: "Explore a suggested keyboard layout for movement, interrupts, defensives and cooldowns, using abilities found in Everloot’s Forever spell data." },
  { slug: "macros", title: "Starter macros", summary: "Learn how macro commands reach the Forever client, see what is verified in its UI code, and copy a single-spell starter for your class." },
  { slug: "stats", title: "Character stats", summary: "Read what primary attributes and combat stats represent in Forever’s character panel, with sources and no unsourced specialization priorities." },
  { slug: "pvp", title: "PvP: honor, ranks and battlegrounds", summary: "Understand Blizzard’s announced Honor and Rank Point systems, seasonal tasks and Darkspear Islands, with links to the original announcements." },
  { slug: "raid-prep", title: "Raid preparation", summary: "Save a raid preparation checklist on this device: attunement evidence, consumable recipe outputs and resistance checks, with database links." },
] as const;
export type ReferenceSlug = typeof REFERENCE_GUIDES[number]["slug"];
export const referenceHref = (slug: ReferenceSlug) => `/guides/${slug}`;
export const publicReferenceGuides = () => REFERENCE_GUIDES_PUBLISHED ? [...REFERENCE_GUIDES] : [];
export function referenceMetadata(slug: ReferenceSlug) {
  const guide = REFERENCE_GUIDES.find((g) => g.slug === slug)!;
  return { ...pageMetadata({ title: `${guide.title} · WoW Forever`, description: guide.summary, path: referenceHref(slug) }), robots: { index: REFERENCE_GUIDES_PUBLISHED, follow: true } };
}
