import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { npcLootTable } from "@kb/loot-tables";
import { CLIENT_LABEL } from "@kb/edges";
import EntityLink from "@/components/EntityLink";
import { AgreementMeter, Badge, DataTable, Disclosure, Tabs, TooltipFrame, TooltipLines, type Column, type Fact, type TabItem } from "@/components/ui";
import { bossEntry, bossHref, type BossEntry } from "@/lib/bosses";
import { trailFor } from "@/lib/breadcrumbs";
import { observedLine } from "@/lib/evidence";
import { entityTitle } from "@/lib/entity-meta";
import { loadItemTips, loadSiteAssets } from "@/lib/game-assets";
import { loadRenders } from "@/lib/game-renders";
import { difficultyLabel, difficultyList, instanceHref, instanceRows, instanceTitle, loadSightings, parseInstanceSegment } from "@/lib/instances";
import { PLACEHOLDER } from "@/lib/item-names";
import { itemNames, npcNames } from "@/lib/names";
import { loadInstanceClears } from "@/lib/progression";
import { dayLabel } from "@/lib/report-labels";
import { loadItemFacts, loadLootTables, loadWorldFacts } from "@/lib/rollup-compute";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { EmptyTab, EntityPage, known, LINK, ModelPicture, Unreachable } from "../../entity";
import { NpcLootPanel } from "../../loot-tables";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ boss: string }> };

/** The boss, from its instance's boss table with what players reported when storage answers; null for an id no listed instance has. */
async function find(segment: string): Promise<{ boss: BossEntry; unreachable: boolean; asOf?: Date } | null> {
  const id = parseInstanceSegment(segment);
  if (id === null) return null;
  const seen = await loadSightings();
  const boss = bossEntry(id, instanceRows(seen.unreachable ? {} : seen));
  return boss ? { boss, unreachable: seen.unreachable, asOf: seen.unreachable ? undefined : seen.asOf } : null;
}

const kindOf = (boss: BossEntry) => (boss.instance.raid === null ? "Boss" : boss.instance.raid ? "Raid boss" : "Dungeon boss");

export async function generateMetadata(props: Props): Promise<Metadata> {
  const found = await find((await props.params).boss);
  if (!found) return { robots: { index: false, follow: true } };
  const { boss, unreachable } = found;
  const instance = instanceTitle(boss.instance);
  return {
    ...pageMetadata({
      title: entityTitle(boss.name, "boss"),
      description: `${boss.name}, a boss of ${instance} in WoW: Forever: its place in the instance, the creature players fought, its loot and its kills.`,
      path: bossHref(boss.id, boss.row.name),
      image: `${bossHref(boss.id, boss.row.name)}/opengraph-image`,
    }),
    // Storage down: noindex rather than cache a page without its player reports.
    robots: { index: !unreachable, follow: true },
  };
}

/**
 * One boss (a dungeon or raid encounter): where it is fought and in what order from the game files, and from player
 * reports the creature 3 installs tie to it, its kills, its loot (the creature's own loot table, as its NPC page and
 * the instance page show it) and linked characters' synced kills as counts. Names are the files' unless 3 installs
 * agree on one. The files of this build carry no encounter journal, so no abilities are listed.
 */
