import { Disclosure, Facts, SectionHeading } from "@/components/ui";
import { RAIDS_OPEN_DAY, raidsOpen } from "@/lib/guilds";
import { loadGuildProgression, type ProgressionMember } from "@/lib/progression";
import ProgressionMatrix from "./ProgressionMatrix";

const LADDER_START = `Ladders start ${new Date(`${RAIDS_OPEN_DAY}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}`;

/** Instances with a counted kill are listed; the ones without fold behind one closed disclosure. */
/** `progress`: the read when the page started it already (beside its other reads); else this reads it. */
export default async function GuildProgression({ members, region, progress: started }: {
  members: readonly Omit<ProgressionMember, "region">[]; region: string; progress?: ReturnType<typeof loadGuildProgression>;
}) {
  const progress = await (started ?? loadGuildProgression(members.map((m) => ({ ...m, region }))));
  const killed = progress.instances.filter((r) => r.state !== "none");
  const none = progress.instances.filter((r) => r.state === "none");
  return <section aria-labelledby="guild-progression" className="space-y-4">
    <SectionHeading id="guild-progression">Progression</SectionHeading>
    {/* Before ladders open a 0 reads as a verdict; the day they start says more. */}
    {progress.score === 0 && !raidsOpen()
      ? <p className="text-cell text-fg">{LADDER_START}</p>
      : <Facts items={[{ label: "Guild progression score", value: progress.score.toLocaleString("en-US"), numeric: true }]} />}
    <p className="text-sm text-fg-2">Each counted boss earns the group size in points; a clear adds the boss count times that size. Only instances observed open score. Synced kills from every roster member count: five members for a dungeon, the raid size for a raid, and forty for a world boss.</p>
    {killed.length === 0 && <p className="text-sm text-fg-2">No roster member has a synced kill yet.</p>}
    <ProgressionMatrix instances={killed} links={progress.links} guild />
    {none.length > 0 && <Disclosure summary={`${none.length} ${none.length === 1 ? "instance" : "instances"} with no kills yet`} wide>
      <ProgressionMatrix instances={none} links={progress.links} guild notes={false} />
    </Disclosure>}
  </section>;
}
