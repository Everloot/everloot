import { isArmoryRegion, slugFromSegment, validArmorySlug } from "@/lib/armory";

/** One side of a comparison: a stored character's region and slug, as `?a=eu/velkara-duskmantle` names it. */
export interface Side { region: string; slug: string }

/** "eu/velkara-duskmantle" (the slug may arrive percent-encoded) as a side; null when it is not one. */
export function compareSide(raw: string | undefined): Side | null {
  const [region, segment, ...rest] = (raw ?? "").split("/");
  if (rest.length > 0 || !region || !segment || !isArmoryRegion(region)) return null;
  const slug = slugFromSegment(segment);
  return slug !== null && validArmorySlug(slug) ? { region, slug } : null;
}

/** The compare page for one side, or for two. */
export function compareHref(a: Side, b?: Side): string {
  const q = new URLSearchParams({ a: `${a.region}/${a.slug}` });
  if (b) q.set("b", `${b.region}/${b.slug}`);
  return `/armory/compare?${q}`;
}
