import type { Metadata } from "next";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { dayLabel } from "@/lib/report-labels";
import AdSlot from "@/components/AdSlot";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasCard } from "@/lib/tooltip";
import { agreedNpc, npcPage, questPage, questTraits } from "@kb/world-pages";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { pinLink } from "@/lib/world-map";
import { trailFor } from "@/lib/breadcrumbs";
import { agreementLabel, reportedLabel, Badge, DataTable, Tabs } from "@/components/ui";
import { EMPTY, EmptyTab, EntityPage, known, LINK, MAP_LINK_HEADER, ShowOnMap, Unreachable } from "../../entity";
import EntityMap from "../../EntityMap";
import { entityMapZones, type MapMark } from "../../entity-map";
import { unknownQuest } from "../../unknown";
import { entitySummary, observedLine } from "@/lib/evidence";
import { loadItemFacts } from "@/lib/rollup-compute";
import { itemNames, npcNames } from "@/lib/names";
import { loreFor } from "@/lib/lore-links";
import { loadItemTips, loadQuestNames, loadSiteAssets } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@kb/client-layer-file";
import { GAME_NAME_TITLE } from "@/components/EntityRelations";
import EntityLink from "@/components/EntityLink";
import LoreSection from "@/components/LoreSection";
import { questIndexable } from "@/lib/indexable";
import { entityTitle, questDescription } from "@/lib/entity-meta";
import { chainHref, loadCatalog } from "@/lib/completion-lists";
import { CLIENT_QUEST_LINES } from "@/data/game-data/client-quest-lines";
import { publicZones, zoneByMapId, zoneHref } from "@/lib/zones";
import { questTypeLabel, SIDE_LABEL, SIDE_TONE } from "@/lib/world-lists";
import GameIcon from "@/components/game/GameIcon";
import { QUALITY_TEXT, type Quality } from "@/components/ui/quality";
import { QUALITIES } from "@/design/tokens";
import QuestChainFlow from "@/components/QuestChainFlow";
import EntityComments from "@/components/comments/EntityComments";
import EntityScreenshots from "@/components/screenshots/EntityScreenshots";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) return { robots: { index: false, follow: true } };
  const [facts, wiki] = await Promise.all([loadWorldFacts(), loadQuestNames(CLIENT_LAYER.build.version)]);
  const page = questPage(Number(params.id), facts);
  if (unknownQuest(page.questId, facts, wiki)) notFound();
  const title = (!facts.unreachable && page.title) || wiki?.names.get(page.questId)?.name || `Quest ${params.id}`;
  const shown = facts.unreachable ? null : page;
  const description = questDescription({
    name: title, id: page.questId, level: shown?.level ?? null, giver: shown?.giverNpcId != null, turnIn: shown?.turnInNpcId != null, rewards: shown?.rewards.length ?? 0,
  });
  return {
    ...pageMetadata({ title: entityTitle(title, "quest"), description, path: `/database/quests/${params.id}`, image: `/database/quests/${page.questId}/opengraph-image` }),
    robots: { index: questIndexable(page, facts.unreachable), follow: true },
  };
}

interface Person { role: string; npcId: number; map: { href: string; mapId: number; x: number; y: number; reporters: number } | null }

