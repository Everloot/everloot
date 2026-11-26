import { dropTierLabel } from "@kb/drop-rollup";
import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { entityPageJsonLd } from "@/lib/jsonld";
import Link from "next/link";
import { notFound } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import { hasCard } from "@/lib/tooltip";
import { objectPage, type ObjectDrop } from "@kb/object-page";
import { pendingLine } from "@kb/pending-loot";
import { objectIndexable } from "@/lib/indexable";
import { entityTitle, objectDescription } from "@/lib/entity-meta";
import { formatMeasuredZero } from "@kb/item-page";
import { loadObjectFacts } from "@/lib/objects";
import { loreFor } from "@/lib/lore-links";
import LoreSection from "@/components/LoreSection";
import { pageMetadata } from "@/lib/seo";
import { Container, DataTable, Facts, InShort, OpenData, Tabs, TooltipFrame, type Column } from "@/components/ui";
import type { Crumb } from "@/lib/jsonld";
import { EntityLayout, EntitySidebar, EMPTY, EmptyTab, EntityHeader, EntityTop, FREQUENCY, known, LINK, percent, PinTable, Unreachable } from "../../entity";
import { entitySummary, observedLine } from "@/lib/evidence";
import { unknownObject } from "../../unknown";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) return { robots: { index: false, follow: true } };
  const facts = await loadObjectFacts();
  const page = objectPage(Number(params.id), facts);
  if (unknownObject(page, facts, facts.unreachable)) notFound();
  const windows = facts.unreachable ? null : page.zero?.kills ?? page.drops[0]?.kills ?? null;
  const name = !facts.unreachable && page.name ? page.name : `Object ${params.id}`;
  return {
    ...pageMetadata({ title: entityTitle(name, "object"), description: objectDescription({ name, id: page.objectId, items: facts.unreachable ? 0 : page.drops.length, windows }), path: `/database/objects/${params.id}`, image: `${`/database/objects/${params.id}`}/opengraph-image` }),
    robots: { index: objectIndexable(page, facts.unreachable), follow: true },
  };
}

const columns: Column<ObjectDrop>[] = [
  { key: "item", header: "Item", cell: (d) => <Link href={`/database/items/${d.itemId}`} className={LINK}>{d.itemName ?? `Item ${d.itemId}`}</Link> },
  { key: "windows", header: "Loot windows", numeric: true, cell: (d) => d.kills },
  { key: "drops", header: "Drops", numeric: true, cell: (d) => d.drops },
  { key: "tier", header: "Reports", cell: (d) => dropTierLabel(d.reporters) },
  { key: "rate", header: FREQUENCY, numeric: true, cell: (d) => percent(d.rate) },
  { key: "installs", header: "Installs", numeric: true, cell: (d) => d.reporters },
];

export default async function ObjectPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) notFound();
  const facts = await loadObjectFacts();
  const page = objectPage(Number(params.id), facts);
  if (unknownObject(page, facts, facts.unreachable)) notFound();
  const title = !facts.unreachable && page.name ? page.name : `Object ${page.objectId}`;
  const trail: Crumb[] = [
    ...trailFor("/database/objects")!,
    { name: title, path: `/database/objects/${page.objectId}` },
  ];
  const windows = page.zero?.kills ?? page.drops[0]?.kills;
  const pins = facts.unreachable ? [] : page.pins ?? [];
  // The archive files an object under no type of its own, so its page is one of the "other" pages.
  const lore = !facts.unreachable && page.name ? await loreFor("object", page.objectId, page.name) : null;
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
      <EntityLayout>
        <JsonLd data={entityPageJsonLd({ name: title, path: `/database/objects/${page.objectId}`, identifier: `object:${page.objectId}` })} />
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
        <EntitySidebar>
          <InShort summary="In short" bullets={summary} note={<Link href="/database#reading" className={LINK}>How to read these numbers</Link>} />
          <OpenData report={{ type: "Object", id: page.objectId, path: `/database/objects/${page.objectId}` }}
            text={[`${title} (object ${page.objectId})`, ...summary, `Source: https://everloot.app/database/objects/${page.objectId}`].join("\n")}
            jsonHref={!facts.unreachable && hasCard.object(page) ? `/api/tooltip/object/${page.objectId}` : undefined}
          />
        </EntitySidebar>
        <Tabs
          label={`${title}: relations`}
          tabs={[{
            // No rates yet but loot on record (none with an item, short of 3 installs, or outside the rates): no count, so the tab and its line stay.
            id: "drops", label: "Drops", count: facts.unreachable || (!page.drops.length && (page.zero || page.queued || pending)) ? undefined : page.drops.length,
            panel: facts.unreachable ? <Unreachable />
              : <>
                {page.drops.length ? <DataTable dense caption={`What players looted from ${title}`} columns={columns} rows={page.drops} rowKey={(d) => String(d.itemId)} />
                  : page.zero ? <p className="py-3 text-meta text-fg">{formatMeasuredZero(page.zero.kills)} · {dropTierLabel(page.zero.reporters)}.</p>
                  : <EmptyTab message={page.queued ? EMPTY.queued : EMPTY.drops("this object")} />}
                {pending}
              </>,
          }, {
            id: "map", label: "Map", count: facts.unreachable ? undefined : pins.length,
            panel: facts.unreachable ? <Unreachable />
              : pins.length ? <PinTable caption={`Where players saw ${title} on the minimap`} rows={pins} rowKey={(p) => `${p.mapId}-${p.x}-${p.y}`} />
              : <EmptyTab message={EMPTY.position} />,
          }]}
        />
        <div className="mt-6 space-y-6 empty:hidden">
          <LoreSection match={lore} />
        </div>
      </EntityLayout>
    </Container>
  );
}
