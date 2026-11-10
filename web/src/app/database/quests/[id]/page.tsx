import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { entityPageJsonLd } from "@/lib/jsonld";
import AdSlot from "@/components/AdSlot";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasCard } from "@/lib/tooltip";
import { npcPage, questPage } from "../../../../../../kb/src/world-pages";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { pinLink } from "@/lib/world-map";
import { trailFor } from "@/lib/breadcrumbs";
import { Badge, Container, DataTable, Facts, InShort, OpenData, Tabs, TooltipFrame } from "@/components/ui";
import { EmptyTab, EntityHeader, EntityTop, known, LINK, MAP_LINK_HEADER, ShowOnMap, Unreachable } from "../../entity";
import { unknownQuest } from "../../unknown";
import { entitySummary, observedLine } from "@/lib/evidence";
import { loadItemFacts } from "@/lib/rollup-compute";
import { itemNames, npcNames } from "@/lib/names";
import { loreFor } from "@/lib/lore-links";
import { loadItemTips, loadQuestNames, loadSiteAssets } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@/lib/items";
import { GAME_NAME_TITLE } from "@/components/EntityRelations";
import EntityLink from "@/components/EntityLink";
import LoreSection from "@/components/LoreSection";
import { questIndexable } from "@/lib/indexable";
import { entityTitle, questDescription } from "@/lib/entity-meta";

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

interface Person { role: string; npcId: number; map: { href: string; mapId: number; x: number; y: number } | null }

export default async function QuestPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) notFound();
  const [facts, wiki] = await Promise.all([loadWorldFacts(), loadQuestNames(CLIENT_LAYER.build.version)]);
  const page = questPage(Number(params.id), facts);
  if (unknownQuest(page.questId, facts, wiki)) notFound();
  // Where players saw the giver and the turn-in NPC stand, as map links, when 3 installs agree.
  const where = (npcId: number | null) => {
    const pin = npcId === null || facts.unreachable ? undefined : npcPage(npcId, facts).pins.find((p) => pinLink(p.mapId, p.x, p.y));
    const href = pin ? pinLink(pin.mapId, pin.x, pin.y) : null;
    return pin && href ? { href, mapId: pin.mapId, x: pin.x, y: pin.y } : null;
  };
  // The title players agree on; else the Warcraft Wiki's, for a quest the game files list (docs/DATA_POLICY.md).
  const reported = facts.unreachable ? null : page.title;
  const wikiTitle = reported ? undefined : wiki?.names.get(page.questId)?.name;
  const title = reported ?? wikiTitle ?? `Quest ${page.questId}`;
  // Names for the giver, the turn-in and the rewards; icons for the rewards when the game files have them.
  const npcs = facts.unreachable ? new Map<number, string>() : npcNames(facts);
  const itemFacts = facts.unreachable || page.rewards.length === 0 ? null : await loadItemFacts();
  const items = itemFacts && !itemFacts.unreachable ? itemNames(itemFacts) : new Map<number, string>();
  const assets = page.rewards.length > 0 ? await loadSiteAssets() : null;
  const tips = await loadItemTips(assets, facts.unreachable ? [] : page.rewards);
  const lore = !facts.unreachable && page.title ? await loreFor("quest", page.questId, page.title) : null;
  const trail = [...trailFor("/database/quests")!, { name: title, path: `/database/quests/${page.questId}` }];
  const people: Person[] = facts.unreachable ? [] : [
    ...(page.giverNpcId !== null ? [{ role: "Giver", npcId: page.giverNpcId, map: where(page.giverNpcId) }] : []),
    ...(page.turnInNpcId !== null ? [{ role: "Turn-in", npcId: page.turnInNpcId, map: where(page.turnInNpcId) }] : []),
  ];
  const npcLink = (id: number) => <EntityLink kind="npc" id={id} name={npcs.get(id)} />;

  const named = title !== `Quest ${page.questId}`;
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
    named,
  });

  return (
    <Container width="data">
      <article>
        <JsonLd data={entityPageJsonLd({ name: title, path: `/database/quests/${page.questId}`, identifier: `quest:${page.questId}` })} />
        <EntityHeader
          trail={trail}
          title={title}
          meta={[
            "Quest", !facts.unreachable && page.level !== null ? `Level ${page.level}` : null, named ? <span key="id" className="tabular-nums">ID {page.questId}</span> : null,
            // A title from the wiki carries the quiet unconfirmed marker; its source is a tooltip, never a printed label.
            wikiTitle ? <Badge key="wiki" tone="files">{`${GAME_NAME_TITLE.wiki.toLowerCase()}, unconfirmed`}</Badge> : null,
          ]}
        />
        <EntityTop
          // No box without an agreed level: the quick facts' Level row carries its meter, and a frame with only the
          // title would repeat the heading.
          box={!facts.unreachable && page.level !== null && (
            <TooltipFrame name={title} label={wikiTitle ? `${title}, ${GAME_NAME_TITLE.wiki.toLowerCase()}` : `${title}, as players saw it`}>
              <p>Level {page.level}</p>
            </TooltipFrame>
          )}
          facts={!facts.unreachable && (
            <Facts
              layout="list"
              label={`${title}: quick facts`}
              items={[
                { label: "Reported title", value: known(page.title) },
                { label: "Level", value: known(page.level), numeric: true },
                { label: "Giver", value: known(page.giverNpcId !== null ? npcLink(page.giverNpcId) : null) },
                { label: "Turn-in", value: known(page.turnInNpcId !== null ? npcLink(page.turnInNpcId) : null) },
                { label: "Rewards", value: known(page.rewards.length ? `${page.rewards.length} items` : null) },
              ]}
            />
          )}
        />
        <InShort summary="In short" bullets={summary} note={<Link href="/database#reading" className={LINK}>How to read these numbers</Link>} />
        <OpenData
          text={[`${title} (quest ${page.questId})`, ...summary, `Source: https://everloot.app/database/quests/${page.questId}`].join("\n")}
          jsonHref={!facts.unreachable && hasCard.quest(page) ? `/api/tooltip/quest/${page.questId}` : undefined}
        />
        <Tabs
          className="mt-6"
          label={`${title}: relations`}
          tabs={[
            {
              id: "rewards", label: "Rewards", count: facts.unreachable ? undefined : page.rewards.length,
              panel: facts.unreachable ? <Unreachable />
                : page.rewards.length ? (
                  <DataTable
                    dense
                    caption={`Rewards of ${title}`}
                    columns={[{ key: "item", header: "Item", cell: (itemId: number) => <EntityLink kind="item" id={itemId} name={items.get(itemId) ?? tips.get(itemId)?.name} icon={tips.get(itemId)?.icon} /> }]}
                    rows={page.rewards}
                    rowKey={String}
                  />
                )
                : <EmptyTab message="No agreed rewards yet. A reward shows once 3 installs report it." />,
            },
            {
              id: "givers", label: "Giver and turn-in", count: facts.unreachable ? undefined : people.length,
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
                : <EmptyTab message="No agreed giver or turn-in yet. Each shows once 3 installs report it." />,
            },
          ]}
        />
        <div className="mt-6 space-y-6 empty:hidden">
          <LoreSection match={lore} />
          {!facts.unreachable && page.title !== null && <AdSlot slot="inContent" />}
        </div>
      </article>
    </Container>
  );
}
