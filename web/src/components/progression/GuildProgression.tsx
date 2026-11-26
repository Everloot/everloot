import { Disclosure, Facts, SectionHeading } from "@/components/ui";
import { loadGuildProgression, type ProgressionMember } from "@/lib/progression";
import ProgressionMatrix from "./ProgressionMatrix";

/** Instances with a counted kill are listed; the ones without fold behind one closed disclosure. */
export default async function GuildProgression({ members, region }: { members: readonly Omit<ProgressionMember, "region">[]; region: string }) {
  const progress = await loadGuildProgression(members.map((m) => ({ ...m, region })));
  const killed = progress.instances.filter((r) => r.state !== "none");
  const none = progress.instances.filter((r) => r.state === "none");
  return <section aria-labelledby="guild-progression" className="space-y-4">
    <SectionHeading id="guild-progression">Progression</SectionHeading>
    <Facts items={[{ label: "Guild progression score", value: progress.score.toLocaleString("en-US"), numeric: true }]} />
    <p className="text-sm text-fg-2">Each counted boss earns the group size in points; a clear adds the boss count times that size. Only instances observed open score. Synced kills from every roster member count: five members for a dungeon, the raid size for a raid, and forty for a world boss.</p>
    {killed.length === 0 && <p className="text-sm text-fg-2">No roster member has a synced kill yet.</p>}
    <ProgressionMatrix instances={killed} links={progress.links} guild />
    {none.length > 0 && <Disclosure summary={`${none.length} ${none.length === 1 ? "instance" : "instances"} with no kills yet`} wide>
      <ProgressionMatrix instances={none} links={progress.links} guild notes={false} />
    </Disclosure>}
  </section>;
}
