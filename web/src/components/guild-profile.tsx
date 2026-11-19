import Link from "next/link";
import { Badge } from "@/components/ui";
import { armoryGuildPath } from "@/lib/armory";
import type { ArmoryGuild } from "@/lib/armory-store";
import { getUser } from "@/lib/supabase/server";
import { guildProfileStore } from "@/lib/guild-profile-store";
import { staleClaim } from "@/lib/guild-profile";
import GuildCrest from "./guild-crest";

export default async function GuildProfile({ guild }: { guild: ArmoryGuild }) {
  const user = await getUser().catch(() => null);
  const edit = user && <Link href={`${armoryGuildPath(guild.region, guild.slug)}/edit`} className="text-sm text-fg underline underline-offset-4">Claim or edit this guild</Link>;
  try {
    const store = guildProfileStore();
    const profile = await store.profile(guild.region, guild.slug);
    const access = profile?.owner_user_id ? await store.access(user?.id ?? "00000000-0000-0000-0000-000000000000", guild.region, guild.slug) : null;
    const crest = await GuildCrest({ crest: guild.crest, region: guild.region });
    return <section aria-label="Guild profile" className="space-y-3">
      {crest}
      {profile?.recruiting.on && <Badge tone="neutral">Recruiting</Badge>}
      {profile?.bio && <p className="whitespace-pre-wrap text-sm text-fg-2">{profile.bio}</p>}
      {profile?.details.raidDays && <p className="text-sm">Raid days: {profile.details.raidDays}</p>}
      {([ ["Discord", profile?.details.discord], ["Website", profile?.details.website] ] as const).map(([label, url]) => url && <p key={label}><Link href={url} rel="nofollow ugc noopener noreferrer" className="text-fg underline underline-offset-4">{label}</Link></p>)}
      {profile?.recruiting.on && <div className="space-y-1 text-sm">
        {profile.recruiting.lookingFor && <p className="whitespace-pre-wrap">Looking for: {profile.recruiting.lookingFor}</p>}
        {profile.recruiting.classes.length > 0 && <p>Classes wanted: {profile.recruiting.classes.join(", ")}</p>}
      </div>}
      {access?.stale && <p className="text-sm text-muted">{staleClaim}</p>}
      {edit}
    </section>;
  } catch {
    return <section aria-label="Guild profile" className="space-y-3"><p className="text-sm text-muted">Guild profile is unavailable right now.</p>{edit}</section>;
  }
}
