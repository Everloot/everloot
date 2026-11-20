import { z } from "zod";

export const GUILD_CLASSES = ["WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST", "SHAMAN", "MAGE", "WARLOCK", "DRUID"] as const;
const url = z.union([z.literal(""), z.string().max(500).url().refine((s) => {
  const u = new URL(s);
  return u.protocol === "https:" && !u.username && !u.password;
}, "Use an https:// URL without a username or password.")]);
export const GuildFields = z.object({
  bio: z.string().max(1000),
  details: z.object({ raidDays: z.string().max(200), discord: url, website: url }).strict(),
  recruiting: z.object({ on: z.boolean(), lookingFor: z.string().max(200), classes: z.array(z.enum(GUILD_CLASSES)).max(9) }).strict(),
}).strict();
export type GuildFields = z.infer<typeof GuildFields>;
export const EMPTY_GUILD_FIELDS: GuildFields = { bio: "", details: { raidDays: "", discord: "", website: "" }, recruiting: { on: false, lookingFor: "", classes: [] } };
export interface GuildProfile extends GuildFields {
  region: string; slug: string; owner_user_id: string | null; owner_character_slug: string | null;
  updated_at: string; updated_by: string;
}
export interface GuildAccess {
  owner: boolean; editor: boolean; eligible: boolean; stale: boolean;
  members: { user_id: string; character_slug: string; name: string; rank: number }[];
  editors: string[];
}
export const cannotEdit = "Only a linked Guild Master can claim this guild. The Guild Master appoints editors from linked guild members.";
export const staleClaim = "The claimed Guild Master is no longer linked at rank 0 on the stored roster. Editing is paused until the current Guild Master claims the guild.";
