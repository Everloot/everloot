import { planHash } from "./talents/import";
import { decodeBuild, decodeOrder } from "./talents/share";
import { TALENT_CLASSES, isTalentClass, type TalentClassSlug } from "./talents/catalogs";

/**
 * Saved talent builds (docs/design/specs/2026-10-20-saved-builds-design.md): a signed-in player's builds from
 * the calculator, filed under typed character labels, each with a short link. Off until EVERLOOT_SAVED_BUILDS=1;
 * with it unset there is no Save button and /me, /b/<slug> and /api/me/* answer 404.
 *
 * This file has no server imports, so the calculator can use the limits and checks too. The database checks the
 * same rules again (supabase/migrations/20261021150000_saved_builds.sql, and for spend orders
 * 20261027120000_saved_build_point_order.sql).
 */
export function savedBuildsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.EVERLOOT_SAVED_BUILDS === "1";
}

export const BUILDS_PER_ACCOUNT = 200;
export const CHARACTERS_PER_ACCOUNT = 30;
export const SAVES_PER_DAY = 300;
export const LIMITS = { name: 60, notes: 1000, code: 400, characterName: 24, realm: 32, note: 140 } as const;

export const CODE_PATTERN = /^EL1-[a-z]+-\d+-[0-9.]+-[A-Za-z0-9_-]+$/;
export const SLUG_PATTERN = /^[A-Za-z0-9]{8}$/;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const validId = (id: unknown): id is string => typeof id === "string" && ID_PATTERN.test(id);

/**
 * Sent with a write by a page that shows one account's builds (the calculator's Save): that account's id. The site
 * refuses the write with a 409 (ACCOUNT_MISMATCH, the code Chat uses too) when the session is another account. It is
 * only a check: the owner is always the session's account.
 */
export const EXPECTED_OWNER_HEADER = "x-everloot-expected-owner";
export const ACCOUNT_MISMATCH = "account_mismatch";

/** One saved build, as GET /api/me/builds returns it. `link` is the short link while sharing is on. */
export interface SavedBuild {
  id: string;
  slug: string;
  name: string;
  notes: string | null;
  classSlug: string;
  characterId: string | null;
  code: string;
  code2: string | null;
  gameBuild: string;
  shared: boolean;
  active: boolean;
  link: string | null;
  updatedAt: string;
  showName: boolean;
  /** Each set's spend order token, its maker in its letter (O1p- planned, O1g- generated); null when unknown. Absent
   *  from a key's read, which carries no orders. */
  order?: string | null;
  order2?: string | null;
}

/** A character label: typed by the player, not checked against the game. */
export interface BuildCharacter { id: string; name: string; classSlug: string; realm: string | null; note: string | null }

/** The body of GET /api/me/builds: builds newest first. */
export interface AccountBuilds { characters: BuildCharacter[]; builds: SavedBuild[] }

export interface BuildInput {
  id: string | null;
  name: string;
  notes: string | null;
  characterId: string | null;
  code: string;
  code2: string | null;
  /** Null keeps the stored value on an update. A new build is not active unless asked; whether it is shared and shows
   *  its owner's name it must say (save_build_plan refuses a new build without them). */
  shared: boolean | null;
  active: boolean | null;
  showName: boolean | null;
  /** Each set's spend order token, null for an unknown order. Left out, the stored one stays while its code stays the
   *  same and goes when the code changes. */
  order?: string | null;
  order2?: string | null;
}

export interface CharacterInput { id: string | null; name: string; classSlug: TalentClassSlug; realm: string | null; note: string | null }

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Characters as Postgres counts them, so a limit here is the limit there. */
const length = (s: string) => Array.from(s).length;

/** Plain text: control characters out (line breaks kept where allowed), trimmed. */
function clean(value: unknown, multiline = false): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const stripped = multiline ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "") : value.replace(/[\u0000-\u001f\u007f]/g, "");
  return stripped.trim();
}

function optionalBoolean(value: unknown): boolean | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === "boolean" ? value : undefined;
}

/** The class of a share code that is shaped right, decodes and names a calculator class; null otherwise. */
export function codeClass(code: string): TalentClassSlug | null {
  if (length(code) > LIMITS.code || !CODE_PATTERN.test(code)) return null;
  const decoded = decodeBuild(code);
  if (!decoded.ok || !/^\d+(?:\.\d+)*$/.test(decoded.build.build)) return null;
  return isTalentClass(decoded.build.classSlug) ? decoded.build.classSlug : null;
}

/** A set's spend order (docs/2026-10-17-talent-share-code.md, "Spend order"), read against that set's own code: the
 *  token as sent, trimmed; null for none; false when it does not name exactly the code's points. */
function readOrder(value: unknown, code: string | null): string | null | false {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || code === null) return false;
  const decoded = decodeBuild(code);
  const token = value.trim();
  return decoded.ok && decodeOrder(token, decoded.build.ranks).ok ? token : false;
}

