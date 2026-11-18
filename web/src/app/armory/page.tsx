import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import { Card, Container, DataTable, PageHeader, SectionHeading, type Column } from "@/components/ui";
import {
  ARMORY_BOARDS, ARMORY_HIDE_PATH, ARMORY_KEPT_DAYS, ARMORY_METRICS, ARMORY_PATH, ARMORY_SUBMIT_PATH, armoryBoardPath, armoryOn, regionLabel,
} from "@/lib/armory";
import { armoryStore, type ArmoryCount } from "@/lib/armory-store";
import { GUILD_DIRECTORY_PATH } from "@/lib/armory-guilds";
import { ArmoryCredit, armoryMetadata, first, link, newest, NOT_FOUND_METADATA, Unreachable } from "./parts";

// Dynamic, not revalidated: an old search address (?q=, ?guild=) is redirected on every request, and a page that 404s
// at build (switch off) would otherwise be kept as a static 404.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  if (!armoryOn()) return NOT_FOUND_METADATA;
  return armoryMetadata({
    title: "WoW Forever Armory",
    description: "Every WoW: Forever character and guild Everloot has read from Blizzard's API: level, gear, item level, honorable kills and guild rosters.",
    path: ARMORY_PATH,
  });
}

const number = (n: number) => n.toLocaleString("en-US");

const countColumns: Column<ArmoryCount>[] = [
  { key: "region", header: "Region", nowrap: true, cell: (c) => regionLabel(c.region) },
  { key: "ruleset", header: "Ruleset", cell: (c) => c.ruleset },
  { key: "characters", header: "Characters", numeric: true, cell: (c) => number(c.characters) },
  { key: "guilds", header: "Guilds", numeric: true, cell: (c) => number(c.guilds) },
];

export default async function ArmoryPage(props: { searchParams: Promise<{ q?: string | string[]; guild?: string | string[] }> }) {
  if (!armoryOn()) notFound();
  const params = await props.searchParams;
  // The searches moved: characters to /players, which lists the armory's and the addon's in one list, guilds to /guilds.
  const q = (first(params.q) ?? "").trim();
  const g = (first(params.guild) ?? "").trim();
  if (q) permanentRedirect(`/players?q=${encodeURIComponent(q)}`);
  if (g) permanentRedirect(`${GUILD_DIRECTORY_PATH}?q=${encodeURIComponent(g)}`);
  const counts = await armoryStore().counts().catch(() => null);

  return (
    <Container width="reading">
      <article className="space-y-8">
        <PageHeader
          trail={trailFor("/armory")!}
          title="Armory"
          lede="Every WoW: Forever character and guild Everloot has read from Blizzard's API: level, gear, item level, honorable kills and guild rosters. Each is read again within 20 days, and nothing is kept longer than 30 days after its last read."
          meta={<ArmoryCredit at={counts ? newest(counts.map((c) => c.newest)) : null} />}
        />

        <section aria-labelledby="armory-find" className="space-y-3">
          <SectionHeading id="armory-find">Find a character or a guild</SectionHeading>
          <p className="text-sm text-fg-2">
            Search characters on <Link href="/players" className={link}>Players</Link>, with the ones the Everloot addon has seen, and guilds
            on <Link href={GUILD_DIRECTORY_PATH} className={link}>Guilds</Link>.
          </p>
        </section>

        <section aria-labelledby="armory-boards" className="space-y-3">
          <SectionHeading id="armory-boards">Rankings</SectionHeading>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {ARMORY_METRICS.map((m) => <li key={m}><Link href={armoryBoardPath(m)} className={link}>{ARMORY_BOARDS[m].title}</Link></li>)}
            <li><Link href={GUILD_DIRECTORY_PATH} className={link}>Guilds</Link></li>
          </ul>
        </section>

        <section aria-labelledby="armory-counts" className="space-y-3">
          <SectionHeading id="armory-counts">Read so far</SectionHeading>
          {counts === null ? <Unreachable /> : counts.length === 0
            ? <p className="text-sm text-fg-2">Nothing has been read yet.</p>
            : <DataTable dense caption="Characters and guilds read, by region and ruleset" columns={countColumns} rows={counts} rowKey={(c) => `${c.region}/${c.rulesetId}`} />}
        </section>

        <Card className="space-y-2 text-sm text-fg-2">
          <p>
            Missing a character? <Link href={ARMORY_SUBMIT_PATH} className={link}>Add it</Link> and it is read within a few hours.
            Guild members are found from their guild&apos;s roster.
          </p>
          <p>
            Do not want your character here? <Link href={ARMORY_HIDE_PATH} className={link}>Hide it</Link>. No account is needed; it is
            deleted at once and not read again. Rows are kept {ARMORY_KEPT_DAYS} days at most after their last read. <Link href="/privacy#armory" className={link}>Privacy policy</Link>.
          </p>
        </Card>
      </article>
    </Container>
  );
}
