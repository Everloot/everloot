import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Container, DataTable, Input, PageHeader, SectionHeading, type Column } from "@/components/ui";
import {
  ARMORY_BOARDS, ARMORY_HIDE_PATH, ARMORY_KEPT_DAYS, ARMORY_METRICS, ARMORY_PATH, ARMORY_SUBMIT_PATH, armoryBoardPath, armoryCharacterPath,
  armoryGuildPath, armoryOn, classTokenOfName, regionLabel, SEARCH_RULE,
} from "@/lib/armory";
import { armoryStore, type ArmoryCount, type ArmoryGuildHit, type ArmoryHit } from "@/lib/armory-store";
import { classText } from "@/app/players/player-view";
import { ArmoryCredit, armoryMetadata, first, link, newest, NOT_FOUND_METADATA, Unreachable } from "./parts";

// Dynamic, not revalidated: the search reads ?q= and ?guild= on every request, and a page that 404s at build (switch
// off) would otherwise be kept as a static 404 with no search.
export const dynamic = "force-dynamic";

const SEARCH_LIMIT = 25;

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

const hitColumns: Column<ArmoryHit>[] = [
  { key: "name", header: "Character", cell: (h) => <Link href={armoryCharacterPath(h.region, h.slug)} className={`${link} font-medium`}>{h.name} {h.surname}</Link> },
  { key: "level", header: "Level", numeric: true, cell: (h) => h.level },
  { key: "class", header: "Class", nowrap: true, cell: (h) => <span className={classText(classTokenOfName(h.class))}>{h.class}</span> },
  { key: "race", header: "Race", nowrap: true, cell: (h) => h.race },
  { key: "guild", header: "Guild", cell: (h) => h.guildName ?? <span className="text-muted">None</span> },
  { key: "where", header: "Realm", nowrap: true, cell: (h) => `${regionLabel(h.region)} ${h.ruleset}` },
];

const guildColumns: Column<ArmoryGuildHit>[] = [
  { key: "name", header: "Guild", cell: (g) => <Link href={armoryGuildPath(g.region, g.slug)} className={`${link} font-medium`}>{g.name}</Link> },
  { key: "faction", header: "Faction", nowrap: true, cell: (g) => g.faction },
  { key: "members", header: "Members", numeric: true, cell: (g) => number(g.memberCount) },
  { key: "where", header: "Realm", nowrap: true, cell: (g) => `${regionLabel(g.region)} ${g.ruleset}` },
];

function SearchForm({ id, name, label, value }: { id: string; name: string; label: string; value: string }) {
  return (
    <form action={ARMORY_PATH} method="get" role="search" className="flex max-w-xl flex-col gap-2 sm:flex-row">
      <label htmlFor={id} className="sr-only">{label}</label>
      <Input id={id} name={name} type="search" defaultValue={value} maxLength={24} autoComplete="off" placeholder={`${label}, 2 letters or more`} className="flex-1" />
      <button type="submit" className="btn btn-primary min-h-11">Search</button>
    </form>
  );
}

/** What a search found, or why it found nothing. Never throws: a storage failure says so. */
async function results<T>(raw: string, find: (prefix: string) => Promise<T[]>): Promise<{ prefix: string; rows: T[] | "unreachable" } | "invalid" | null> {
  if (!raw) return null;
  const prefix = raw.normalize("NFC").toLowerCase();
  if (!SEARCH_RULE.test(prefix)) return "invalid";
  try { return { prefix, rows: await find(prefix) }; } catch { return { prefix, rows: "unreachable" }; }
}

export default async function ArmoryPage(props: { searchParams: Promise<{ q?: string | string[]; guild?: string | string[] }> }) {
  if (!armoryOn()) notFound();
  const params = await props.searchParams;
  const q = (first(params.q) ?? "").trim().slice(0, 24);
  const g = (first(params.guild) ?? "").trim().slice(0, 24);
  const store = armoryStore();
  const [counts, characters, guilds] = await Promise.all([
    store.counts().catch(() => null),
    results(q, (p) => store.search(p, SEARCH_LIMIT)),
    results(g, (p) => store.searchGuilds(p, SEARCH_LIMIT)),
  ]);

  return (
    <Container width="reading">
      <article className="space-y-8">
        <PageHeader
          trail={[{ name: "Home", path: "/" }, { name: "Armory", path: ARMORY_PATH }]}
          title="Armory"
          lede="Every WoW: Forever character and guild Everloot has read from Blizzard's API: level, gear, item level, honorable kills and guild rosters. Each is read again within 20 days, and nothing is kept longer than 30 days after its last read."
          meta={<ArmoryCredit at={counts ? newest(counts.map((c) => c.newest)) : null} />}
        />

        <section aria-labelledby="armory-find" className="space-y-3">
          <SectionHeading id="armory-find">Find a character or a guild</SectionHeading>
          <SearchForm id="armory-q" name="q" label="Character name" value={q} />
          <SearchForm id="armory-guild" name="guild" label="Guild name" value={g} />
          {(characters === "invalid" || guilds === "invalid") && <p className="text-sm text-fg-2">Type 2 to 24 letters, no digits, spaces or hyphens.</p>}
          {characters && characters !== "invalid" && (
            characters.rows === "unreachable" ? <Unreachable /> : characters.rows.length === 0
              ? <p className="text-sm text-fg-2">No character starts with &ldquo;{characters.prefix}&rdquo; yet. <Link href={ARMORY_SUBMIT_PATH} className={link}>Add one</Link>.</p>
              : <DataTable dense caption={`Characters whose name starts with ${characters.prefix}`} columns={hitColumns} rows={characters.rows} rowKey={(h) => `${h.region}/${h.slug}`} />
          )}
          {guilds && guilds !== "invalid" && (
            guilds.rows === "unreachable" ? <Unreachable /> : guilds.rows.length === 0
              ? <p className="text-sm text-fg-2">No guild starts with &ldquo;{guilds.prefix}&rdquo; yet.</p>
              : <DataTable dense caption={`Guilds whose name starts with ${guilds.prefix}`} columns={guildColumns} rows={guilds.rows} rowKey={(r) => `${r.region}/${r.slug}`} />
          )}
        </section>

        <section aria-labelledby="armory-boards" className="space-y-3">
          <SectionHeading id="armory-boards">Rankings</SectionHeading>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {ARMORY_METRICS.map((m) => <li key={m}><Link href={armoryBoardPath(m)} className={link}>{ARMORY_BOARDS[m].title}</Link></li>)}
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
