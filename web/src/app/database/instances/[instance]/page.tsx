import type { Metadata } from "next";
import { trailFor } from "@/lib/breadcrumbs";
import Link from "@/components/Link";
import { notFound, permanentRedirect } from "next/navigation";
import { AgreementMeter, Badge, DataTable, Disclosure, filledColumns, reportedLabel, Tabs, type Column, type Fact, type SparseColumn, type TabItem } from "@/components/ui";
import { observedLine } from "@/lib/evidence";
import {
  bossRows, difficultyLabel, difficultyList, groupSizeLabel, instanceDescription, instanceHref, instanceQuests, instanceRows, instanceTitle, levelLabel, loadSightings, parseInstanceSegment,
  type BossRow, type InstancePlace, type InstanceQuest, type InstanceRow,
} from "@/lib/instances";
import { entityTitle } from "@/lib/entity-meta";
import { dayLabel } from "@/lib/report-labels";
import { PLACEHOLDER } from "@/lib/item-names";
import { mapHref } from "@/lib/map-view";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { wikiHref } from "@/lib/wiki";
import { prepPage } from "@/lib/wiki-dungeon";
import { missingLine, npcLootTable, spanPhrase } from "@kb/loot-tables";
import { agreedNpc } from "@kb/world-pages";
import { loadRenders } from "@/lib/game-renders";
import EntityLink from "@/components/EntityLink";
import { loadingArt, loadItemSetNames, loadSiteAssets, loadSpellNames } from "@/lib/game-assets";
import { loadItemLooks } from "@/lib/item-look";
import { EntityIcon } from "@/components/game/EntityIcon";
import GameIcon from "@/components/game/GameIcon";
import { CLIENT_LAYER } from "@kb/client-layer-file";
import { gearFor, instanceTerrain, TERRAIN_BUILD, TERRAIN_PATH } from "@/lib/terrain";
import TerrainGearTable from "@/components/TerrainGearTable";
import { npcNames } from "@/lib/names";
import { loadLootTables, loadWorldFacts } from "@/lib/rollup-compute";
import { EMPTY, EmptyTab, EntityArt, EntityPage, Unreachable } from "../../entity";
import { InstanceLootPanel, lootPage, type InstanceLootRow } from "../../loot-tables";
import { listHref } from "../../list-parts";
import { zoneHref } from "@/lib/zones";
import { loreFor } from "@/lib/lore-links";
import LoreSection from "@/components/LoreSection";
import EntityComments from "@/components/comments/EntityComments";
import { loadInstanceClears } from "@/lib/progression";
import { bossHref } from "@/lib/bosses";
import type { InstanceClears } from "@/lib/dungeon-clears";
import EntityScreenshots from "@/components/screenshots/EntityScreenshots";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ instance: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

