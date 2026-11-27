import type { Metadata } from "next";
import type { ReactNode } from "react";
import EdgeDegraded from "@/components/EdgeDegraded";
import { pageMetadata } from "@/lib/seo";
import Link from "@/components/Link";
import { objectList } from "@kb/object-page";
import { computeRollups, loadWorldFacts } from "@/lib/rollup-compute";
import { CLIENT_TAXONOMY as T, itemsHref, subclassLabel } from "@/lib/items";
import { npcRows, publicQuests, publicVendors } from "@/lib/world-lists";
import { loadCatalog, titleRows } from "@/lib/completion-lists";
import { DATABASE_HUBS } from "@/lib/database-hubs";
import { currencyEntries, mountEntries, petEntries, toyEntries } from "@/lib/collectibles";
import { holidayEntries, petFamilyEntries } from "@/lib/world-events";
import { instanceRows } from "@/lib/instances";
import { bossEntries } from "@/lib/bosses";
import { publicZones } from "@/lib/zones";
import { terrainTypes } from "@/lib/terrain";
import JsonLd from "@/components/JsonLd";
import { AgreementMeter, Card, Container, DataTitle, Disclosure, SearchBar } from "@/components/ui";
import GameIcon from "@/components/game/GameIcon";
import { NewestPanel } from "@/components/home/LivePanels";
import { DATABASE_GROUPS, GRID_HREFS, type DatabaseCard } from "@/lib/database-home";
import { loadHomeNewest } from "@/lib/home-live";
import { TALENT_CLASSES } from "@/lib/talents/catalogs";
import { asOfLine, EVIDENCE_KEY } from "@/lib/evidence";
import { loadSiteAssets, loadSpellNames, type SiteAssets } from "@/lib/game-assets";
import gameBuild from "@/data/game-data/build-version.json";
import { ITEM_SETS } from "@/lib/item-sets";
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

/** The types under a class heading, closed until asked for: "Cloth, Leather and 13 more". */
const typesSummary = (links: { label: string }[]) =>
  links.length <= 2 ? links.map((l) => l.label).join(" and ") : `${links.slice(0, 2).map((l) => l.label).join(", ")} and ${links.length - 2} more`;

/**
 * One block of the browse index: a heading with its count, then its links, 13 px on 26 px lines. `collapsed` keeps
 * the links behind a Disclosure (a class's item types), so the index reads as one line per class.
 */
function Block({ heading, href, count, note, links, collapsed = false }: { heading?: string; href?: string; count?: ReactNode; note?: ReactNode; links: { href: string; label: string; count?: ReactNode }[]; collapsed?: boolean }) {
  const list = (
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
  );
  return (
    <section className="mb-6 break-inside-avoid">
      {heading && (
        <h3 className="flex items-baseline justify-between gap-3 text-cell font-semibold text-fg">
          {href ? <Link href={href} className="hover:text-accent">{heading}</Link> : heading}
          {count !== undefined && <span className="text-meta font-normal tabular-nums text-muted">{count}</span>}
        </h3>
      )}
      {note && <p className="mt-1 text-meta text-muted">{note}</p>}
      {links.length > 0 && (collapsed ? <div className="mt-1"><Disclosure summary={typesSummary(links)}>{list}</Disclosure></div> : list)}
    </section>
  );
}

/** One entity type: its icon from the asset manifest (an empty frame without one, so the names line up), name, count and note. */
function TypeCard({ card, count, assets }: { card: DatabaseCard; count?: ReactNode; assets: SiteAssets | null }) {
  const icon = assets ? card.icon(assets) : null;
  return (
    <li className="min-w-0">
      <Card href={card.href} padding="sm" className="flex h-full items-start gap-3">
        {icon ? <GameIcon src={icon} size={36} rounded="control" /> : <span aria-hidden="true" className="size-9 shrink-0 rounded-control border border-line" />}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-cell font-semibold text-fg">{card.label}</span>
            {count !== undefined && <span className="shrink-0 text-meta tabular-nums text-muted">{count}</span>}
          </span>
          <span className="mt-0.5 block text-meta text-fg-2">{card.note}</span>
        </span>
      </Card>
    </li>
  );
}

