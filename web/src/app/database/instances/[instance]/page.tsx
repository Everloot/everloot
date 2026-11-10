import type { Metadata } from "next";
import { trailFor } from "@/lib/breadcrumbs";
import JsonLd from "@/components/JsonLd";
import { entityPageJsonLd } from "@/lib/jsonld";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { AgreementMeter, Badge, Card, Container, DataTable, DataTitle, EmptyState, filledColumns, reportedLabel, SectionHeading, type Column, type SparseColumn } from "@/components/ui";
import {
  bossRows, difficultyLabel, difficultyList, instanceDescription, instanceHref, instanceQuests, instanceRows, instanceTitle, levelLabel, loadSightings, parseInstanceSegment,
  type BossRow, type InstancePlace, type InstanceQuest, type InstanceRow,
} from "@/lib/instances";
import { entityTitle } from "@/lib/entity-meta";
import { dayLabel } from "@/lib/report-labels";
import { PLACEHOLDER } from "@/lib/item-names";
import { mapHref } from "@/lib/map-view";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import EdgeDegraded from "@/components/EdgeDegraded";
import { wikiHref } from "@/lib/wiki";
import { prepPage } from "@/lib/wiki-dungeon";
import { npcLootTable } from "../../../../../../kb/src/loot-tables";
import EntityLink from "@/components/EntityLink";
import { loadItemTips, loadSiteAssets } from "@/lib/game-assets";
import { itemNames, npcNames } from "@/lib/names";
import { loadItemFacts, loadLootTables, loadWorldFacts } from "@/lib/rollup-compute";
import { Unreachable } from "../../entity";
import { NpcLootPanel } from "../../loot-tables";
import { zoneHref } from "@/lib/zones";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ instance: string }> };

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

/** The instance's row, with what players reported when storage answers; null for an id the site does not show. */
async function find(segment: string): Promise<{ row: InstanceRow; unreachable: boolean } | null> {
  const id = parseInstanceSegment(segment);
  if (id === null) return null;
  const seen = await loadSightings();
  const row = instanceRows(seen.unreachable ? {} : seen).get(id);
  return row ? { row, unreachable: seen.unreachable } : null;
}

const kindLabel = (raid: boolean | null) => (raid === null ? PLACEHOLDER : raid ? "Raid" : "Dungeon");

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { instance: segment } = await props.params;
  const found = await find(segment);
  if (!found) return { robots: { index: false, follow: true } };
  const { row, unreachable } = found;
  const title = instanceTitle(row);
  return {
    ...pageMetadata({
      title: entityTitle(title, row.raid === null ? "instance" : row.raid ? "raid" : "dungeon"),
      description: instanceDescription(row),
      path: instanceHref(row.instanceMapId, row.name),
    }),
    // Storage down: noindex rather than cache a page without its player reports.
    robots: { index: !unreachable, follow: true },
  };
}

const placeCell = (p: InstancePlace) => (
  <span className="inline-flex flex-wrap items-baseline gap-x-2">
    <Link href={zoneHref(p.mapId, p.zoneName)} className={link}>{p.zoneName}</Link>
    <Link href={mapHref({ mapId: p.mapId, x: p.x, y: p.y })} className="font-mono text-xs text-muted hover:underline underline-offset-4">{p.x}, {p.y}</Link>
  </span>
);

