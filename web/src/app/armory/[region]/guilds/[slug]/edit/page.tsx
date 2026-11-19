import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container, PageHeader } from "@/components/ui";
import { armoryGuildPath, armoryOn, isArmoryRegion, slugFromSegment, validArmorySlug } from "@/lib/armory";
import { armoryStore } from "@/lib/armory-store";
import { armoryGuildHidden } from "@/lib/armory-guilds";
import { playerStore } from "@/lib/player-store";
import { getUser } from "@/lib/supabase/server";
import { signInPath } from "@/lib/auth/return-to";
import { guildProfileStore } from "@/lib/guild-profile-store";
import { EMPTY_GUILD_FIELDS } from "@/lib/guild-profile";
import { GuildEditForm } from "./form";
import { changeGuild } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit guild", robots: { index: false, follow: false } };
const messages: Record<string, string> = { saved: "Saved.", invalid: "Check the field limits and use valid https:// links.", forbidden: "The stored roster no longer gives you permission to make this change.", limited: "Too many saves. Try again in an hour.", unavailable: "Guild profile is unavailable right now. Try again later." };

export default async function EditGuildPage({ params, searchParams }: { params: Promise<{ region: string; slug: string }>; searchParams: Promise<{ result?: string }> }) {
  const { region, slug: segment } = await params;
  const slug = slugFromSegment(segment);
  if (!armoryOn() || !isArmoryRegion(region) || !slug || !validArmorySlug(slug)) notFound();
  const g = await armoryStore().guild(region, slug);
  if (!g || armoryGuildHidden(await playerStore().hiddenGuilds(), region, g.name)) notFound();
  const path = `${armoryGuildPath(region, slug)}/edit`;
  const user = await getUser();
  let content;
  if (!user) content = <p className="text-sm">Sign in to claim or edit this guild. <Link className="text-fg underline underline-offset-4" href={signInPath(path)}>Sign in</Link></p>;
  else {
    try {
      const store = guildProfileStore();
      const [profile, access] = await Promise.all([store.profile(region, slug), store.access(user.id, region, slug)]);
      content = <GuildEditForm fields={profile ?? EMPTY_GUILD_FIELDS} access={access} action={changeGuild.bind(null, region, slug)} />;
    } catch { content = <p className="text-sm text-muted">Guild profile is unavailable right now. Try again later.</p>; }
  }
  const result = (await searchParams).result;
  return <Container width="reading"><div className="space-y-6"><PageHeader title={`Edit ${g.name}`} />
    <p className="text-sm text-muted">Banners come from the guild&apos;s in-game crest.</p>
    {result && messages[result] && <p role="status" className="text-sm">{messages[result]}</p>}{content}
    <Link href={armoryGuildPath(region, slug)} className="text-sm text-fg underline underline-offset-4">Back to guild</Link>
  </div></Container>;
}