/** The instance's row, with what players reported when storage answers; null for an id the site does not show. */
async function find(segment: string): Promise<{ row: InstanceRow; unreachable: boolean; asOf?: Date } | null> {
  const id = parseInstanceSegment(segment);
  if (id === null) return null;
  const seen = await loadSightings();
  const row = instanceRows(seen.unreachable ? {} : seen).get(id);
  return row ? { row, unreachable: seen.unreachable, asOf: seen.unreachable ? undefined : seen.asOf } : null;
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
      image: `${instanceHref(row.instanceMapId, row.name)}/opengraph-image`,
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
  const dropPage = lootPage((await props.searchParams)?.drops);
  const found = await find(segment);
  if (!found) notFound();
  const { row, unreachable, asOf } = found;
  const canonical = instanceHref(row.instanceMapId, row.name);
  if (`/database/instances/${segment}` !== canonical) permanentRedirect(canonical);
  const title = instanceTitle(row);
  // An empty list is one muted line, aligned with the table's cells, as on the zone pages.
  const empty = (message: string) => <div className="px-3"><EmptyTab message={message} players={false} action={null} /></div>;
  const assets = await loadSiteAssets();
  // The loading screen is the page's picture: a crop of it as the header icon, the whole of it as the top band's box.
  const loading = loadingArt(assets, row.instanceMapId);
  const prep = prepPage(row.instanceMapId);
  // The archive files an instance as a zone page; the match is by the game files' name for it.
  const lore = await loreFor("instance", row.instanceMapId, row.name);

  const confirmedColumns: Column<InstanceRow["confirmed"][number]>[] = [
    { key: "at", header: "Outdoor map and position", cell: placeCell },
    { key: "installs", header: "Installs", cell: (p) => <AgreementMeter count={p.installs} /> },
    { key: "seen", header: "Last seen", numeric: true, cell: (p) => dayLabel(p.lastSeen) },
  ];
  // Player-first: the bosses 3 installs report, then the encounters the files list that no report has confirmed.
  // When storage is down the files' list stands alone, every row marked unconfirmed.
  const bosses = bossRows(unreachable ? { bosses: [], encounters: row.encounters } : row);
  // Linked characters' public synced kills here, as counts only: their names are Blizzard's and stay on the armory.
  const clears = await loadInstanceClears(row.instanceMapId);
  const clearColumns: Column<InstanceClears["bosses"][number]>[] = [
    { key: "boss", header: "Boss", cell: (b) => b.name },
    { key: "characters", header: "Characters", numeric: true, cell: (b) => b.characters.toLocaleString("en-US") },
    { key: "kills", header: "Kills", numeric: true, cell: (b) => (b.kills === null ? PLACEHOLDER : b.kills.toLocaleString("en-US")) },
  ];
  const anyBossReported = bosses.some((b) => b.boss);
  const anyReport = anyBossReported || bosses.some((b) => b.reported);
  // On a phone the dense table keeps the boss name and folds the report into one line under it.
  // levelOf is the agreed creature level, defined with the columns below; the meta line is drawn after both.
  const bossMeta = (b: BossRow) => (b.boss
    ? `${levelOf(b) !== null ? `Level ${levelOf(b)} · ` : ""}${b.boss.kills.toLocaleString("en-US")} kills · ${b.boss.reporters} ${b.boss.reporters === 1 ? "install" : "installs"} · ${dayLabel(b.boss.lastSeen)}`
    : b.reported ? reportedLabel(b.reported) : "Not confirmed yet");

  // Loot, per boss: every boss above, with the loot table of each creature 3 installs tie to its encounter, the same
  // table its NPC page shows. A boss with no creature tied yet keeps its line, saying so.
  const lootBosses = bosses.map((b) => ({ encounterId: b.encounterId, name: b.name ?? `Encounter ${b.encounterId}`, href: bossHref(b.encounterId, b.name), npcIds: b.boss?.npcIds ?? [] }));
  const loot = unreachable || !lootBosses.some((b) => b.npcIds.length) ? null : await loadLootTables();
  const lootTables = new Map(loot && !loot.unreachable ? lootBosses.flatMap((b) => b.npcIds).map((id) => [id, npcLootTable(loot.tables, id)]) : []);
  // Each drop row's name, quality and icon as the item's own page and hover card show them (lib/item-look.ts).
  const droppedIds = [...lootTables.values()].flatMap((t) => t.rows.map((r) => r.itemId));
  const lootRows: InstanceLootRow[] = lootBosses.flatMap((b) => b.npcIds.flatMap((id) => (lootTables.get(id)?.rows ?? []).map((r) => ({ ...r, encounterId: b.encounterId }))));
  const look = droppedIds.length ? await loadItemLooks(assets, droppedIds) : null;
  // What the game files say of the ground here, and the gear whose effect works here (data/game-data/client-terrain.json).
  const terrain = instanceTerrain(row.instanceMapId);
  const gear = gearFor({ instance: row.instanceMapId });
  const gearIds = gear.flatMap((g) => g.set?.pieces ?? [g.itemId]);
  // Each gear row's name, quality and icon as the item's own page and hover card show them, as the drop rows.
  const gearLook = gearIds.length ? await loadItemLooks(assets, gearIds) : null;
  const [spellNames, setNames] = gear.length
    ? await Promise.all([loadSpellNames(CLIENT_LAYER.build.version), gear.some((g) => g.set) ? loadItemSetNames(CLIENT_LAYER.build.version) : null])
    : [null, null];

  // Quests: the ones 3 installs file under this instance's name in the quest log, from the stored world facts.
  const tied = lootBosses.some((b) => b.npcIds.length);
  const world = unreachable || (row.name === null && !tied) ? null : await loadWorldFacts();
  const renders = tied ? await loadRenders() : null;
  const quests = world && !world.unreachable && row.name !== null ? instanceQuests(world, row.name, asOf) : [];
  const npcName = world && !world.unreachable && (quests.length || tied) ? npcNames(world) : new Map<number, string>();
  // Per boss, from the creatures 3 installs tie to it: the first one's model picture, its level as 3 installs agree,
  // and the three items its rated loot tables drop most often. A boss with no creature tied has none of these.
  const npcsOf = (b: BossRow) => (unreachable ? [] : b.boss?.npcIds ?? []);
  const pictureOf = (b: BossRow) => {
    const id = npcsOf(b).find((n) => renders?.npcs.has(n));
    return id === undefined ? undefined : renders?.npcs.get(id);
  };
  const levelOf = (b: BossRow): number | null => {
    if (!world || world.unreachable) return null;
    for (const id of npcsOf(b)) {
      const level = agreedNpc(id, world)?.level ?? null;
      if (level !== null) return level;
    }
    return null;
  };
  const topDrops = (b: BossRow) => npcsOf(b).flatMap((id) => lootTables.get(id)?.rows ?? [])
    .sort((x, y) => y.rate - x.rate || y.withItem - x.withItem || x.itemId - y.itemId).slice(0, 3);
  const itemLink = (itemId: number) => { const x = look!(itemId); return <EntityLink kind="item" id={itemId} name={x.name?.name} icon={x.icon} quality={x.quality} unconfirmed={x.name?.source === "files"} />; };
  // A column no row has a report for is left out (filledColumns), as on the database lists: a files-only list
  // reads as names with their unconfirmed marker, not rows of [?].
  // A row 3 installs have not reported has nothing to show in the report columns: a dash, explained once under the table.
  const DASH = <span className="text-muted">—</span>;
  const bossColumns: SparseColumn<BossRow>[] = [
    // Each boss links its own page (lib/bosses.ts), by the name this table shows.
    { key: "name", header: "Boss", cell: (b) => {
      const name = <Link href={bossHref(b.encounterId, b.name)} className={link}>{b.name ?? `Encounter ${b.encounterId}`}</Link>;
      const shown = b.filesName ? <span className="inline-flex items-baseline gap-1.5"><Badge tone="files" />{name}</span> : name;
      const picture = pictureOf(b);
      return picture ? <span className="inline-flex items-center gap-2"><GameIcon src={picture.url} size={28} rounded="control" className="object-cover" />{shown}</span> : shown;
    } },
    { key: "level", header: "Level", numeric: true, blank: (b) => levelOf(b) === null, cell: (b) => levelOf(b) ?? DASH },
    { key: "kills", header: "Kills", numeric: true, blank: (b) => !b.boss, cell: (b) => (b.boss ? b.boss.kills.toLocaleString("en-US") : DASH) },
    // Short of 3, the count of installs that reported the encounter so far, beside the files' name: nothing else of theirs.
    { key: "installs", header: "Installs", blank: (b) => !b.boss && !b.reported, cell: (b) => (b.boss ? <AgreementMeter count={b.boss.reporters} withText /> : b.reported ? <AgreementMeter count={b.reported} withText /> : DASH) },
    { key: "seen", header: "Last seen", numeric: true, blank: (b) => !b.boss, cell: (b) => (b.boss ? dayLabel(b.boss.lastSeen) : DASH) },
    { key: "npcs", header: "Creatures", blank: (b) => !b.boss?.npcIds.length, cell: (b) => (b.boss?.npcIds.length
      ? b.boss.npcIds.map((id, i) => <span key={id}>{i > 0 && ", "}<Link href={`/database/npcs/${id}`} className={link}>NPC {id}</Link></span>)
      : DASH) },
    { key: "drops", header: "Top drops", blank: (b) => topDrops(b).length === 0, cell: (b) => (
      <span className="flex flex-col gap-1">{topDrops(b).map((r) => <span key={r.itemId}>{itemLink(r.itemId)}</span>)}</span>
    ) },
  ];
  const shownBossColumns = filledColumns(bossColumns, bosses);
  const npcLink = (id: number | null) => (id === null ? PLACEHOLDER : <Link href={`/database/npcs/${id}`} className={link}>{npcName.get(id) ?? `NPC ${id}`}</Link>);
  const questColumns: Column<InstanceQuest>[] = [
    { key: "quest", header: "Quest", cell: (q) => <Link href={`/database/quests/${q.questId}`} className={link}>{q.title ?? `Quest ${q.questId}`}</Link> },
    { key: "level", header: "Level", numeric: true, cell: (q) => q.level ?? PLACEHOLDER },
    { key: "giver", header: "Giver", cell: (q) => npcLink(q.giverNpcId) },
    { key: "turnin", header: "Turn-in", cell: (q) => npcLink(q.turnInNpcId) },
    { key: "installs", header: "Installs", cell: (q) => <AgreementMeter count={q.installs} /> },
    { key: "seen", header: "Last seen", numeric: true, cell: (q) => dayLabel(q.lastSeen) },
  ];

  // The page in a few lines, from the sections below only: what it is, what players reported with its agreement and
  // date, and what the game files list. Storage down: the player line says unrecorded, never zero.
  const count = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : null);
  const level = levelLabel(row.level);
  // The bosses counted against the table's rows when only some are confirmed, so the line and the Installs column agree.
  const someBosses = row.bosses.length > 0 && bosses.length > row.bosses.length;
  const bossCount = someBosses ? `${row.bosses.length} of ${bosses.length} bosses` : count(row.bosses.length, "boss", "bosses");
  const reported = unreachable ? [] : [bossCount, count(row.confirmed.length, "entrance", "entrances")];
  const lastSeen = unreachable ? null : [...row.bosses, ...row.confirmed].map((x) => x.lastSeen).filter((t): t is string => t !== null).sort().at(-1) ?? null;
  const filesList = [count(row.encounters.length, "encounter", "encounters"), count(row.files.length, "entrance", "entrances")].filter(Boolean);
  const summary = [
    `${row.raid === null ? "An instance" : row.raid ? "A raid" : "A dungeon"}${level ? `, level ${level} in the game files` : ""}.`,
    unreachable ? STORAGE_UNREACHABLE
      : reported.some(Boolean) ? `${observedLine(reported, lastSeen, Date.now())} ${someBosses ? "The confirmed ones have three installs agreeing, as the Bosses tab's Installs column shows." : "Each has three installs agreeing."}`
      : row.reported > 0 ? `Nothing here is confirmed yet: ${row.reported} ${row.reported === 1 ? "install has" : "installs have"} zoned in, and 3 must agree.`
      : observedLine([], null, Date.now()),
    filesList.length ? `The game files list ${filesList.join(" and ")}, unconfirmed until 3 installs report them.` : "The game files list no encounter or entrance for it.",
    ...(quests.length ? [`${quests.length} ${quests.length === 1 ? "quest" : "quests"} filed under its name in the quest log, each with three installs agreeing.`] : []),
  ];

  // The quick facts, as every database page lists them: label left, value right, the files' own value beside it.
  const filesNote = (text: string) => <span className="ml-2 inline-flex items-baseline gap-1.5 text-meta text-muted"><Badge tone="files" />{text}</span>;
  const players = groupSizeLabel(row.difficulties);
  // The entrance players confirmed, else the files' own: its outdoor zone and the spot on the map.
  const entrance = (unreachable ? undefined : row.confirmed[0]) ?? row.files[0];
  const facts: Fact[] = [
    ...(row.statisticBoss ? [{ label: "Name", value: <>{row.name}{filesNote("name from the game files; they place no entrance for it")}</> }] : []),
    { label: "Type", value: kindLabel(row.raid) },
    { label: "Level", value: levelLabel(row.level) ?? <span className="text-muted">–</span> },
    ...(players ? [{ label: "Players", value: <>{players}{filesNote("in the files, by difficulty")}</>, numeric: true }] : []),
    // An entrance is confirmed where 3 installs zoned in from the same outdoor map; installs that zoned in from
    // different places are counted, so the files' entrance says why it is still unconfirmed.
    ...(entrance ? [{ label: "Entrance", value: <>{placeCell(entrance)}{!row.confirmed.length && filesNote(unreachable || !row.reported ? "in the files"
      : row.reported >= 3 ? `in the files; ${row.reported} installs zoned in, not yet 3 from the same place`
      : `in the files; ${row.reported} of 3 installs zoned in`)}</> }] : []),
    // The difficulty 3 installs agree on, with the files' list beside it; with no agreement, the files' own names stand
    // as the value, labelled as theirs, rather than an unknown marker beside them.
    { label: "Difficulty", value: row.difficulty !== null
      ? <>{difficultyLabel(row.difficulty)}{row.difficulties.length > 0 && filesNote(`in the files, ${difficultyList(row.difficulties)}`)}</>
      : row.difficulties.length > 0 ? <>{difficultyList(row.difficulties)}{filesNote("from the game files")}</>
      : PLACEHOLDER },
    // The bosses 3 installs confirmed, out of the files' list when it holds them all.
    { label: "Bosses confirmed", value: <>
      {unreachable ? PLACEHOLDER : row.encounters.length >= row.bosses.length && row.encounters.length > 0 ? `${row.bosses.length} of ${row.encounters.length}` : row.bosses.length}
      {row.encounters.length > 0 && filesNote(`the game files list ${row.encounters.length}`)}
    </> },
  ];

  // The page's sections as tabs, like every other entity page. Each keeps its tab even when empty (no 0 count), so
  // its one line saying what is missing stays; a tab's count is its rows.
  const tabs: TabItem[] = [
    {
      id: "bosses", label: "Bosses", count: bosses.length || undefined,
      panel: (
        <DataTable
          dense caption={`Bosses players reported in ${title}, and the ones the game files list`} columns={shownBossColumns} rows={bosses} rowKey={(b) => String(b.encounterId)}
          meta={anyReport ? bossMeta : undefined}
          footer={anyBossReported && bosses.some((b) => !b.boss) ? "— means not reported by 3 installs yet."
            : bosses.length > 0 && !anyBossReported ? (unreachable
            ? "Players' reports cannot be shown right now; this list is the game files' own."
            : anyReport
              ? "No boss here has 3 installs reporting it yet. Kills and last seen show once one does."
              : "No boss here has 3 installs reporting it yet. Kills, installs and last seen show once one does.") : undefined}
          empty={empty(EMPTY.bosses)}
        />
      ),
    },
    {
      id: "loot", label: "Loot",
      panel: unreachable || loot?.unreachable ? <Unreachable />
        : lootBosses.length === 0 ? <EmptyTab message={EMPTY.bossLoot} players={false} action={null} />
        : (
          <div className="space-y-4">
            <InstanceLootPanel
              rows={lootRows}
              title={title}
              dataAsOf={loot?.dataAsOf ?? null}
              item={itemLink}
              boss={(id) => { const b = lootBosses.find((x) => x.encounterId === id)!; return <Link href={b.href} className={link}>{b.name}</Link>; }}
              pages={{ page: dropPage, href: (page) => `${listHref(canonical, [["drops", page === 1 ? undefined : String(page)]])}#loot` }}
            />
            {/* The bosses with no creature tied yet share one line, rather than the same sentence once per boss. */}
            {lootBosses.some((b) => b.npcIds.length === 0) && (
              <p data-boss-loot-pending className="text-meta text-fg-2">
                {"Not reported yet: "}
                {lootBosses.filter((b) => b.npcIds.length === 0).map((b, i) => <span key={b.encounterId}>{i > 0 && ", "}<Link href={b.href} className={link}>{b.name}</Link></span>)}
                {". Boss loot shows once 3 installs report which creature dropped it."}
              </p>
            )}
            {lootBosses.some((b) => b.npcIds.length > 0) && <ul className="space-y-1 text-meta">
              {lootBosses.filter((b) => b.npcIds.length > 0).map((b) => (
                <li key={b.encounterId} data-boss-loot={b.encounterId}>
                  <Link href={b.href} className={`${link} font-semibold`}>{b.name}</Link>
                  {b.npcIds.map((id) => {
                    const table = lootTables.get(id)!;
                    return (
                      <span key={id} className="ml-2 text-fg-2">
                        {"creature "}<Link href={`/database/npcs/${id}`} className={link}>{npcName.get(id) ?? `NPC ${id}`}</Link>{": "}
                        {table.state === "none" ? EMPTY.drops("this NPC")
                          : table.state === "short" ? <>{missingLine(table)} <AgreementMeter count={table.span.installs} withText /></>
                          : table.rows.length === 0 ? `No items observed in ${spanPhrase(table.span)}.`
                          : `${table.rows.length} ${table.rows.length === 1 ? "item" : "items"} in the table, out of ${spanPhrase(table.span)}.`}
                      </span>
                    );
                  })}
                </li>
              ))}
            </ul>}
          </div>
        ),
    },
    {
      id: "entrance", label: "Entrance",
      panel: <>
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
            rowKey={(p) => `${p.mapId}-${p.x}-${p.y}`} empty={empty(EMPTY.entrance(row.reported))}
          />
        )}
      </>,
    },
    {
      id: "quests", label: "Quests", count: quests.length || undefined,
      panel: unreachable || world?.unreachable ? <Unreachable /> : (
        <DataTable
          dense caption={`Quests players filed under ${title}`} columns={questColumns} rows={quests} rowKey={(q) => String(q.questId)}
          empty={empty(EMPTY.instanceQuests(row.name))}
        />
      ),
    },
    ...(clears ? [{
      id: "clears", label: "Clears", count: clears.clears.length || undefined,
      panel: <>
        <p className="mb-2 text-meta text-muted">From the boss kills linked characters sync through the Everloot Desktop App, public on their armory pages; up to the 500 with the newest kills here. A clear is a kill of every boss the game files list for it.</p>
        <p className="mb-3 text-sm text-fg-2">
          {clears.characters.toLocaleString("en-US")} linked {clears.characters === 1 ? "character has" : "characters have"} a synced kill here; {clears.clears.length.toLocaleString("en-US")} {clears.clears.length === 1 ? "has" : "have"} killed every boss.
          {clears.clears.length > 0 && <> <Link href={`/armory/clears/${row.instanceMapId}`} className={link} rel="nofollow">Recent clears</Link></>}
        </p>
        {clears.characters > 0 && (
          <DataTable dense caption={`Kills of each boss in ${title} by linked characters`} columns={clearColumns} rows={clears.bosses} rowKey={(b) => String(b.id)} />
        )}
      </>,
    }] : []),
    ...(terrain.length > 0 || gear.length > 0 ? [{
      id: "terrain", label: "Terrain", count: gear.length || undefined,
      panel: <div data-instance-terrain>
        <p className="mb-2 text-meta text-muted">Read from the game files, build {TERRAIN_BUILD}: the kinds of ground some item effects need, and the gear whose effect works here. Found in game files, unconfirmed.</p>
        {terrain.length > 0 && (
          <p className="mb-3 flex flex-wrap items-center gap-2 text-meta text-fg-2">
            {terrain.map((type) => (
              <Link prefetch={false} key={type.slug} href={`${TERRAIN_PATH}#${type.slug}`} className="inline-flex h-6 items-center rounded-full border border-line px-2.5 font-mono text-xs text-fg-2 hover:text-fg">{type.name}</Link>
            ))}
          </p>
        )}
        {gear.length > 0 && (
          <TerrainGearTable
            gear={gear}
            caption={`Gear whose effect works in ${title}`}
            names={{
              item: (id) => gearLook!(id),
              spell: (id) => spellNames?.names.get(id),
              set: (id) => setNames?.names.get(id),
              instances: new Map([...instanceRows()].map(([id, r]) => [id, r.name])),
            }}
          />
        )}
      </div>,
    }] : []),
  ];

  return (
    <EntityPage
      name={title}
      degraded={unreachable || !!world?.unreachable || !!loot?.unreachable}
      jsonLd={{ name: title, path: canonical, identifier: `instance:${row.instanceMapId}` }}
      header={{
        title,
        icon: <EntityIcon src={loading?.small?.url ?? loading?.url} cover />,
        meta: [kindLabel(row.raid), <span key="id" className="tabular-nums">Instance {row.instanceMapId}</span>],
        trail: [
          ...trailFor("/database/instances")!,
          { name: title, path: canonical },
        ],
      }}
      box={loading && <EntityArt src={loading.url} alt={`Loading screen of ${title}`} width={loading.width} height={Math.round((loading.width * 9) / 16)} />}
      facts={facts}
      notices={(prep || unreachable) && <>
        {prep && (
          <p className="mb-3 text-sm"><Link href={wikiHref(prep.slug)} className={link}>Prepare for this {prep.type === "raid" ? "raid" : "dungeon"}</Link></p>
        )}
        {unreachable && <p className="mb-3 text-meta text-warning">{STORAGE_UNREACHABLE} Players&apos; reports cannot be shown until it is back; the entrance below is from the game files.</p>}
      </>}
      summary={summary}
      main={
        <div className="space-y-6">
          <Disclosure as="h2" summary="How this is counted">
            <p>Facts: the type is from the game files where they place the entrance, else as 3 installs agree. The level is from the game files, which give one level for most instances rather than a range. The difficulty is the id 3 installs agree on; the game files' own list of the instance's difficulties shows beside it when they give one. Players is the group size the game files give those difficulties. The entrance is the one players confirmed, else the game files' own.</p>
            <p>Entrance: confirmed by the instance id, the last place outside where 3 installs stood before zoning in, at the median of their positions.</p>
            <p>Bosses: a boss is listed once 3 installs report its encounter ending here. Kills count every install's kills together; wipes are not kills. The encounters the game files list for this instance follow, marked unconfirmed until 3 installs report them.</p>
            <p>Loot: each boss's loot is the loot table of the creature 3 installs tie to its encounter, the same rows its NPC page shows, gathered into one table with the highest chance first; the Bosses tab shows each boss's three most frequent drops, and its creature's level and picture when 3 installs agree on the level and the site has a model picture. Rates show from one install, marked reported at one, verified at two, confirmed at three or more.</p>
            <p>Quests: a quest is listed once 3 installs file it under this instance's name in the quest log, where the game files a dungeon's quests. This matches the quest log's header, not the quest's giver or turn-in, so a quest filed under another header is not here. Installs counts the installs that agreed on the header.</p>
          </Disclosure>

          <Tabs label={`${title}: sections`} tabs={tabs} />
        </div>
      }
      related={<LoreSection match={lore} />}
      screenshots={<EntityScreenshots type="instance" id={row.instanceMapId} name={title} />}
      comments={<EntityComments type="instance" id={row.instanceMapId} />}
      // No per-instance JSON is served, so no Raw JSON link: the copy text is the record.
      openData={{ report: { type: "Instance", id: row.instanceMapId, path: canonical }, text: [`${title} (instance ${row.instanceMapId})`, ...summary, `Source: https://everloot.app${canonical}`].join("\n") }}
    />
  );
}