export default async function BossPage(props: Props) {
  const segment = (await props.params).boss;
  const found = await find(segment);
  if (!found) notFound();
  const { boss, unreachable } = found;
  const path = bossHref(boss.id, boss.row.name);
  if (`/database/bosses/${segment}` !== path) permanentRedirect(path);
  const title = boss.name;
  const reported = unreachable ? null : boss.row.boss;
  const npcIds = reported?.npcIds ?? [];
  const instance = boss.instance;
  const instanceName = instanceTitle(instance);
  const instancePath = instanceHref(instance.instanceMapId, instance.name);
  const instanceLink = <Link href={instancePath} className={LINK}>{instanceName}</Link>;

  // The creature's loot table, the same rows its NPC page shows; item names and icons as there.
  const [loot, world, clears, renders] = await Promise.all([
    npcIds.length ? loadLootTables() : null,
    npcIds.length ? loadWorldFacts() : null,
    loadInstanceClears(instance.instanceMapId),
    npcIds.length ? loadRenders() : null,
  ]);
  const tables = new Map(loot && !loot.unreachable ? npcIds.map((id) => [id, npcLootTable(loot.tables, id)]) : []);
  const droppedIds = [...tables.values()].flatMap((t) => t.rows.map((r) => r.itemId));
  const itemFacts = droppedIds.length ? await loadItemFacts() : null;
  const names = itemFacts && !itemFacts.unreachable ? itemNames(itemFacts) : new Map<number, string>();
  const tips = await loadItemTips(droppedIds.length ? await loadSiteAssets() : null, droppedIds);
  const npcName = world && !world.unreachable ? npcNames(world) : new Map<number, string>();
  const creature = (id: number) => <EntityLink kind="npc" id={id} name={npcName.get(id) ?? `NPC ${id}`} />;
  // The first creature with a model picture; renders.json lists only creatures the site lists.
  const pictured = npcIds.find((id) => renders?.npcs.has(id));
  const picture = pictured === undefined ? undefined : renders?.npcs.get(pictured);
  const killsHere = clears?.bosses.find((b) => b.id === boss.id) ?? null;

  const filesNote = (note: string) => <span className="ml-2 inline-flex items-baseline gap-1.5 text-meta text-muted"><Badge tone="files" />{note}</span>;
  const order = boss.order === null ? null : `${boss.order} of ${boss.total}`;
  const difficulty = boss.difficultyId !== null
    ? <>{difficultyLabel(boss.difficultyId)}{filesNote("in the files, for this encounter")}</>
    : instance.difficulties.length ? <>{difficultyList(instance.difficulties)}{filesNote("the instance's, in the files")}</> : PLACEHOLDER;
  const facts: Fact[] = [
    { label: "Instance", value: instanceLink },
    { label: "Type", value: kindOf(boss) },
    { label: "Order", value: order ?? PLACEHOLDER, numeric: order !== null },
    { label: "Difficulty", value: difficulty },
    { label: "Kills reported", value: unreachable ? PLACEHOLDER : known(reported ? reported.kills.toLocaleString("en-US") : null, boss.row.reported), numeric: Boolean(reported) },
    ...(reported ? [
      { label: "Installs", value: <AgreementMeter count={reported.reporters} /> },
      { label: "Last seen", value: dayLabel(reported.lastSeen), numeric: true },
    ] : []),
    { label: npcIds.length === 1 ? "Creature" : "Creatures", value: npcIds.length ? <span>{npcIds.map((id, i) => <span key={id}>{i > 0 && ", "}{creature(id)}</span>)}</span> : unreachable ? PLACEHOLDER : known(null, boss.row.reported) },
    { label: "Encounter ID", value: boss.id, numeric: true },
  ];

  const summary = [
    `A boss of ${instanceName}${order ? `, ${order} in the game files' order` : ""}.`,
    unreachable ? STORAGE_UNREACHABLE
      : reported ? `${observedLine([`${reported.kills.toLocaleString("en-US")} kills`], reported.lastSeen, Date.now())} Three installs agree.`
      : boss.row.reported ? `Not confirmed yet: ${boss.row.reported} of 3 installs reported it.`
      : "No install has reported this boss yet.",
    boss.filesName ? `${CLIENT_LABEL}: the name and order are read from the game files.` : "The name is the one 3 installs agree on.",
  ];

  type Other = BossEntry;
  const others = instance.encounters.map((e) => bossEntry(e.id, new Map([[instance.instanceMapId, instance]]))).filter((b): b is Other => b !== undefined);
  const otherColumns: Column<Other>[] = [
    { key: "order", header: "Order", numeric: true, cell: (b) => b.order ?? PLACEHOLDER },
    { key: "boss", header: "Boss", cell: (b) => (b.id === boss.id
      ? <span className="font-semibold text-fg">{b.name}</span>
      : <Link href={bossHref(b.id, b.row.name)} className={LINK}>{b.name}</Link>) },
  ];
  const noCreature = "Not reported yet: no creature is tied to this boss. Its loot shows once 3 installs report which creature they fought in the encounter.";

  const tabs: TabItem[] = [
    {
      id: "loot", label: "Loot",
      panel: unreachable || loot?.unreachable ? <Unreachable />
        : npcIds.length === 0 ? <EmptyTab message={noCreature} reported={boss.row.reported} />
        : (
          <div className="space-y-4">
            {npcIds.map((id) => (
              <div key={id} data-boss-loot={id}>
                <p className="pt-1 text-meta">{creature(id)}</p>
                <NpcLootPanel
                  table={tables.get(id)!}
                  title={title}
                  dataAsOf={loot!.dataAsOf}
                  item={(itemId) => <EntityLink kind="item" id={itemId} name={names.get(itemId) ?? tips.get(itemId)?.name} icon={tips.get(itemId)?.icon} />}
                />
              </div>
            ))}
          </div>
        ),
    },
    ...(clears ? [{
      id: "kills", label: "Kills",
      panel: <>
        <p className="mb-2 text-meta text-muted">From the boss kills linked characters sync through the Everloot Desktop App, public on their armory pages; up to the 500 with the newest kills in {instanceName}. Counts only.</p>
        <p className="text-sm text-fg-2">
          {killsHere && killsHere.characters > 0
            ? `${killsHere.characters.toLocaleString("en-US")} linked ${killsHere.characters === 1 ? "character has" : "characters have"} killed this boss${killsHere.kills === null ? "." : `, ${killsHere.kills.toLocaleString("en-US")} ${killsHere.kills === 1 ? "kill" : "kills"} in all.`}`
            : "No linked character has a synced kill of this boss yet."}
        </p>
      </>,
    }] : []),
    {
      id: "instance", label: `In ${instanceName}`, count: others.length || undefined,
      panel: <DataTable dense caption={`Bosses of ${instanceName}, in the game files' order`} columns={otherColumns} rows={others} rowKey={(b) => String(b.id)} />,
    },
  ];

  return (
    <EntityPage
      name={title}
      degraded={unreachable || !!loot?.unreachable || !!world?.unreachable}
      jsonLd={{ name: title, path, identifier: `boss:${boss.id}` }}
      header={{
        trail: [...trailFor("/database/bosses")!, { name: title, path }],
        title,
        meta: [kindOf(boss), instanceLink, <span key="id" className="tabular-nums">Encounter {boss.id}</span>, boss.filesName ? <Badge key="files" tone="files" /> : null],
      }}
      box={
        <TooltipFrame name={title} label={`${title}, ${boss.filesName ? CLIENT_LABEL.toLowerCase() : "as players reported it"}`}>
          <TooltipLines lines={[instanceName, ...(order ? [`Boss ${order}`] : [])]} />
        </TooltipFrame>
      }
      facts={facts}
      media={picture && <ModelPicture picture={picture} name={title} />}
      summary={summary}
      main={
        <div className="space-y-6">
          <Disclosure as="h2" summary="How this is counted">
            <p>The name, the instance and the order are the game files&apos; encounter list (DungeonEncounter), unconfirmed until 3 installs report the boss. The files of this build carry no encounter journal, so no abilities are listed.</p>
            <p>Kills and the creature: a boss is confirmed once 3 installs report its encounter ending; kills count every install&apos;s kills together, and the creature is the one 3 installs tie to the encounter.</p>
            <p>Loot: the loot table of that creature, the same rows its NPC page shows. Rates show from one install, marked reported at one, verified at two, confirmed at three or more.</p>
          </Disclosure>
          <Tabs label={`${title}: sections`} tabs={tabs} />
        </div>
      }
      openData={{ report: { type: "Boss", id: boss.id, path }, text: [`${title} (boss ${boss.id})`, ...summary, `Source: https://everloot.app${path}`].join("\n") }}
      credit={<p className="mt-3 text-meta text-muted">{GAME_DATA_CREDIT}</p>}
    />
  );
}
