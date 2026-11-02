import { cache } from "react";
import { validPlayerName } from "@everloot/protocol";
import { publicCharacter, publicCharacterBuilds, type PlannedBuild, type PublicCharacter } from "@/lib/character-links-store";
import { buildShowcase, characterPath, showcaseBuildsOn, showcaseOn, type Showcase } from "@/lib/character-showcase";
import { renderCharacterCard, type CharacterCardSize } from "@/lib/og-card";

/**
 * A linked character's public page and card read one row, from `public_character`: identity only in this slice
 * (showcase plan, S3). No row (not linked, frozen, hidden, or the page switched off) is a 404 for the page and both
 * cards alike. Nothing is cached: an owner's switch off must not leave a warm copy anywhere.
 */

export type Params = { ruleset: string; realm: string; name: string };

const decode = (part: string) => { try { return decodeURIComponent(part); } catch { return ""; } };

/** The address parts worth asking about, as the player pages check them; anything else is a 404 without a request. */
function parse(p: Params): Params | null {
  const ruleset = decode(p.ruleset), realm = decode(p.realm), name = decode(p.name);
  if (!/^[a-z0-9-]{1,32}$/.test(ruleset)) return null;
  if (realm.length < 2 || realm.length > 40 || /\s/.test(realm)) return null;
  if (!validPlayerName(name)) return null;
  return { ruleset, realm, name };
}

export interface Found { ruleset: string; character: PublicCharacter }

/**
 * The planned builds for a found character (slice S4), read only with EVERLOOT_SHOWCASE_BUILDS=1 and only once the
 * character itself was found, so a 404 asks nothing more. A failed read leaves the section out rather than taking
 * the page down: the identity is still right without it.
 */
export async function plannedBuilds({ ruleset, character: c }: Found): Promise<PlannedBuild[]> {
  if (!showcaseBuildsOn()) return [];
  try {
    return await publicCharacterBuilds(ruleset, c.realm, c.name);
  } catch {
    return [];
  }
}

/** The character, null for a 404, or "unavailable" when storage could not answer; never a throw. Once per request. */
export const lookup = cache(async (ruleset: string, realm: string, name: string): Promise<Found | null | "unavailable"> => {
  const parts = parse({ ruleset, realm, name });
  if (!parts) return null;
  try {
    const character = await publicCharacter(parts.ruleset, parts.realm, parts.name);
    return character ? { ruleset: parts.ruleset, character } : null;
  } catch {
    return "unavailable";
  }
});

/**
 * The showcase for a found character. The identity comes from the link row and its date is the link's last upload.
 * Talents show the planned builds when there are any, dated by the newest; every other section is `empty` until the
 * sync slices land, so the public page and card leave them out.
 */
export function characterShowcase({ ruleset, character: c }: Found, now: Date, planned: readonly PlannedBuild[] = []): Showcase {
  return buildShowcase({
    sample: false,
    path: characterPath(ruleset, c.realm, c.name),
    name: c.name,
    level: c.level,
    race: c.race,
    class: c.class,
    faction: c.faction,
    realm: c.realm,
    guild: null,
    lastUpload: new Date(c.lastUploadAt).toISOString().slice(0, 10),
    gear: { state: "empty" },
    talents: planned.length
      ? {
        state: "shown",
        asOf: new Date(Math.max(...planned.map((b) => Date.parse(b.updatedAt)))).toISOString().slice(0, 10),
        data: { trees: [], code: null, planned: planned.map((b) => ({ name: b.name, slug: b.slug })) },
      }
      : { state: "empty" },
    professions: { state: "empty" },
    reputations: { state: "empty" },
    raids: { state: "empty" },
    collections: { state: "empty" },
  }, now);
}

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/** The card at either size, or the page's 404 (or 503 when storage could not answer). Never cached. */
export async function characterCard(params: Promise<Params>, size: CharacterCardSize): Promise<Response> {
  if (!showcaseOn()) return new Response("Not found", { status: 404, headers: HEADERS });
  const p = await params;
  const found = await lookup(p.ruleset, p.realm, p.name);
  if (found === "unavailable") return new Response("Unavailable", { status: 503, headers: HEADERS });
  if (!found) return new Response("Not found", { status: 404, headers: HEADERS });
  const now = new Date();
  const image = await renderCharacterCard(characterShowcase(found, now), size);
  for (const [name, value] of Object.entries(HEADERS)) image.headers.set(name, value);
  return image;
}
