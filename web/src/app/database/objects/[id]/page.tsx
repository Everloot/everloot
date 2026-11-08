import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasCard } from "@/lib/tooltip";
import { objectPage, type ObjectDrop, type ObjectFacts, type ObjectPage as ObjectFactsPage } from "../../../../../../kb/src/object-page";
import { pendingLine } from "../../../../../../kb/src/pending-loot";
import { pinLink } from "@/lib/world-map";
import { objectIndexable } from "@/lib/indexable";
import { entityTitle, objectDescription } from "@/lib/entity-meta";
import { formatMeasuredZero } from "../../../../../../kb/src/item-page";
import { loadObjectFacts } from "@/lib/objects";
import { pageMetadata } from "@/lib/seo";
import { Container, DataTable, Facts, InShort, OpenData, Tabs, TooltipFrame, type Column } from "@/components/ui";
import type { Crumb } from "@/lib/jsonld";
import { EmptyTab, EntityHeader, EntityTop, FREQUENCY, known, LINK, MAP_LINK_HEADER, MapName, percent, ShowOnMap, Unreachable } from "../../entity";
import { entitySummary, observedLine } from "@/lib/evidence";

export const dynamic = "force-dynamic";

/** An object no loot window or minimap sighting came from, public or not: a 404 (uploads are the only list of objects). */
const unknownObject = (page: ObjectFactsPage, facts: ObjectFacts, unreachable: boolean) => !unreachable && !page.drops.length && !page.zero && !page.queued
  && !page.pendingLoot && !(facts.sightings ?? []).some((r) => r.objectId === page.objectId);

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) return { robots: { index: false, follow: true } };
  const facts = await loadObjectFacts();
  const page = objectPage(Number(params.id), facts);
  if (unknownObject(page, facts, facts.unreachable)) notFound();
  const windows = facts.unreachable ? null : page.zero?.kills ?? page.drops[0]?.kills ?? null;
  const name = !facts.unreachable && page.name ? page.name : `Object ${params.id}`;
  return {
    ...pageMetadata({ title: entityTitle(name, "object"), description: objectDescription({ name, id: page.objectId, items: facts.unreachable ? 0 : page.drops.length, windows }), path: `/database/objects/${params.id}` }),
    robots: { index: objectIndexable(page, facts.unreachable), follow: true },
  };
}

const columns: Column<ObjectDrop>[] = [
  { key: "item", header: "Item", cell: (d) => <Link href={`/database/items/${d.itemId}`} className={LINK}>{d.itemName ?? `Item ${d.itemId}`}</Link> },
  { key: "windows", header: "Loot windows", numeric: true, cell: (d) => d.kills },
  { key: "drops", header: "Drops", numeric: true, cell: (d) => d.drops },
  { key: "rate", header: FREQUENCY, numeric: true, cell: (d) => percent(d.rate) },
  { key: "installs", header: "Install IDs", numeric: true, cell: (d) => d.reporters },
];

type ObjectPin = NonNullable<ObjectFactsPage["pins"]>[number];
const pinColumns: Column<ObjectPin>[] = [
  { key: "map", header: "Map", cell: (p) => <MapName mapId={p.mapId} /> },
  { key: "at", header: "Position", numeric: true, cell: (p) => `${p.x}, ${p.y}` },
  { key: "installs", header: "Reporters", numeric: true, cell: (p) => p.reporters },
  { key: "show", header: MAP_LINK_HEADER, cell: (p) => { const href = pinLink(p.mapId, p.x, p.y); return href ? <ShowOnMap href={href} mapId={p.mapId} x={p.x} y={p.y} /> : null; } },
];

export default async function ObjectPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) notFound();
  const facts = await loadObjectFacts();
  const page = objectPage(Number(params.id), facts);
  if (unknownObject(page, facts, facts.unreachable)) notFound();
  const title = !facts.unreachable && page.name ? page.name : `Object ${page.objectId}`;
  const trail: Crumb[] = [
    { name: "Home", path: "/" },
    { name: "Database", path: "/database" },
    { name: "Objects", path: "/database/objects" },
    { name: title, path: `/database/objects/${page.objectId}` },
  ];
  const windows = page.zero?.kills ?? page.drops[0]?.kills;
  const pins = facts.unreachable ? [] : page.pins ?? [];
  // Reported windows the rates leave out: a count under the drops, never a rate.
  const pending = !facts.unreachable && page.pendingLoot ? <p className="py-2 text-meta text-fg-2">{pendingLine(page.pendingLoot)}</p> : null;
  // The page in three lines: what it is, what players found in it, and what is not known.
  const summary = entitySummary({
    identity: "A chest, herb, ore vein or fishing pool",
    observed: observedLine(
      [page.drops.length ? `${page.drops.length} ${page.drops.length === 1 ? "item seen" : "items seen"}` : null, windows ? `${windows} ${windows === 1 ? "loot window" : "loot windows"}` : null],
      null,
      Date.now(),
    ),
    named: title !== `Object ${page.objectId}`,
  });

  return (
    <Container width="data">
      <article>
        <EntityHeader trail={trail} title={title} meta={["Object", "chest, herb, ore vein or fishing pool"]} />
        <EntityTop
          box={<TooltipFrame name={title} label={`${title}, as players saw it`} />}
          facts={!facts.unreachable && (
            <Facts
              layout="list"
              label={`${title}: quick facts`}
              items={[
                { label: "Loot windows", value: known(windows), numeric: true },
                { label: "Items seen", value: known(page.zero ? "None" : page.drops.length || null), numeric: true },
                { label: "Map positions", value: known(page.pins?.length || null), numeric: true },
              ]}
            />
          )}
        />
        <InShort summary="In short" bullets={summary} note={<Link href="/database#reading" className={LINK}>How to read these numbers</Link>} />
        <OpenData
          text={[`${title} (object ${page.objectId})`, ...summary, `Source: https://everloot.app/database/objects/${page.objectId}`].join("\n")}
          jsonHref={!facts.unreachable && hasCard.object(page) ? `/api/tooltip/object/${page.objectId}` : undefined}
        />
        <Tabs
          label={`${title}: relations`}
          tabs={[{
            id: "drops", label: "Drops", count: facts.unreachable ? undefined : page.drops.length,
            panel: facts.unreachable ? <Unreachable />
              : <>
                {page.drops.length ? <DataTable dense caption={`What players looted from ${title}`} columns={columns} rows={page.drops} rowKey={(d) => String(d.itemId)} />
                  : page.zero ? <p className="py-3 text-meta text-fg">{formatMeasuredZero(page.zero.kills)} · {page.zero.reporters} install IDs.</p>
                  : <EmptyTab message={page.queued ? "Observed, not yet public: fewer than 3 installs so far." : "Nobody has looted this object in Forever yet."} />}
                {pending}
              </>,
          }, {
            id: "map", label: "Map", count: facts.unreachable ? undefined : pins.length,
            panel: facts.unreachable ? <Unreachable />
              : pins.length ? <DataTable dense caption={`Where players saw ${title} on the minimap`} columns={pinColumns} rows={pins} rowKey={(p) => `${p.mapId}-${p.x}-${p.y}`} />
              : <EmptyTab message="No agreed position yet. A pin needs 3 installs at the same spot." />,
          }]}
        />
      </article>
    </Container>
  );
}
