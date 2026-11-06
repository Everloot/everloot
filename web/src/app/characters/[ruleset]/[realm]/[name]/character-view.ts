import { cache } from "react";
import { validPlayerName } from "@everloot/protocol";
import { factSections, withFacts, type FactSections } from "@/lib/character-facts";
import { loadFactNames } from "@/lib/character-facts-names";
import { publicCharacter, publicCharacterBuilds, type PlannedBuild, type PublicCharacter } from "@/lib/character-links-store";
import { buildShowcase, characterPath, showcaseBuildsOn, showcaseOn, type Showcase } from "@/lib/character-showcase";
import { renderCharacterCard, type CharacterCardSize } from "@/lib/og-card";
import { playerPagesOn, type Player } from "@/lib/player-pages";
import { playerStore } from "@/lib/player-store";
import { privateSyncOn } from "@/lib/private-sync";
import { publicCharacterFacts } from "@/lib/private-sync-store";

/**
 * A character's one page reads up to two rows, each from its own source: the owner's showcase from
 * `public_character` (identity only in this slice, showcase plan S3) and, with the player pages on, what the addon
 * last saw from the players table. The cards read the showcase only. No showcase row (not linked, frozen, hidden,
 * or the page switched off) is a 404 for both cards. Nothing is cached: an owner's switch off or a hide must not
 * leave a warm copy anywhere.
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

/**
 * The sections the owner synced and switched on (showcase plan S6), read only with EVERLOOT_PRIVATE_SYNC=1 and only
 * once the character itself was found. `public_character_facts` asks everything `public_character` asks, and of the
 * facts returns only the categories whose switch is on and whose sync is still consented, so a section switched off is
 * gone on the next request. A failed read leaves the sections out rather than taking the page down.
 */
export async function publishedFacts({ ruleset, character: c }: Found, now = new Date()): Promise<FactSections> {
  if (!privateSyncOn()) return {};
  try {
    const facts = await publicCharacterFacts(ruleset, c.realm, c.name);
    return facts.length ? factSections(facts, await loadFactNames(facts, c.class), now) : {};
  } catch {
    return {};
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
 * What the addon last saw of the character (the players table), null for none or with the player pages off, or
 * "unavailable" when storage could not answer; never a throw. A hidden character has no row (`suppress_player`
 * deletes it and `get_player` skips it). Read apart from the showcase, and never joined to it.
 */
export const sighting = cache(async (ruleset: string, realm: string, name: string): Promise<Player | null | "unavailable"> => {
  if (!playerPagesOn()) return null;
  const parts = parse({ ruleset, realm, name });
  if (!parts) return null;
  try {
    return await playerStore().get(parts.ruleset, parts.realm, parts.name);
  } catch {
    return "unavailable";
  }
});

/** Both parts of the page, each from its own source and behind its own switch; the showcase is not read with its switch off. */
export async function characterParts(p: Params): Promise<{ showcase: Found | null | "unavailable"; seen: Player | null | "unavailable" }> {
  const [showcase, seen] = await Promise.all([
    showcaseOn() ? lookup(p.ruleset, p.realm, p.name) : null,
    sighting(p.ruleset, p.realm, p.name),
  ]);
  return { showcase, seen };
}

/**
 * The showcase for a found character. The identity comes from the link row and its date is the link's last upload.
 * Talents show the planned builds when there are any, dated by the newest. Stats are `unsupported` (no collector
 * records them). The owner's published sections, when any, fill the rest (`withFacts`); a section with nothing
 * published stays `empty`, so the public page and card leave it out.
 */
export function characterShowcase({ ruleset, character: c }: Found, now: Date, planned: readonly PlannedBuild[] = [], facts: FactSections = {}): Showcase {
  return buildShowcase(withFacts({
    sample: false,
    path: characterPath(ruleset, c.realm, c.name),
    name: c.name,
    level: c.level,
    race: c.race,
    class: c.class,
    faction: c.faction,
    realm: c.realm,
    title: null,
    guild: null,
    lastUpload: new Date(c.lastUploadAt).toISOString().slice(0, 10),
    gear: { state: "empty" },
    // No collector records the character sheet's numbers: one line saying so, never a row of zeros.
    stats: { state: "unsupported" },
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
  }, facts), now);
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
  const image = await renderCharacterCard(characterShowcase(found, now, [], await publishedFacts(found, now)), size);
  for (const [name, value] of Object.entries(HEADERS)) image.headers.set(name, value);
  return image;
}