/** The body of POST /api/me/builds. */
export function parseBuildInput(body: unknown): Parsed<BuildInput> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const id = b.id ?? null;
  if (id !== null && !validId(id)) return { ok: false, error: "That build id is not valid." };
  const name = clean(b.name);
  if (!name || length(name) > LIMITS.name) return { ok: false, error: `Give the build a name of 1 to ${LIMITS.name} characters.` };
  const notes = clean(b.notes, true);
  if (notes === null || length(notes) > LIMITS.notes) return { ok: false, error: `Notes can be up to ${LIMITS.notes.toLocaleString("en-US")} characters.` };
  const characterId = b.characterId ?? null;
  if (characterId !== null && !validId(characterId)) return { ok: false, error: "That character id is not valid." };
  if (typeof b.code !== "string") return { ok: false, error: "A build needs a share code." };
  const code = b.code.trim();
  const cls = codeClass(code);
  if (!cls) return { ok: false, error: "That share code is not valid." };
  let code2: string | null = null;
  if (b.code2 !== undefined && b.code2 !== null && b.code2 !== "") {
    if (typeof b.code2 !== "string") return { ok: false, error: "The second share code is not valid." };
    code2 = b.code2.trim();
    const cls2 = codeClass(code2);
    if (!cls2) return { ok: false, error: "The second share code is not valid." };
    if (cls2 !== cls) return { ok: false, error: "Both talent sets must be for the same class." };
  }
  const shared = optionalBoolean(b.shared);
  const active = optionalBoolean(b.active);
  const showName = optionalBoolean(b.showName);
  if (shared === undefined || active === undefined || showName === undefined) return { ok: false, error: "shared, active and showName are true or false." };
  // A body from before orders has none: they stay left out, which is not the same as unknown.
  const order = b.order === undefined ? undefined : readOrder(b.order, code);
  if (order === false) return { ok: false, error: "The spend order does not fit the talents in the share code." };
  const order2 = b.order2 === undefined ? undefined : readOrder(b.order2, code2);
  if (order2 === false) return { ok: false, error: "The second spend order does not fit the talents in the second share code." };
  return { ok: true, value: { id, name, notes: notes || null, characterId, code, code2, shared, active, showName, order, order2 } };
}

/** The body of POST /api/me/characters. */
export function parseCharacterInput(body: unknown): Parsed<CharacterInput> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const id = b.id ?? null;
  if (id !== null && !validId(id)) return { ok: false, error: "That character id is not valid." };
  const name = clean(b.name);
  if (!name || length(name) > LIMITS.characterName) return { ok: false, error: `Give the character a name of 1 to ${LIMITS.characterName} characters.` };
  if (typeof b.classSlug !== "string" || !isTalentClass(b.classSlug)) return { ok: false, error: `Pick a class: ${TALENT_CLASSES.join(", ")}.` };
  const realm = clean(b.realm);
  if (realm === null || length(realm) > LIMITS.realm) return { ok: false, error: `A realm can be up to ${LIMITS.realm} characters.` };
  const note = clean(b.note);
  if (note === null || length(note) > LIMITS.note) return { ok: false, error: `A note can be up to ${LIMITS.note} characters.` };
  return { ok: true, value: { id, name, classSlug: b.classSlug, realm: realm || null, note: note || null } };
}

/** A build row as the database returns it, from a table read or from own_builds_for_key. Only a table read that asks
 *  for ORDER_COLUMNS has the orders. */
export interface BuildRow {
  id: string; slug: string; name: string; notes: string | null; class_slug: string; character_id: string | null;
  code: string; code2: string | null; game_build: string; shared: boolean; show_name: boolean; active: boolean; updated_at: string;
  point_order?: string | null; point_order2?: string | null;
}
export interface CharacterRow { id: string; name: string; class_slug: string; realm: string | null; note: string | null }

/** The columns of the saved-builds file; the spend orders are 20261027120000_saved_build_point_order.sql's. */
export const BUILD_COLUMNS = "id,slug,name,notes,class_slug,character_id,code,code2,game_build,shared,show_name,active,updated_at";
export const ORDER_COLUMNS = "point_order,point_order2";
export const CHARACTER_COLUMNS = "id,name,class_slug,realm,note";

export const shortPath = (slug: string) => `/b/${slug}`;

// The my_builds tool (Chat and MCP). Name, line and refusal sit here so the chat page can offer the tool too;
// the tool itself is web/src/lib/my-builds-tool.ts.
export const MY_BUILDS = "my_builds";
export const MY_BUILDS_LINE = "Your saved talent builds on Everloot: with no slug the list, with a build's slug its talents.";
export const MY_BUILDS_REFUSAL = "Sign in or use a key that can read your saved builds.";

export function toBuild(row: BuildRow, site: string): SavedBuild {
  return {
    id: row.id, slug: row.slug, name: row.name, notes: row.notes, classSlug: row.class_slug, characterId: row.character_id,
    code: row.code, code2: row.code2, gameBuild: row.game_build, shared: row.shared, active: row.active,
    link: row.shared ? `${site}${shortPath(row.slug)}` : null, updatedAt: new Date(row.updated_at).toISOString(), showName: row.show_name,
    // A key's read has no orders to give: they are left out rather than called unknown.
    ...(row.point_order === undefined ? {} : { order: row.point_order, order2: row.point_order2 ?? null }),
  };
}

export function toCharacter(row: CharacterRow): BuildCharacter {
  return { id: row.id, name: row.name, classSlug: row.class_slug, realm: row.realm, note: row.note };
}

/** Characters in one order whichever way they were read (session or key): by lower-case name, then id. */
export function toCharacters(rows: CharacterRow[]): BuildCharacter[] {
  const key = (c: BuildCharacter) => [c.name.toLowerCase(), c.id] as const;
  return rows.map(toCharacter).sort((a, b) => {
    const [an, ai] = key(a);
    const [bn, bi] = key(b);
    return an < bn ? -1 : an > bn ? 1 : ai < bi ? -1 : ai > bi ? 1 : 0;
  });
}

/** Where the calculator opens a saved build: its class page, marked as editing it, with both sets and their spend
 *  orders in the address. */
export function editPath(build: Pick<SavedBuild, "id" | "classSlug" | "code" | "code2" | "order" | "order2">): string {
  return `/tools/talents/${build.classSlug}?saved=${build.id}${planHash(build.code, build.code2, build.order, build.order2)}`;
}
