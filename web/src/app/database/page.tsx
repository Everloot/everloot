import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { objectList } from "../../../../kb/src/object-page";
import { computeRollups, loadWorldFacts } from "@/lib/rollup-compute";
import { CLIENT_TAXONOMY as T, itemsHref, subclassLabel } from "@/lib/items";
import { npcRows, publicQuests, publicVendors } from "@/lib/world-lists";
import { loadCatalog } from "@/lib/completion-lists";
import { DATABASE_HUBS } from "@/lib/database-hubs";
import { instanceRows } from "@/lib/instances";
import { publicZones } from "@/lib/zones";
import JsonLd from "@/components/JsonLd";
import { AgreementMeter, Container, DataTitle, SearchBar } from "@/components/ui";
import { asOfLine, EVIDENCE_KEY } from "@/lib/evidence";
import { loadSpellNames } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@/lib/items";
import { datasetJsonLd } from "@/lib/jsonld";
import { LAUNCH, LAUNCH_AT, longDate } from "@/data/wow-forever";

const TITLE = "WoW Forever Database";
const description = "Loot-window observations, NPC sightings, quests and vendors for WoW: Forever, from addon uploads. Public facts need corroborated install reports.";
const DATASET_NAME = "Everloot addon observations for WoW: Forever";

export const metadata: Metadata = {
  ...pageMetadata({ title: TITLE, description, path: "/database" }),
};
export const dynamic = "force-dynamic";

const n = (x: number) => x.toLocaleString("en-US");

/** One block of the browse index: a heading with its count, then its links, 13 px on 26 px lines. */
function Block({ heading, href, count, note, links }: { heading: string; href?: string; count?: ReactNode; note?: string; links: { href: string; label: string; count?: ReactNode }[] }) {
  return (
    <section className="mb-6 break-inside-avoid">
      <h2 className="flex items-baseline justify-between gap-3 text-cell font-semibold text-fg">
        {href ? <Link href={href} className="hover:text-accent">{heading}</Link> : heading}
        {count !== undefined && <span className="text-meta font-normal tabular-nums text-muted">{count}</span>}
      </h2>
      {note && <p className="mt-1 text-meta text-muted">{note}</p>}
      {links.length > 0 && (
        <ul className="mt-1">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="flex h-[26px] items-center justify-between gap-3 text-meta text-fg-2 hover:text-accent">
                <span className="min-w-0 truncate">{l.label}</span>
                {l.count !== undefined && <span className="shrink-0 tabular-nums text-muted">{l.count}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function DatabasePage() {
  const [{ rates, measuredZeros, stats }, world, catalog, spellNames] = await Promise.all([computeRollups(), loadWorldFacts(), loadCatalog(), loadSpellNames(CLIENT_LAYER.build.version)]);
  const live = rates.filter((r) => r.public).length + measuredZeros.filter((z) => z.public).length;
  const classes = T.classes.filter((c) => c.items > 0).sort((a, b) => b.items - a.items);
  // What players have made public so far, per place: a count once there is one, the empty meter until then.
  const seen = (x: number) => (stats.unreachable ? "unrecorded" : x > 0 ? n(x) : <AgreementMeter count={0} />);
  const listed = (x?: number) => (x === undefined ? "unrecorded" : x > 0 ? n(x) : <AgreementMeter count={0} />);
  const readable = !world.unreachable;
  // The rows come from DATABASE_HUBS, which the sitemap reads too; a hub with no count here prints none.
  const counts: Record<string, ReactNode> = {
    "/database/npcs": seen(readable ? npcRows(world, rates).length : 0),
    "/database/quests": seen(readable ? publicQuests(world).length : 0),
    "/database/vendors": seen(readable ? publicVendors(world).length : 0),
    "/database/objects": seen(stats.unreachable ? 0 : objectList({ rates, measuredZeros, names: [] }).length),
    "/database/spells": listed(spellNames?.names.size),
    "/database/achievements": listed(catalog?.achievements.length),
    "/database/factions": listed(catalog?.factions.length),
    "/database/titles": listed(catalog?.titles.length),
    "/database/quest-chains": listed(catalog?.chains.length),
    "/database/drops": seen(live),
    "/database/zones": n(publicZones().length),
    // The instances the game files place in a released zone, like the zone count: it reads the files, not the uploads.
    "/database/instances": n(instanceRows().size),
    "/tools/guild-board": "uploads",
  };
  const players = DATABASE_HUBS.map((h) => ({ href: h.href, label: h.label, count: counts[h.href] }));

  return (
    <Container width="data">
      <article>
        <JsonLd data={datasetJsonLd({ uploads: stats.unreachable ? 0 : stats.uploads, name: DATASET_NAME, description, path: "/database", corpusPath: "/api/corpus/public", dataAsOf: stats.unreachable ? null : stats.dataAsOf })} />
        <DataTitle
          title="Database"
          meta={[
            `${n(T.items.length)} items in the game files`,
            "NPCs, quests and objects seen by players",
            asOfLine(stats.unreachable ? null : stats.dataAsOf, Date.now()),
          ].filter(Boolean).join(" · ")}
        />
        <SearchBar
          action="/search"
          id="database-search"
          label="Search the database"
          placeholder="A name or an id"
          scopes
        />

        <nav aria-label="Browse the database" className="mt-6 columns-2 gap-x-8 sm:columns-3 lg:columns-4">
          {/* Before launch every count here is empty; one line says why rather than a column of blanks. */}
          <Block heading="Seen by players" note={Date.now() < Date.parse(LAUNCH_AT) ? `The addon starts recording when the game launches on ${longDate(LAUNCH.date)}.` : undefined} links={players} />
          <Block heading="All items" href="/database/items" count={n(T.items.length)} links={[]} />
          {classes.map((c) => (
            <Block
              key={c.id}
              heading={c.label}
              href={itemsHref(c.slug)}
              count={n(c.items)}
              // Retired and unnamed buckets ("Trade Goods (OBSOLETE)", "Subclass 0") stay on the class page only.
              links={T.subclasses.filter((s) => s.classId === c.id && s.items > 0 && !subclassLabel(s).retired).map((s) => ({ href: itemsHref(c.slug, s.slug), label: subclassLabel(s).label, count: n(s.items) }))}
            />
          ))}
        </nav>

        <section id="reading" className="mt-8 border-t border-line pt-6">
          <h2 className="text-cell font-semibold text-fg">How to read these numbers</h2>
          <dl className="mt-3 space-y-3 text-sm text-fg-2">
            {EVIDENCE_KEY.map((row) => (
              <div key={row.term}>
                <dt className="text-fg">{row.term}</dt>
                <dd>{row.meaning}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-fg-2">
            The method behind every count is on the <Link href="/methodology" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">methodology page</Link>.
          </p>
        </section>
      </article>
    </Container>
  );
}