export default async function DatabasePage() {
  const [{ rates, measuredZeros, stats }, world, catalog, spellNames, assets, newest] = await Promise.all([
    computeRollups(), loadWorldFacts(), loadCatalog(), loadSpellNames(gameBuild.version),
    // The manifest the item and spell pages already read, for the cards' icons; the newest facts are the home page's cached read.
    loadSiteAssets(), loadHomeNewest(),
  ]);
  const live = rates.filter((r) => r.public).length + measuredZeros.filter((z) => z.public).length;
  const classes = T.classes.filter((c) => c.items > 0).sort((a, b) => b.items - a.items);
  // What players have made public so far, per place: a count once there is one, the empty meter until then.
  // `what` names what the number counts where the card's list shows more rows than it (the quest list adds the quests
  // only the files or the wiki title), so the two numbers never read as a contradiction.
  const seen = (x: number, what?: string) => (stats.unreachable ? "unrecorded" : x > 0 ? (what ? `${n(x)} ${what}` : n(x)) : <AgreementMeter count={0} />);
  const listed = (x?: number) => (x === undefined ? "unrecorded" : x > 0 ? n(x) : <AgreementMeter count={0} />);
  const readable = !world.unreachable;
  // The rows come from DATABASE_HUBS, which the sitemap reads too; a hub with no count here prints none.
  const counts: Record<string, ReactNode> = {
    "/database/npcs": seen(readable ? npcRows(world, rates).length : 0),
    "/database/quests": seen(readable ? publicQuests(world).length : 0, "confirmed"),
    "/database/vendors": seen(readable ? publicVendors(world).length : 0),
    "/database/objects": seen(stats.unreachable ? 0 : objectList({ rates, measuredZeros, names: [] }).length),
    "/database/spells": listed(spellNames?.names.size),
    "/database/achievements": listed(catalog?.achievements.length),
    "/database/factions": listed(catalog?.factions.length),
    "/database/titles": listed(catalog ? titleRows(catalog.titles).length : undefined),
    "/database/quest-chains": listed(catalog?.chains.length),
    // The item sets the game files list, like the zone count: it reads the files, not the uploads.
    "/database/item-sets": n(ITEM_SETS.length),
    "/database/mounts": listed(mountEntries()?.length),
    "/database/pets": listed(petEntries()?.length),
    "/database/toys": listed(toyEntries()?.length),
    "/database/currencies": listed(currencyEntries()?.length),
    "/database/holidays": listed(holidayEntries()?.length),
    "/database/pet-families": listed(petFamilyEntries()?.length),
    "/database/drops": seen(live),
    "/database/zones": n(publicZones().length),
    // The instances the game files place in a released zone, like the zone count: it reads the files, not the uploads.
    // The list adds the ones only players saw, so the card says what its number counts.
    "/database/instances": `${n(instanceRows().size)} in game files`,
    // Their bosses, from the same files rows.
    "/database/bosses": n(bossEntries().length),
    // The terrain types the game files name, like the zone count: it reads the files, not the uploads.
    "/database/terrain": n(terrainTypes().length),
    "/database/items": n(T.items.length),
    // The classes the talent calculator has trees for, which /classes lists.
    "/classes": n(TALENT_CLASSES.length),
  };
  // A hub no card names (quest chains, terrain, the loot and coverage pages, a hub added later) is linked under the grid.
  const moreLinks = DATABASE_HUBS.filter((h) => !GRID_HREFS.has(h.href)).map((h) => ({ href: h.href, label: h.label, count: counts[h.href] }));
  const beforeLaunch = Date.now() < Date.parse(LAUNCH_AT);
  // Retired and unnamed buckets ("Trade Goods (OBSOLETE)", "Subclass 0") stay on the class page only, and a class
  // whose one subclass is itself ("Quest › Quest") lists none: the heading already says it.
  const subclassLinks = (c: (typeof classes)[number]) => {
    const links = T.subclasses.filter((s) => s.classId === c.id && s.items > 0 && !subclassLabel(s).retired).map((s) => ({ href: itemsHref(c.slug, s.slug), label: subclassLabel(s).label, count: n(s.items) }));
    return links.length === 1 && links[0]!.label === c.label ? [] : links;
  };

  return (
    <Container width="data">
      <EdgeDegraded when={stats.unreachable || world.unreachable} />
      <article>
        <JsonLd data={datasetJsonLd({ uploads: stats.unreachable ? 0 : stats.uploads, name: DATASET_NAME, description, path: "/database", corpusPath: "/api/corpus/public", dataAsOf: stats.unreachable ? null : stats.dataAsOf })} />
        <DataTitle
          title="Database"
          meta={[
            `${n(T.items.length)} items in the game files`,
            `game build ${gameBuild.version}`,
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

        <nav aria-label="Browse the database" className="mt-6 space-y-8">
          {DATABASE_GROUPS.map((g) => (
            <section key={g.key} aria-labelledby={`group-${g.key}`}>
              <h2 id={`group-${g.key}`} className="text-h2-sm font-semibold text-fg sm:text-h2">{g.heading}</h2>
              {/* An empty meter needs its why: before launch recording has not started, after it a row waits for agreement. */}
              {g.key === "world" && (
                <p className="mt-1 text-meta text-muted">
                  {beforeLaunch
                    ? `The addon starts recording when the game launches on ${longDate(LAUNCH.date)}.`
                    : <>NPCs, objects, vendors and quests come from players: a row fills when 3 installs agree. <Link href="/addon" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Get the addon</Link>.</>}
                </p>
              )}
              <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {g.cards.map((c) => <TypeCard key={c.href} card={c} count={counts[c.href]} assets={assets} />)}
              </ul>
            </section>
          ))}
        </nav>

        <div className="mt-8"><NewestPanel id="recent-facts" title="Recently confirmed" facts={newest} /></div>

        <section aria-labelledby="more-lists" className="mt-8">
          <h2 id="more-lists" className="text-h2-sm font-semibold text-fg sm:text-h2">More lists</h2>
          <div className="mt-2 sm:columns-2 sm:gap-x-8 lg:columns-3"><Block links={moreLinks} /></div>
        </section>

        <section aria-labelledby="items-by-class" className="mt-8">
          <h2 id="items-by-class" className="text-h2-sm font-semibold text-fg sm:text-h2">Items by class</h2>
          <div className="mt-3 columns-2 gap-x-8 sm:columns-3 lg:columns-4">
            {classes.map((c) => (
              <Block
                key={c.id}
                heading={c.label}
                href={itemsHref(c.slug)}
                count={n(c.items)}
                links={subclassLinks(c)}
                collapsed
              />
            ))}
          </div>
        </section>

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