export default async function InstancePage(props: Props) {
  const { instance: segment } = await props.params;
  const found = await find(segment);
  if (!found) notFound();
  const { row, unreachable } = found;
  const canonical = instanceHref(row.instanceMapId, row.name);
  if (`/database/instances/${segment}` !== canonical) permanentRedirect(canonical);
  const title = instanceTitle(row);
  const empty = (message: string) => <EmptyState message={message} framed={false} />;
  const prep = prepPage(row.instanceMapId);

  const confirmedColumns: Column<InstanceRow["confirmed"][number]>[] = [
    { key: "at", header: "Outdoor map and position", cell: placeCell },
    { key: "installs", header: "Installs", cell: (p) => <AgreementMeter count={p.installs} /> },
    { key: "seen", header: "Last seen", numeric: true, cell: (p) => dayLabel(p.lastSeen) },
  ];
  // Player-first: the bosses 3 installs report, then the encounters the files list that no report has confirmed.
  // When storage is down the files' list stands alone, every row marked unconfirmed.
  const bosses = bossRows(unreachable ? { bosses: [], encounters: row.encounters } : row);
  // A column no row has a report for is left out (filledColumns), as on the database lists: a files-only list
  // reads as names with their unconfirmed marker, not rows of [?].
  const bossColumns: SparseColumn<BossRow>[] = [
    { key: "name", header: "Boss", cell: (b) => (b.filesName
      ? <span className="inline-flex items-baseline gap-1.5"><Badge tone="files" />{b.name}</span>
      : b.name ?? `Encounter ${b.encounterId}`) },
    { key: "kills", header: "Kills", numeric: true, blank: (b) => !b.boss, cell: (b) => (b.boss ? b.boss.kills.toLocaleString("en-US") : PLACEHOLDER) },
    // Short of 3, the count of installs that reported the encounter so far, beside the files' name: nothing else of theirs.
    { key: "installs", header: "Installs", blank: (b) => !b.boss && !b.reported, cell: (b) => (b.boss ? <AgreementMeter count={b.boss.reporters} /> : b.reported ? <AgreementMeter count={b.reported} withText /> : PLACEHOLDER) },
    { key: "seen", header: "Last seen", numeric: true, blank: (b) => !b.boss, cell: (b) => (b.boss ? dayLabel(b.boss.lastSeen) : PLACEHOLDER) },
    { key: "npcs", header: "Creatures", blank: (b) => !b.boss?.npcIds.length, cell: (b) => (b.boss?.npcIds.length
      ? b.boss.npcIds.map((id, i) => <span key={id}>{i > 0 && ", "}<Link href={`/database/npcs/${id}`} className={link}>NPC {id}</Link></span>)
      : PLACEHOLDER) },
  ];
  const shownBossColumns = filledColumns(bossColumns, bosses);
  const anyBossReported = bosses.some((b) => b.boss);
  const anyReport = anyBossReported || bosses.some((b) => b.reported);
  // On a phone the dense table keeps the boss name and folds the report into one line under it.
  const bossMeta = (b: BossRow) => (b.boss
    ? `${b.boss.kills.toLocaleString("en-US")} kills · ${b.boss.reporters} ${b.boss.reporters === 1 ? "install" : "installs"} · ${dayLabel(b.boss.lastSeen)}`
    : b.reported ? reportedLabel(b.reported) : "Not confirmed yet");

  // Loot, per boss: every boss above, with the loot table of each creature 3 installs tie to its encounter, the same
  // table its NPC page shows. A boss with no creature tied yet keeps its line, saying so.
  const lootBosses = bosses.map((b) => ({ encounterId: b.encounterId, name: b.name ?? `Encounter ${b.encounterId}`, npcIds: b.boss?.npcIds ?? [] }));
  const loot = unreachable || !lootBosses.some((b) => b.npcIds.length) ? null : await loadLootTables();
  const lootTables = new Map(loot && !loot.unreachable ? lootBosses.flatMap((b) => b.npcIds).map((id) => [id, npcLootTable(loot.tables, id)]) : []);
  // Item names (and icons, when the game files have them) for the drop rows; an item nobody named stays "Item N".
  const droppedIds = [...lootTables.values()].flatMap((t) => t.rows.map((r) => r.itemId));
  const itemFacts = droppedIds.length ? await loadItemFacts() : null;
  const names = itemFacts && !itemFacts.unreachable ? itemNames(itemFacts) : new Map<number, string>();
  const tips = await loadItemTips(droppedIds.length ? await loadSiteAssets() : null, droppedIds);

  // Quests: the ones 3 installs file under this instance's name in the quest log, from the stored world facts.
  const world = unreachable || row.name === null ? null : await loadWorldFacts();
  const quests = world && !world.unreachable ? instanceQuests(world, row.name) : [];
  const npcName = world && !world.unreachable && quests.length ? npcNames(world) : new Map<number, string>();
  const npcLink = (id: number | null) => (id === null ? PLACEHOLDER : <Link href={`/database/npcs/${id}`} className={link}>{npcName.get(id) ?? `NPC ${id}`}</Link>);
  const questColumns: Column<InstanceQuest>[] = [
    { key: "quest", header: "Quest", cell: (q) => <Link href={`/database/quests/${q.questId}`} className={link}>{q.title ?? `Quest ${q.questId}`}</Link> },
    { key: "level", header: "Level", numeric: true, cell: (q) => q.level ?? PLACEHOLDER },
    { key: "giver", header: "Giver", cell: (q) => npcLink(q.giverNpcId) },
    { key: "turnin", header: "Turn-in", cell: (q) => npcLink(q.turnInNpcId) },
    { key: "installs", header: "Installs", cell: (q) => <AgreementMeter count={q.installs} /> },
    { key: "seen", header: "Last seen", numeric: true, cell: (q) => dayLabel(q.lastSeen) },
  ];

  const unconfirmed = row.reported > 0
    ? `No entrance is confirmed yet. ${row.reported} ${row.reported === 1 ? "install has" : "installs have"} zoned in, and 3 must agree on the place.`
    : "No entrance is confirmed yet: no install has reported zoning in. An entrance is confirmed once 3 installs zone in from the same place.";

  return (
    <Container width="data">
      <EdgeDegraded when={unreachable} />
      <JsonLd data={entityPageJsonLd({ name: title, path: canonical, identifier: `instance:${row.instanceMapId}` })} />
      <article>
        <DataTitle
          title={title}
          meta={<span className="inline-flex items-center gap-2">{kindLabel(row.raid)}<span className="text-muted">Instance {row.instanceMapId}</span></span>}
          trail={[
            ...trailFor("/database/instances")!,
            { name: title, path: canonical },
          ]}
        />

        {prep && (
          <p className="mb-3 text-sm"><Link href={wikiHref(prep.slug)} className={link}>Prepare for this {prep.type === "raid" ? "raid" : "dungeon"}</Link></p>
        )}

        {unreachable && <p className="mb-3 text-meta text-warning">{STORAGE_UNREACHABLE} Players&apos; reports cannot be shown until it is back; the entrance below is from the game files.</p>}

        <div className="space-y-6">
          <section aria-labelledby="facts">
            <SectionHeading id="facts" note="The type is from the game files where they place the entrance, else as 3 installs agree. The level is from the game files, which give one level for most instances rather than a range. The difficulty is the id 3 installs agree on; the game files' own list of the instance's difficulties shows beside it when they give one.">
              Facts
            </SectionHeading>
            <Card as="div">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                {row.statisticBoss && <>
                  <dt className="text-muted">Name</dt>
                  <dd className="text-fg">
                    {row.name}
                    <span className="ml-2 inline-flex items-baseline gap-1.5 text-meta text-muted"><Badge tone="files" />from the game files&apos; kill statistic for {row.statisticBoss}; they place no entrance for it</span>
                  </dd>
                </>}
                <dt className="text-muted">Type</dt><dd className="text-fg">{kindLabel(row.raid)}</dd>
                <dt className="text-muted">Level</dt><dd className="text-fg">{levelLabel(row.level) ?? <span className="text-muted">–</span>}</dd>
                <dt className="text-muted">Difficulty</dt>
                <dd className="text-fg">
                  {row.difficulty !== null ? difficultyLabel(row.difficulty) : PLACEHOLDER}
                  {row.difficulties.length > 0 && (
                    <span className="ml-2 inline-flex items-baseline gap-1.5 text-meta text-muted"><Badge tone="files" />in the files, {difficultyList(row.difficulties)}</span>
                  )}
                </dd>
                <dt className="text-muted">Bosses reported</dt>
                <dd className="text-fg">
                  {unreachable ? PLACEHOLDER : row.bosses.length}
                  {row.encounters.length > 0 && (
                    <span className="ml-2 inline-flex items-baseline gap-1.5 text-meta text-muted"><Badge tone="files" />in the files, {row.encounters.length}</span>
                  )}
                </dd>
              </dl>
            </Card>
          </section>

          <section aria-labelledby="entrance">
            <SectionHeading id="entrance" note="Confirmed by the instance id: the last place outside where 3 installs stood before zoning in, at the median of their positions.">
              Entrance
            </SectionHeading>
            {row.files.length > 0 && (
              <ul className="mb-3 space-y-1 text-sm">
                {row.files.map((p) => (
                  <li key={`${p.mapId}-${p.x}-${p.y}`} className="flex flex-wrap items-center gap-2">
                    {placeCell(p)}
                    <span className="inline-flex items-baseline gap-1.5 text-meta text-muted"><Badge tone="files" />in the game files, not confirmed by players</span>
                  </li>
                ))}
              </ul>
            )}
            {!unreachable && (
              <DataTable
                dense caption={`Entrances to ${title} players confirmed`} columns={confirmedColumns} rows={row.confirmed}
                rowKey={(p) => `${p.mapId}-${p.x}-${p.y}`} empty={empty(unconfirmed)}
              />
            )}
          </section>

          <section aria-labelledby="bosses">
            <SectionHeading id="bosses" note="A boss is listed once 3 installs report its encounter ending here. Kills count every install's kills together; wipes are not kills. The encounters the game files list for this instance follow, marked unconfirmed until 3 installs report them.">
              Bosses
            </SectionHeading>
            <DataTable
              dense caption={`Bosses players reported in ${title}, and the ones the game files list`} columns={shownBossColumns} rows={bosses} rowKey={(b) => String(b.encounterId)}
              meta={anyReport ? bossMeta : undefined}
              footer={bosses.length > 0 && !anyBossReported ? (unreachable
                ? "Players' reports cannot be shown right now; this list is the game files' own."
                : anyReport
                  ? "No boss here has 3 installs reporting it yet. Kills and last seen show once one does."
                  : "No boss here has 3 installs reporting it yet. Kills, installs and last seen show once one does.") : undefined}
              empty={empty("No boss has 3 installs reporting it here yet, and the game files list none.")}
            />
          </section>

          <section aria-labelledby="loot">
            <SectionHeading id="loot" note="Each boss above, with the loot table of the creature 3 installs tie to its encounter: the same rows its NPC page shows. A rate needs loot windows from 3 installs; short of that, the count so far shows and no rate.">
              Loot
            </SectionHeading>
            {unreachable || loot?.unreachable ? <Unreachable />
              : lootBosses.length === 0 ? empty("No loot to show yet: no boss is known here. Loot shows per boss once 3 installs report the boss and the creature they fought.")
              : (
                <div className="space-y-4">
                  {lootBosses.map((b) => (
                    <div key={b.encounterId} data-boss-loot={b.encounterId}>
                      <h3 className="text-cell font-semibold text-fg">{b.name}</h3>
                      {b.npcIds.length === 0 && (
                        <p className="pt-1 text-meta text-fg-2">Not reported yet: no creature is tied to this boss. Its loot shows once 3 installs report which creature they fought in the encounter.</p>
                      )}
                      {b.npcIds.map((id) => {
                        const table = lootTables.get(id)!;
                        return (
                          <div key={id}>
                            <p className="flex flex-wrap items-center gap-x-3 pt-1 text-meta">
                              <Link href={`/database/npcs/${id}`} className={link}>NPC {id}</Link>
                              {table.state === "short" && <AgreementMeter count={table.span.installs} withText />}
                            </p>
                            <NpcLootPanel
                              table={table}
                              title={b.name}
                              dataAsOf={loot!.dataAsOf}
                              item={(itemId) => <EntityLink kind="item" id={itemId} name={names.get(itemId) ?? tips.get(itemId)?.name} icon={tips.get(itemId)?.icon} />}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
          </section>

          <section aria-labelledby="quests">
            <SectionHeading id="quests" note="A quest is listed once 3 installs report it under this instance's name in the quest log, where the game files a dungeon's quests. Installs counts every install that reported the quest.">
              Quests
            </SectionHeading>
            {unreachable || world?.unreachable ? <Unreachable /> : (
              <DataTable
                dense caption={`Quests players filed under ${title}`} columns={questColumns} rows={quests} rowKey={(q) => String(q.questId)}
                empty={empty(row.name === null
                  ? "Not reported yet: this instance has no name to match the quest log by."
                  : `Not reported yet: no quest has 3 installs filing it under ${row.name} in the quest log.`)}
              />
            )}
          </section>
        </div>
      </article>
    </Container>
  );
}
