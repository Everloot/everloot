import { Facts, SectionHeading } from "@/components/ui";
import { loadGuildProgression, type ProgressionMember } from "@/lib/progression";
import ProgressionMatrix from "./ProgressionMatrix";

export default async function GuildProgression({ members, region }: { members: readonly Omit<ProgressionMember, "region">[]; region: string }) {
  const progress = await loadGuildProgression(members.map((m) => ({ ...m, region })));
  return <section aria-labelledby="guild-progression" className="space-y-4">
    <SectionHeading id="guild-progression">Progression</SectionHeading>
    <Facts items={[{ label: "Guild progression score", value: progress.score.toLocaleString("en-US"), numeric: true }]} />
    <p className="text-sm text-fg-2">Each counted boss earns the group size in points; a clear adds the boss count times that size. Only instances observed open score. Synced kills from every roster member count: five members for a dungeon, the raid size for a raid, and forty for a world boss.</p>
    <ProgressionMatrix instances={progress.instances} links={progress.links} guild />
  </section>;
}
