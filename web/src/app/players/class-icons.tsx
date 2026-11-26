import { CENSUS_CLASSES } from "@kb/census";
import { classAndProfessionIcons, type SiteAssets } from "@/lib/game-assets";

/**
 * Class icons for the directories' long lists. Each row draws a 16 px `<i class="ci ci-mage">`; the picture is one
 * rule per class in a single style block, so a 50-row page names each icon file once instead of fifty times.
 * Without the asset folder, or for a class whose icon address is not a plain https URL, no icon is drawn and the
 * name keeps its class colour alone.
 */
export type ClassIcons = ReadonlyMap<string, string>;

/** Only a plain https address goes into the style block: nothing that could close the url(), the rule or the tag. */
const SAFE_URL = /^https:\/\/[^\s"'()<>\\;{}]+$/;

/** Class slug ("mage") -> icon URL, for the classes the asset folder has. */
export function classIcons(assets: SiteAssets | null): ClassIcons {
  return new Map(classAndProfessionIcons(assets).classes.filter((c) => SAFE_URL.test(c.icon)).map((c) => [c.key, c.icon]));
}

export function ClassIconStyle({ icons }: { icons: ClassIcons }) {
  if (icons.size === 0) return null;
  const css = [...icons].map(([slug, url]) => `.ci-${slug}{background-image:url("${url}")}`).join("");
  return <style>{css}</style>;
}

const NAME = new Map<string, string>(CENSUS_CLASSES.map((c) => [c.token.toLowerCase(), c.name]));

/** The icon before a name; it says the class to a screen reader and on hover, since the colour alone cannot. */
export function ClassMark({ token, icons }: { token: string; icons: ClassIcons }) {
  const slug = token.toLowerCase();
  if (!icons.has(slug)) return null;
  const name = NAME.get(slug) ?? token;
  return <i className={`ci ci-${slug}`} role="img" aria-label={name} title={name} />;
}
