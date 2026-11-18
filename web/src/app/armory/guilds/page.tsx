import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import { Container, DataTable, EmptyState, FilterBar, Input, PageHeader, ResultStrip, type Column, type FilterControl } from "@/components/ui";
import { ARMORY_REGIONS, ARMORY_RULESETS, armoryGuildPath, armoryOn, metricValue, regionLabel } from "@/lib/armory";
import type { ArmoryGuildRow } from "@/lib/armory-store";
import {
  directoryPrefix, GUILD_DIRECTORY_PAGE, GUILD_DIRECTORY_PATH, GUILD_SORTS, guildDirectoryHref, guildDirectoryQuery, loadGuildDirectory,
  rulesetSlug, type GuildDirectoryQuery,
} from "@/lib/armory-guilds";
import { guildsOn } from "@/lib/guild-switch";
import { playerStore } from "@/lib/player-store";
import { ArmoryCredit, armoryMetadata, day, first, link, newest, NOT_FOUND_METADATA, RegionRuleset, Unreachable } from "../parts";

/** Read on every request: the filters are in the address, and a hide takes effect at once. */
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  if (!armoryOn()) return NOT_FOUND_METADATA;
  return armoryMetadata({
    title: "WoW Forever Guild Directory",
    description: "WoW: Forever guilds Everloot has read from Blizzard's API, by members read, average item level and level 60 characters.",
    path: GUILD_DIRECTORY_PATH,
  });
}

const number = (n: number) => n.toLocaleString("en-US");
const muted = (text: string) => <span className="text-muted">{text}</span>;

function columns(counted: boolean): Column<ArmoryGuildRow>[] {
  const all: Column<ArmoryGuildRow>[] = [
    { key: "name", header: "Guild", cell: (g) => <Link href={armoryGuildPath(g.region, g.slug)} className={`${link} font-medium`}>{g.name}</Link> },
    { key: "where", header: "Region", nowrap: true, cell: (g) => <RegionRuleset region={g.region} ruleset={g.ruleset} /> },
    { key: "faction", header: "Faction", nowrap: true, cell: (g) => g.faction },
    { key: "roster", header: "Roster", numeric: true, cell: (g) => number(g.memberCount) },
    { key: "read", header: "Members read", numeric: true, cell: (g) => number(g.membersRead) },
    { key: "il", header: "Avg item level", numeric: true, cell: (g) => (g.averageItemLevel === null ? muted("Not read") : metricValue("item-level", g.averageItemLevel)) },
    { key: "l60", header: "Level 60", numeric: true, cell: (g) => number(g.level60) },
    { key: "at", header: "Last read", numeric: true, cell: (g) => <span className="font-mono tabular-nums">{day(g.fetchedAt)}</span> },
  ];
  // Before the directory's migration only the name, region, faction and roster size are known.
  return counted ? all : all.filter((c) => ["name", "where", "faction", "roster"].includes(c.key));
}

function controls(d: GuildDirectoryQuery): FilterControl[] {
  const href = (over: Partial<GuildDirectoryQuery>) => guildDirectoryHref({ ...d, page: 1, ...over });
  return [
    {
      type: "menu", key: "sort", label: `Sort: ${GUILD_SORTS.find((s) => s.slug === d.sort)!.label}`,
      options: GUILD_SORTS.map((s) => ({ label: s.label, href: href({ sort: s.slug }), on: d.sort === s.slug, reset: s.slug === "members" })),
    },
    {
      type: "menu", key: "region", label: d.region ? regionLabel(d.region) : "Region",
      options: [
        { label: "All regions", href: href({ region: null }), on: d.region === null, reset: true },
        ...ARMORY_REGIONS.map((r) => ({ label: regionLabel(r), href: href({ region: r }), on: d.region === r })),
      ],
    },
    {
      type: "menu", key: "ruleset", label: ARMORY_RULESETS.find((r) => r.id === d.ruleset)?.label ?? "Ruleset",
      options: [
        { label: "All rulesets", href: href({ ruleset: null }), on: d.ruleset === null, reset: true },
        ...ARMORY_RULESETS.map((r) => ({ label: r.label, href: href({ ruleset: r.id }), on: d.ruleset === r.id })),
      ],
    },
  ];
}

