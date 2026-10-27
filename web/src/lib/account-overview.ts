import type { ShellCharacter } from "./account-shell-types";
import { readProfile, toShell } from "./account-shell";
import { keyLive, keySummary, type KeyRow } from "./api-keys";
import { guardOn } from "./data-guard";
import { DESKTOP_KEY_LABEL } from "./desktop-connect";
import { profilesOn } from "./profiles";
import { CHARACTER_COLUMNS, savedBuildsOn, type CharacterRow } from "./saved-builds";
import { authQuery, type AccountUser } from "./supabase/server";

/** The top of /account. A part is null when its switch is off, so the page leaves its rows out. */
export interface AccountOverview {
  /** ISO time the account was made; null for an old row without one. */
  memberSince: string | null;
  /** EVERLOOT_PROFILES. */
  profile: { handle: string | null; displayName: string; publicProfile: boolean; main: ShellCharacter | null } | null;
  /** EVERLOOT_PROFILES or EVERLOOT_SAVED_BUILDS: both read the same characters. */
  characters: number | null;
  /** EVERLOOT_SAVED_BUILDS. */
  builds: number | null;
  /**
   * EVERLOOT_DATA_GUARD. `live`: keys not revoked or expired, and `liveKeys` those keys, newest first (Integrations).
   * `desktop`: a live key made by the Desktop App's connect page.
   */
  keys: { live: number; requests: number; desktop: boolean; liveKeys: KeyRow[] } | null;
}

/** Every read is filtered by the signed-in user's id, with the service role, on the server. */
export async function loadOverview(user: AccountUser, env: Record<string, string | undefined> = process.env): Promise<AccountOverview> {
  const id = encodeURIComponent(user.id);
  const profiles = profilesOn(env);
  const builds = savedBuildsOn(env);
  const [created, characters, buildRows, profileRow, keys] = await Promise.all([
    authQuery<Array<{ created_at: string | null }>>(`users?select=created_at&id=eq.${id}&limit=1`),
    profiles || builds ? authQuery<CharacterRow[]>(`build_characters?select=${CHARACTER_COLUMNS}&user_id=eq.${id}`) : null,
    builds ? authQuery<Array<{ id: string }>>(`saved_builds?select=id&user_id=eq.${id}`) : null,
    profiles ? readProfile(user.id) : null,
    guardOn(env) ? keySummary(user.id) : null,
  ]);
  const shell = profiles ? toShell(user, profileRow, characters ?? []) : null;
  const liveKeys = keys ? keys.keys.filter((k) => keyLive(k)) : [];
  return {
    memberSince: created[0]?.created_at ?? null,
    profile: shell && {
      handle: shell.handle,
      displayName: shell.displayName,
      publicProfile: shell.publicProfile,
      main: shell.characters.find((c) => c.id === shell.mainCharacterId) ?? null,
    },
    characters: characters && characters.length,
    builds: buildRows && buildRows.length,
    keys: keys && {
      live: liveKeys.length,
      requests: keys.requests,
      desktop: liveKeys.some((k) => k.label === DESKTOP_KEY_LABEL),
      liveKeys,
    },
  };
}
