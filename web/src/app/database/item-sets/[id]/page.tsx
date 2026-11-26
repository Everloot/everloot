import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { CLIENT_SKILLS } from "@kb/client-layer-file";
import { isDevelopmentItemName } from "@kb/dev-item-names";
import { categoryOf } from "@kb/item-taxonomy";
import EdgeDegraded from "@/components/EdgeDegraded";
import EntityLink from "@/components/EntityLink";
import JsonLd from "@/components/JsonLd";
import { Badge, Container, DataTable, Facts, InShort, OpenData, Tabs, TooltipFrame, TooltipLines, type Fact, type TabItem } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { classLabel, type ClassSlug } from "@/lib/class-context";
import { loadItemSetNames, loadItemTips, loadSiteAssets, loadSpellNames } from "@/lib/game-assets";
import { itemSet, itemSetClasses, itemSetHref, ITEM_SETS_BUILD } from "@/lib/item-sets";
import { CLIENT_LAYER, CLIENT_TAXONOMY, shownItemName } from "@/lib/items";
import { entityPageJsonLd } from "@/lib/jsonld";
import { professionHrefById } from "@/lib/professions";
import { pageMetadata } from "@/lib/seo";
import { loadShownNames } from "@/lib/shown-item-names";
import { CLIENT_LABEL } from "@kb/edges";
import { EmptyTab, EntityHeader, EntityLayout, EntitySidebar, EntityTop, LINK } from "../../entity";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const parse = (segment: string) => (/^[1-9]\d*$/.test(segment) ? Number(segment) : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function generateMetadata(props: Props): Promise<Metadata> {
  const id = parse((await props.params).id);
  const set = id === null ? undefined : itemSet(id);
  if (!set) return { robots: { index: false, follow: true } };
  const name = (await loadItemSetNames(CLIENT_LAYER.build.version))?.names.get(set.id);
  const title = name ?? `Item set ${set.id}`;
  return {
    ...pageMetadata({
      title: `${title} (item set)`,
      description: `The ${title} item set in WoW: Forever: its ${plural(set.items.length, "piece")} and ${plural(set.bonuses.length, "set bonus", "set bonuses")}. ${CLIENT_LABEL}.`,
      path: itemSetHref(set.id),
      image: `${itemSetHref(set.id)}/opengraph-image`,
    }),
    // A set the names file names is a page with something to say; one known only by its id is not indexed.
    robots: { index: Boolean(name), follow: true },
  };
}

/**
 * One item set from the game files (data/game-data/client-item-sets.json): its pieces with their icons, its bonuses
 * with the pieces each needs, the classes its pieces allow and the skill a crafted set asks for. The set and spell
 * names come from the private name files, pages only, and the piece names and icons follow the item name rule, as
 * on the item pages. Found in game files, unconfirmed.
 */
export default async function ItemSetPage(props: Props) {
  const id = parse((await props.params).id);
  const set = id === null ? undefined : itemSet(id);
  if (!set) notFound();
  const version = CLIENT_LAYER.build.version;
  const [setNames, spellNames, shown, assets] = await Promise.all([loadItemSetNames(version), loadSpellNames(version), loadShownNames(), loadSiteAssets()]);
  const { agreed, matched, showsTip, degraded } = shown;
  const name = setNames?.names.get(set.id);
  const title = name ?? `Item set ${set.id}`;
  const path = itemSetHref(set.id);
  const trail = [...trailFor("/database/item-sets")!, { name: title, path }];

  const pieceName = (item: number) => shownItemName(item, agreed, matched?.names);
  // A development leftover among the pieces stays out, as it does in the item lists; the line under the table counts it.
  const pieces = set.items.filter((item) => !isDevelopmentItemName(pieceName(item)?.name));
  const leftovers = set.items.length - pieces.length;
  const tips = await loadItemTips(assets, pieces.filter(showsTip));
  const spellName = (spell: number) => spellNames?.names.get(spell);
  const bonusLine = ([count, spell]: [number, number]) => `(${count}) Set: ${spellName(spell) ?? `Spell ${spell}`}`;
  const classes = itemSetClasses(set.items) as ClassSlug[] | null;
  const skill = set.skill ? { id: set.skill[0], rank: set.skill[1], name: CLIENT_SKILLS.get(set.skill[0]) ?? `Skill ${set.skill[0]}`, href: professionHrefById(set.skill[0]) } : null;

  const classLinks = classes?.length
    ? <span>{classes.map((c, i) => <span key={c}>{i > 0 && ", "}<Link prefetch={false} href={`/classes/${c}`} className={LINK}>{classLabel(c)}</Link></span>)}</span>
    : null;
  const facts: Fact[] = [
    { label: "Pieces", value: set.items.length, numeric: true },
    { label: "Set bonuses", value: set.bonuses.length, numeric: true },
    ...(classLinks ? [{ label: classes!.length === 1 ? "Class" : "Classes", value: classLinks }] : []),
    ...(skill ? [{ label: "Requires", value: <>{skill.href ? <Link prefetch={false} href={skill.href} className={LINK}>{skill.name}</Link> : skill.name}{skill.rank > 0 ? ` (${skill.rank})` : ""}</> }] : []),
    { label: "Build", value: ITEM_SETS_BUILD },
    { label: "ID", value: set.id, numeric: true },
  ];

  const summary = [
    `An item set of ${plural(set.items.length, "piece")} with ${plural(set.bonuses.length, "set bonus", "set bonuses")}${classes?.length ? `, for ${classes.map(classLabel).join(", ")}` : ""}${skill ? `, made with ${skill.name}` : ""}.`,
    `Found in game files, unconfirmed: read from build ${ITEM_SETS_BUILD}; players have not confirmed it in the game.`,
    name ? "The set's name and its bonuses' names are shown from the game files." : "The game files' name for this set could not be read just now.",
  ];

  type Piece = { item: number };
  type Bonus = { count: number; spell: number };
  const tabs: TabItem[] = [
    {
      id: "pieces", label: "Pieces", count: pieces.length,
      panel: (
        <>
          <DataTable
            dense
            caption={`Pieces of ${title}`}
            columns={[
              { key: "item", header: "Item", cell: ({ item }: Piece) => {
                const n = pieceName(item);
                return <span className="inline-flex flex-wrap items-center gap-1"><EntityLink kind="item" id={item} name={n?.name} icon={tips.get(item)?.icon} />{n?.source === "files" && <Badge tone="files" />}</span>;
              } },
              { key: "slot", header: "Slot", cell: ({ item }: Piece) => categoryOf(CLIENT_TAXONOMY, item)?.slot?.name ?? "—" },
              { key: "id", header: "ID", numeric: true, cell: ({ item }: Piece) => item },
            ]}
            meta={({ item }) => [categoryOf(CLIENT_TAXONOMY, item)?.slot?.name, `ID ${item}`].filter(Boolean).join(" · ")}
            rows={pieces.map((item) => ({ item }))}
            rowKey={({ item }) => String(item)}
          />
          {leftovers > 0 && <p className="py-2 text-meta text-fg-2">{`${plural(leftovers, "piece")} the game files mark as a development item ${leftovers === 1 ? "is" : "are"} left out.`}</p>}
        </>
      ),
    },
    {
      id: "bonuses", label: "Set bonuses", count: set.bonuses.length,
      panel: set.bonuses.length ? (
        <DataTable
          dense
          caption={`Set bonuses of ${title}`}
          columns={[
            { key: "count", header: "Pieces needed", numeric: true, nowrap: true, cell: ({ count }: Bonus) => count },
            { key: "spell", header: "Bonus", cell: ({ spell }: Bonus) => (
              <span className="inline-flex flex-wrap items-center gap-1"><EntityLink kind="spell" id={spell} name={spellName(spell)} icon={assets?.spellIcons.get(spell)} />{spellName(spell) && <Badge tone="files" />}</span>
            ) },
          ]}
          meta={({ count }) => `${count} pieces`}
          rows={set.bonuses.map(([count, spell]) => ({ count, spell }))}
          rowKey={({ count, spell }) => `${count}-${spell}`}
        />
      ) : <EmptyTab message="The game files list no bonus for this set." players={false} action={null} />,
    },
  ];

  return (
    <Container width="data">
      <EdgeDegraded when={degraded || !setNames} />
      <JsonLd data={entityPageJsonLd({ name: title, path, identifier: `item_set:${set.id}` })} />
      <EntityLayout>
        <EntityHeader
          trail={trail}
          title={title}
          meta={["Item set", plural(set.items.length, "piece"), <span key="id" className="tabular-nums">ID {set.id}</span>, <Badge key="files" tone="files" />]}
        />
        <EntityTop
          box={
            <TooltipFrame name={title} label={`${title}, ${CLIENT_LABEL.toLowerCase()}`}>
              <TooltipLines lines={[plural(set.items.length, "piece"), ...set.bonuses.map(bonusLine)]} />
            </TooltipFrame>
          }
          facts={<Facts layout="list" label={`${title}: quick facts`} items={facts} />}
        />
        <EntitySidebar>
          <InShort summary="In short" bullets={summary} note={<Link href="/database#reading" className={LINK}>How to read these numbers</Link>} />
          <OpenData report={{ type: "Item set", id: set.id, path }} text={[`${title} (item set ${set.id})`, ...summary, ...set.bonuses.map(bonusLine), `Source: https://everloot.app${path}`].join("\n")} />
        </EntitySidebar>
        <Tabs label={`${title}: pieces and bonuses`} tabs={tabs} className="mt-6" />
        <p className="mt-6 text-meta text-muted">{GAME_DATA_CREDIT}</p>
      </EntityLayout>
    </Container>
  );
}