/** The guild hide list, or null when it could not be read (then no guild is listed). */
async function hiddenGuilds(): Promise<Set<string> | null> {
  try { return await playerStore().hiddenGuilds(); } catch { return null; }
}

export default async function GuildDirectoryPage(props: { searchParams: Promise<Search> }) {
  if (!armoryOn()) notFound();
  const params = await props.searchParams;
  const raw = (first(params.q) ?? "").trim().slice(0, 24);
  const invalid = directoryPrefix(raw) === "invalid";
  const d = guildDirectoryQuery(params);
  const dir = await loadGuildDirectory(d, await hiddenGuilds());
  const active = [d.region, d.ruleset, d.prefix].filter((v) => v !== null).length + (d.sort === "members" ? 0 : 1);
  const clearHref = guildDirectoryHref({});
  const ruleset = ARMORY_RULESETS.find((r) => r.id === d.ruleset);

  return (
    <Container width="data">
      <article className="space-y-4">
        <PageHeader
          trail={trailFor(GUILD_DIRECTORY_PATH)!}
          title="Guild directory"
          lede="WoW: Forever guilds read from Blizzard's API, with the characters the armory has read in each. A character who asked to be hidden is not counted."
          meta={<ArmoryCredit at={dir.state === "unreachable" ? null : newest(dir.rows.map((r) => r.fetchedAt))} />}
        />
        <form action={GUILD_DIRECTORY_PATH} method="get" role="search" className="flex max-w-xl flex-col gap-2 sm:flex-row">
          <label htmlFor="directory-q" className="sr-only">Guild name</label>
          <Input id="directory-q" name="q" type="search" defaultValue={raw} maxLength={24} autoComplete="off" placeholder="Start of a guild name, 2 letters or more" className="flex-1" />
          {d.region && <input type="hidden" name="region" value={d.region} />}
          {ruleset && <input type="hidden" name="ruleset" value={rulesetSlug(ruleset.label)} />}
          {d.sort !== "members" && <input type="hidden" name="sort" value={d.sort} />}
          <button type="submit" className="btn btn-primary min-h-11">Find a guild</button>
        </form>
        {invalid && <p className="text-sm text-fg-2">Type 2 to 24 letters from the start of the guild&apos;s name.</p>}

        {dir.state === "unreachable" ? <Unreachable /> : (
          <>
            <FilterBar
              label="Directory filters"
              controls={controls(d)}
              active={active}
              clearHref={clearHref}
              aside={dir.state === "ready" && dir.total > 0 && (
                <ResultStrip total={dir.total} noun="guilds" page={d.page} perPage={GUILD_DIRECTORY_PAGE} href={(page) => guildDirectoryHref({ ...d, page })} />
              )}
            />
            {dir.state === "not-ready" && (
              <p role="status" className="text-sm text-fg-2">
                Counts and sorting start once the directory&apos;s database update is applied.
                {d.prefix ? " Until then a search finds guilds by name." : " Until then, search a guild by name."}
              </p>
            )}
            {dir.rows.length === 0
              ? <EmptyState message={
                  dir.state === "ready" && d.page > 1 && dir.total > 0 ? "No guilds on this page."
                  : d.prefix ? `No guild read yet starts with “${d.prefix}”.`
                  : dir.state === "ready" ? "No guild matches these filters yet." : "No guild to list yet."
                } />
              : <DataTable
                  dense
                  caption={d.prefix ? `Guilds whose name starts with ${d.prefix}` : "Guilds read from Blizzard's API"}
                  columns={columns(dir.state === "ready")}
                  rows={dir.rows}
                  rowKey={(g) => `${g.region}/${g.slug}`}
                  meta={(g) => `${regionLabel(g.region)} ${g.ruleset} · ${number(g.memberCount)} on the roster`}
                />}
          </>
        )}
        <p className="text-sm text-fg-2">
          Members read counts the characters the armory has read whose guild this is; the roster is Blizzard&apos;s own count.
          {guildsOn() && <> Raid progression comes from members&apos; uploads, on <Link href="/guilds" className={link}>Guilds</Link>.</>}
        </p>
      </article>
    </Container>
  );
}
