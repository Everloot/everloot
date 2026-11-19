import { authQuery } from "./supabase/server";
import { EMPTY_GUILD_FIELDS, GuildFields, type GuildAccess, type GuildProfile } from "./guild-profile";

type Write = "claim" | "release" | "appoint" | "remove";
type SaveResult = "saved" | "invalid" | "forbidden" | "limited";
type Query = <T>(path: string, init?: RequestInit) => Promise<T>;
export interface GuildProfileStore {
  profile(region: string, slug: string): Promise<GuildProfile | null>;
  recruiting(rows: { region: string; slug: string }[]): Promise<Set<string>>;
  access(user: string, region: string, slug: string): Promise<GuildAccess>;
  write(action: Write, user: string, region: string, slug: string, editor?: string): Promise<boolean>;
  save(user: string, region: string, slug: string, fields: GuildFields): Promise<SaveResult>;
}
const key = (region: string, slug: string) => `${region}/${slug}`;
export function createCloudGuildProfileStore(query: Query = authQuery): GuildProfileStore {
  const rpc = <T>(name: string, args: object) => query<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
  return {
    async profile(region, slug) {
      const rows = await query<GuildProfile[]>(`guild_profiles?region=eq.${encodeURIComponent(region)}&slug=eq.${encodeURIComponent(slug)}&limit=1`);
      return rows[0] ?? null;
    },
    async recruiting(rows) {
      const found = new Set<string>();
      // Only the current directory page, grouped by region; no unbounded profile scan or new directory RPC.
      for (const region of ["us", "eu"]) {
        const slugs = rows.filter((r) => r.region === region).map((r) => r.slug);
        if (!slugs.length) continue;
        const profiles = await query<{ region: string; slug: string }[]>(`guild_profiles?select=region,slug&region=eq.${region}&slug=in.(${slugs.map(encodeURIComponent).join(",")})&recruiting->>on=eq.true&limit=${slugs.length}`);
        profiles.forEach((p) => found.add(key(p.region, p.slug)));
      }
      return found;
    },
    access: (user, region, slug) => rpc("guild_profile_access", { p_user_id: user, p_region: region, p_slug: slug }),
    write(action, user, region, slug, editor) {
      const name = { claim: "claim_guild", release: "release_guild", appoint: "appoint_guild_editor", remove: "remove_guild_editor" }[action];
      return rpc(name, { p_user_id: user, p_region: region, p_slug: slug, ...(editor ? { p_editor_id: editor } : {}) });
    },
    async save(user, region, slug, fields) {
      const parsed = GuildFields.safeParse(fields);
      if (!parsed.success) return "invalid";
      return rpc("save_guild_profile", { p_user_id: user, p_region: region, p_slug: slug, p_bio: parsed.data.bio, p_details: parsed.data.details, p_recruiting: parsed.data.recruiting });
    },
  };
}

export function createMemoryGuildProfileStore(members: (region: string, slug: string) => GuildAccess["members"] = () => [], now = Date.now): GuildProfileStore {
  const profiles = new Map<string, GuildProfile>();
  const editors = new Map<string, Set<string>>();
  const saves = new Map<string, { count: number; reset: number }>();
  const access = async (user: string, region: string, slug: string): Promise<GuildAccess> => {
    const p = profiles.get(key(region, slug));
    const roster = members(region, slug);
    const valid = !!p?.owner_user_id && roster.some((m) => m.user_id === p.owner_user_id && m.character_slug === p.owner_character_slug && m.rank === 0);
    const owner = valid && p?.owner_user_id === user;
    return { owner, editor: valid && !!editors.get(key(region, slug))?.has(user) && roster.some((m) => m.user_id === user),
      eligible: roster.some((m) => m.user_id === user && m.rank === 0) && (!valid || owner), stale: !!p?.owner_user_id && !valid,
      members: owner ? roster.filter((m) => m.user_id !== user) : [], editors: owner ? [...(editors.get(key(region, slug)) ?? [])] : [] };
  };
  return {
    profile: async (region, slug) => structuredClone(profiles.get(key(region, slug)) ?? null),
    recruiting: async (rows) => new Set(rows.filter((r) => profiles.get(key(r.region, r.slug))?.recruiting.on).map((r) => key(r.region, r.slug))),
    access,
    async write(action, user, region, slug, editor) {
      const k = key(region, slug), a = await access(user, region, slug);
      let p = profiles.get(k);
      if (action === "claim") {
        if (!a.eligible || (p?.owner_user_id && !a.stale && !a.owner)) return false;
        if (a.owner) return true;
        p = { ...structuredClone(EMPTY_GUILD_FIELDS), ...p, region, slug, owner_user_id: user,
          owner_character_slug: members(region, slug).find((m) => m.user_id === user && m.rank === 0)!.character_slug,
          updated_at: new Date(now()).toISOString(), updated_by: user };
        profiles.set(k, p); editors.delete(k);
      } else {
        if (!a.owner || !p) return false;
        if (action === "release") { p.owner_user_id = null; p.owner_character_slug = null; editors.delete(k); }
        else if (action === "appoint") {
          if (!editor || editor === user || !a.members.some((m) => m.user_id === editor)) return false;
          const list = editors.get(k) ?? new Set<string>(); list.add(editor); editors.set(k, list);
        } else if (editor) editors.get(k)?.delete(editor);
      }
      p.updated_at = new Date(now()).toISOString(); p.updated_by = user;
      return true;
    },
    async save(user, region, slug, fields) {
      const a = await access(user, region, slug);
      if (!a.owner && !a.editor) return "forbidden";
      const parsed = GuildFields.safeParse(fields);
      if (!parsed.success) return "invalid";
      const bucket = saves.get(user);
      const next = !bucket || bucket.reset <= now() ? { count: 1, reset: now() + 3600000 } : { ...bucket, count: bucket.count + 1 };
      saves.set(user, next);
      if (next.count > 30) return "limited";
      Object.assign(profiles.get(key(region, slug))!, parsed.data, { updated_at: new Date(now()).toISOString(), updated_by: user });
      return "saved";
    },
  };
}
let memory: GuildProfileStore | undefined;
export function guildProfileStore(): GuildProfileStore {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return createCloudGuildProfileStore();
  if (process.env.NODE_ENV === "production") throw new Error("Guild profile storage is not configured");
  return memory ??= createMemoryGuildProfileStore();
}
