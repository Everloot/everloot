"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { armoryGuildPath, armoryOn, isArmoryRegion, validArmorySlug } from "@/lib/armory";
import { getUser } from "@/lib/supabase/server";
import { GuildFields } from "@/lib/guild-profile";
import { guildProfileStore } from "@/lib/guild-profile-store";
import { armoryStore } from "@/lib/armory-store";
import { playerStore } from "@/lib/player-store";
import { armoryGuildHidden } from "@/lib/armory-guilds";

export async function changeGuild(region: string, slug: string, form: FormData) {
  if (!armoryOn() || !isArmoryRegion(region) || !validArmorySlug(slug)) throw new Error("Guild unavailable");
  const user = await getUser();
  if (!user) throw new Error("Sign in to edit this guild");
  const guild = await armoryStore().guild(region, slug);
  if (!guild || armoryGuildHidden(await playerStore().hiddenGuilds(), region, guild.name)) throw new Error("Guild unavailable");
  const store = guildProfileStore();
  let result = "unavailable";
  try {
    const action = form.get("action");
    if (action === "save") {
      const parsed = GuildFields.safeParse({ bio: form.get("bio"), details: { raidDays: form.get("raidDays"), discord: form.get("discord"), website: form.get("website") },
        recruiting: { on: form.get("recruiting") === "on", lookingFor: form.get("lookingFor"), classes: form.getAll("classes") } });
      result = parsed.success ? await store.save(user.id, region, slug, parsed.data) : "invalid";
    } else if (action === "claim" || action === "release" || action === "appoint" || action === "remove") {
      const editor = form.get("editor");
      if ((action === "appoint" || action === "remove") && (typeof editor !== "string" || !/^[0-9a-f-]{36}$/i.test(editor))) result = "invalid";
      else result = await store.write(action, user.id, region, slug, typeof editor === "string" ? editor : undefined) ? "saved" : "forbidden";
    }
  } catch { result = "unavailable"; }
  const path = armoryGuildPath(region, slug);
  revalidatePath(path); revalidatePath("/guilds");
  redirect(`${path}/edit?result=${result}`);
}