export default async function QuestPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) notFound();
  const [facts, wiki] = await Promise.all([loadWorldFacts(), loadQuestNames(CLIENT_LAYER.build.version)]);
  const page = questPage(Number(params.id), facts);
  if (unknownQuest(page.questId, facts, wiki)) notFound();
  // Side, category and type (tag, group size), each once 3 installs agree; nothing guessed from the title or giver.
  const traits = facts.unreachable ? questTraits([]) : questTraits(facts.quests.filter((r) => r.questId === page.questId && r.installId.trim()), facts);
  const typeLabel = questTypeLabel(traits);
  const categoryZone = traits.category ? publicZones().find((z) => z.name === traits.category) : undefined;
  const sideChip = traits.side && <span key="side" className={SIDE_TONE[traits.side]}>{SIDE_LABEL[traits.side]}</span>;
  const category = traits.category && (categoryZone
    ? <Link key="category" href={zoneHref(categoryZone.mapId, categoryZone.name)} className={LINK}>{traits.category}</Link>
    : traits.category);
  // Where players saw the giver and the turn-in NPC stand, as map links, when 3 installs agree.
  const where = (npcId: number | null) => {
    const pin = npcId === null || facts.unreachable ? undefined : npcPage(npcId, facts).pins.find((p) => pinLink(p.mapId, p.x, p.y));
    const href = pin ? pinLink(pin.mapId, pin.x, pin.y) : null;
    return pin && href ? { href, mapId: pin.mapId, x: pin.x, y: pin.y, reporters: pin.reporters } : null;
  };
  // The title players agree on; else the Warcraft Wiki's, for a quest the game files list (docs/DATA_POLICY.md).
  const reported = facts.unreachable ? null : page.title;
  const wikiTitle = reported ? undefined : wiki?.names.get(page.questId)?.name;
  const title = reported ?? wikiTitle ?? `Quest ${page.questId}`;
  // Names for the giver, the turn-in and the rewards; icons for the rewards when the game files have them.
  const npcs = facts.unreachable ? new Map<number, string>() : npcNames(facts);
  const itemFacts = facts.unreachable || page.rewards.length === 0 ? null : await loadItemFacts();
  const items = itemFacts && !itemFacts.unreachable ? itemNames(itemFacts) : new Map<number, string>();
  // Every position 3 installs agree on for the giver and the turn-in NPC, for the map slot; the Givers table is its text.
  const marks: MapMark[] = facts.unreachable ? [] : ([["giver", page.giverNpcId], ["turnin", page.turnInNpcId]] as const).flatMap(([kind, npcId]) =>
    npcId === null ? [] : npcPage(npcId, facts).pins.map((p) => ({ kind, mapId: p.mapId, x: p.x, y: p.y, label: npcs.get(npcId) ?? `NPC ${npcId}`, agreed: true })));
  const assets = page.rewards.length > 0 || marks.length > 0 ? await loadSiteAssets() : null;
  const mapZones = entityMapZones(marks, assets?.maps);
  const tips = await loadItemTips(assets, facts.unreachable ? [] : page.rewards);
  const lore = !facts.unreachable && page.title ? await loreFor("quest", page.questId, page.title) : null;
  const trail = [...trailFor("/database/quests")!, { name: title, path: `/database/quests/${page.questId}` }];
  const people: Person[] = facts.unreachable ? [] : [
    ...(page.giverNpcId !== null ? [{ role: "Start", npcId: page.giverNpcId, map: where(page.giverNpcId) }] : []),
    ...(page.turnInNpcId !== null ? [{ role: "End", npcId: page.turnInNpcId, map: where(page.turnInNpcId) }] : []),
  ];
  const npcLink = (id: number) => <EntityLink kind="npc" id={id} name={npcs.get(id)} />;
  const catalog = await loadCatalog();
  const chains = catalog?.chains.filter((c) => c.questIds.includes(page.questId)) ?? [];
  const chain = chains[0];
  const questName = (id: number) => questPage(id, facts).title ?? wiki?.names.get(id)?.name;
  const position = chain?.questIds.indexOf(page.questId) ?? -1;
  const previous = chain?.questIds[position - 1];
  const next = chain?.questIds[position + 1];
  const giverPin = people.find((p) => p.role === "Start")?.map;
  const zone = giverPin ? zoneByMapId(giverPin.mapId) : undefined;
  const zoneDate = giverPin && page.giverNpcId !== null ? agreedNpc(page.giverNpcId, facts)?.pinDates.find(([mapId]) => mapId === giverPin.mapId)?.[1] : undefined;
  const chainDate = chain?.confirmed ? catalog?.dataAsOf : CLIENT_QUEST_LINES.build.extractedAt;

  const named = title !== `Quest ${page.questId}`;
  // The title's own source: players' agreed title, else the Warcraft Wiki's, else none.
  const nameFrom = reported ? "players" : wikiTitle ? "wiki" : "none";
  // The page in three lines: what it is, what players reported, and where the title came from.
  const summary = entitySummary({
    identity: [
      page.level !== null ? `Level ${page.level}` : null,
      page.giverNpcId !== null ? "has a giver" : null,
      page.turnInNpcId !== null ? "and a turn-in" : null,
    ].filter((x): x is string => Boolean(x)).join(" · ") || "A quest the game files list",
    observed: observedLine(
      [page.rewards.length ? `${page.rewards.length} ${page.rewards.length === 1 ? "reward" : "rewards"}` : null],
      null,
      Date.now(),
    ),
    nameFrom,
  });

  return (
    <EntityPage
      name={title}
      degraded={facts.unreachable || !catalog?.confirmations}
      jsonLd={{ name: title, path: `/database/quests/${page.questId}`, identifier: `quest:${page.questId}` }}
      header={{
        trail,
        title,
        meta: [
          "Quest", !facts.unreachable && page.level !== null ? `Level ${page.level}` : null, sideChip, typeLabel || null, category, named ? <span key="id" className="tabular-nums">ID {page.questId}</span> : null,
          // A title from the wiki carries the quiet unconfirmed marker; its source is a tooltip, never a printed label.
          wikiTitle ? <Badge key="wiki" tone="files">{`${GAME_NAME_TITLE.wiki.toLowerCase()}, unconfirmed`}</Badge> : null,
        ],
      }}
      // No box: its level, type, side and category are the header's type line again.
      facts={!facts.unreachable && [
        { label: "Reported title", value: known(page.title) },
        { label: "Level", value: known(page.level), numeric: true },
        { label: "Side", value: known(sideChip || null) },
        // Most quests carry no tag, so a missing type is not news: the row shows only when 3 installs agree on one.
        ...(typeLabel ? [{ label: "Type", value: typeLabel }] : []),
        { label: "Category", value: known(category || null) },
        { label: "Chain", value: chain ? <>
          <Link href={chainHref(chain.questLineId, chain.name)} className={LINK}>{chain.name}</Link>
          {chains.length > 1 && <span> (also in {chains.length - 1} other {chains.length === 2 ? "chain" : "chains"})</span>}
          <span className="block text-muted">{chain.confirmed ? "Player reports" : CLIENT_QUEST_LINES.label} · {catalog?.confirmations ? reportedLabel(chain.reporters) : "player reports could not be read just now"} · {dayLabel(chainDate)}</span>
        </> : !catalog?.confirmations ? STORAGE_UNREACHABLE : known(null) },
        ...(previous !== undefined ? [{ label: "Previous quest", value: <EntityLink kind="quest" id={previous} name={questName(previous)} /> }] : []),
        ...(next !== undefined ? [{ label: "Next quest", value: <EntityLink kind="quest" id={next} name={questName(next)} /> }] : []),
        { label: "Zone", value: zone ? <>
          <Link href={zoneHref(zone.mapId, zone.name)} className={LINK}>{zone.name}</Link>
          <span className="block text-muted">Player reports (giver location) · {agreementLabel(giverPin!.reporters)} · latest report: {dayLabel(zoneDate)}</span>
        </> : known(null) },
        { label: "Start", value: known(page.giverNpcId !== null ? npcLink(page.giverNpcId) : null) },
        { label: "End", value: known(page.turnInNpcId !== null ? npcLink(page.turnInNpcId) : null) },
        { label: "Rewards", value: known(page.rewards.length ? `${page.rewards.length} items` : null) },
      ]}
      summary={summary}
      map={mapZones.length > 0 && <EntityMap name={title} zones={mapZones} />}
      main={<>{chain && (
        <QuestChainFlow questIds={chain.questIds} current={page.questId} name={chain.name} href={chainHref(chain.questLineId, chain.name)} nameOf={questName} truncated={chain.truncated} />
      )}<Tabs
        label={`${title}: relations`}
        tabs={[
          {
            id: "rewards", label: "Rewards", count: facts.unreachable ? undefined : page.rewards.length,
            panel: facts.unreachable ? <Unreachable />
              : page.rewards.length ? (<>
                <DataTable
                  dense
                  caption={`Rewards of ${title}`}
                  columns={[{ key: "item", header: "Item", cell: (itemId: number) => <RewardLink itemId={itemId} name={items.get(itemId) ?? tips.get(itemId)?.name} tip={tips.get(itemId)} /> }]}
                  rows={page.rewards}
                  rowKey={String}
                />
                <p className="mt-2 text-meta text-muted">Items players received for this quest. The reports don&apos;t say which rewards were a choice.</p>
              </>)
              : <EmptyTab message={EMPTY.rewards} />,
          },
          {
            id: "givers", label: "Start and end", count: facts.unreachable ? undefined : people.length,
            panel: facts.unreachable ? <Unreachable />
              : people.length ? (
                <DataTable
                  dense
                  caption={`Who gives and takes ${title}`}
                  columns={[
                    { key: "role", header: "Role", nowrap: true, cell: (p: Person) => p.role },
                    { key: "npc", header: "NPC", cell: (p: Person) => npcLink(p.npcId) },
                    { key: "map", header: MAP_LINK_HEADER, cell: (p: Person) => (p.map ? <ShowOnMap {...p.map} /> : null) },
                  ]}
                  rows={people}
                  rowKey={(p) => p.role}
                />
              )
              : <EmptyTab message={EMPTY.givers} />,
          },
        ]}
      /></>}
      related={<>
        <LoreSection match={lore} />
        {!facts.unreachable && page.title !== null && <AdSlot slot="inContent" />}
      </>}
      screenshots={<EntityScreenshots type="quest" id={page.questId} name={title} />}
      comments={<EntityComments type="quest" id={page.questId} />}
      openData={{
        report: { type: "Quest", id: page.questId, path: `/database/quests/${page.questId}` },
        text: [`${title} (quest ${page.questId})`, ...summary, `Source: https://everloot.app/database/quests/${page.questId}`].join("\n"),
        jsonHref: !facts.unreachable && hasCard.quest(page) ? `/api/tooltip/quest/${page.questId}` : undefined,
      }}
    />
  );
}

const qualityOf = (name: string | undefined): Quality | undefined => {
  const key = name?.toLowerCase() ?? "";
  return (QUALITIES as readonly string[]).includes(key) ? (key as Quality) : undefined;
};

/** A reward as the game lists it: the icon in a quality-coloured border and the name in the quality's colour. */
function RewardLink({ itemId, name, tip }: { itemId: number; name: string | undefined; tip: { icon: string | null; quality: string } | undefined }) {
  const quality = qualityOf(tip?.quality);
  return (
    <span className="inline-flex items-center gap-2">
      {tip?.icon ? <GameIcon src={tip.icon} size={24} quality={quality} /> : null}
      <Link href={`/database/items/${itemId}`} prefetch={false} className={`${quality ? QUALITY_TEXT[quality] : "text-fg"} underline decoration-edge underline-offset-4 hover:decoration-fg`}>{name || `Item ${itemId}`}</Link>
    </span>
  );
}
