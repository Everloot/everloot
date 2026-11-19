import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container, Input, PageHeader } from "@/components/ui";
import { ARMORY_RECHECK_DAYS, armoryOn } from "@/lib/armory";
import { GUILD_DIRECTORY_PATH, GUILD_SUBMIT_PATH } from "@/lib/armory-guilds";
import { armoryStore } from "@/lib/armory-store";
import { trailFor } from "@/lib/breadcrumbs";
import { ArmoryCredit, armoryMetadata, first, FormUnreachable, link, newest, NOT_FOUND_METADATA } from "../../parts";
import GuildSearch from "../guild-search";

export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata {
  if (!armoryOn()) return NOT_FOUND_METADATA;
  return armoryMetadata({ title: "Add a guild to the armory", description: "Ask Everloot to read a WoW: Forever guild and its roster from Blizzard's API.", path: GUILD_SUBMIT_PATH });
}

const ERROR: Record<string, string> = {
  invalid: "Check the region and guild name: up to 64 letters or digits, with spaces or hyphens between words.",
  limit: "Too many requests from this connection. Try again in an hour.",
  storage: "We could not save that. Try again in a moment.",
};
type Search = Record<string, string | string[] | undefined>;

export default async function GuildSubmitPage(props: { searchParams: Promise<Search> }) {
  if (!armoryOn()) notFound();
  const params = await props.searchParams;
  const done = first(params.done), error = first(params.error);
  const counts = await armoryStore().counts().catch(() => null);
  return (
    <Container width="reading">
      <article className="max-w-xl space-y-6">
        <GuildSearch />
        <PageHeader
          trail={[...trailFor(GUILD_DIRECTORY_PATH)!, { name: "Add a guild", path: GUILD_SUBMIT_PATH }]}
          title="Add a guild"
          lede="Enter your guild's region and name, and Everloot asks Blizzard's API for its roster on the next run, usually within a few hours. If Blizzard does not know the guild, nothing is added. Roster members are then queued for their own reads."
        />
        {done === "1" && <p role="status" className="rounded-card border border-line bg-panel p-4 text-fg">The guild is queued. Its page appears or updates once it has been read; members follow as the queue is read.</p>}
        {done === "0" && <p role="status" className="rounded-card border border-line bg-panel p-4 text-fg">Nothing to add: that guild is queued already or was read in the last {ARMORY_RECHECK_DAYS} days.</p>}
        {counts === null && <FormUnreachable />}
        {error && <p role="alert" className="rounded-card border border-line bg-panel p-4 text-fg">{ERROR[error] ?? ERROR.invalid}</p>}
        <form action={`${GUILD_SUBMIT_PATH}/send`} method="post" className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="guild-region" className="text-sm text-fg">Region</label>
            <select id="guild-region" name="region" required defaultValue={first(params.region) === "us" ? "us" : "eu"} className="w-full min-h-11 rounded-control border border-edge bg-canvas px-3 text-fg">
              <option value="eu">Europe (EU)</option><option value="us">Americas (US)</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="guild-name" className="text-sm text-fg">Guild name</label>
            <Input id="guild-name" name="name" required maxLength={64} defaultValue={first(params.name)} autoComplete="off" />
          </div>
          <button type="submit" className="btn btn-primary min-h-11">Ask for a guild read</button>
        </form>
        <p className="text-sm text-muted"><Link href={GUILD_DIRECTORY_PATH} className={link}>Back to guilds</Link></p>
        <ArmoryCredit at={counts ? newest(counts.map((c) => c.newest)) : null} />
      </article>
    </Container>
  );
}
