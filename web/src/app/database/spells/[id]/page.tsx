import { NAME_FROM } from "@/lib/items";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DataTable, Facts, Tabs, TooltipFrame, type Column, type TabItem } from "@/components/ui";
import { EMPTY, EmptyTab, EntityPage, LINK } from "../../entity";
import EntityChanges, { changesFor } from "../../entity-changes";
import { EntityIcon } from "@/components/game/EntityIcon";
import { entitySummary, evidenceLine } from "@/lib/evidence";
import { CLIENT_LAYER } from "@kb/client-layer-file";
import type { Edge, Rel } from "@kb/edges";
import { entityLabel } from "@kb/edges";
import { trailFor } from "@/lib/breadcrumbs";
import { spellIndexable } from "@/lib/indexable";
import type { SpellTalent } from "@/lib/talents/spell-talents";
import { DESCRIPTION_MAX, pageMetadata } from "@/lib/seo";
import EntityComments from "@/components/comments/EntityComments";
import EntityScreenshots from "@/components/screenshots/EntityScreenshots";
import EntityLink from "@/components/EntityLink";
import { isDevelopmentItemName } from "@kb/dev-item-names";
import { classLabel } from "@/lib/class-context";
import { mountHref, petHref } from "@/lib/collectibles";
import { loadItemSetNames, loadItemTips } from "@/lib/game-assets";
import { itemSetHref } from "@/lib/item-sets";
import { shownItemName } from "@/lib/items";
import { loadShownNames } from "@/lib/shown-item-names";
import {
  costText, dispelName, durationText, effectValue, ITEM_TRIGGER, mechanicName, schoolNames, spellNumbers, spellRanks, spellUses,
  SPELLS_BUILD, timeText, tooltipRows,
} from "@/lib/spell-card";
import { loadSpell } from "./load-spell";

/**
 * A spell page. The spell is the game's own data: its name, its text and its relations all come
 * from the client files of one build, so the page says which build and never claims a player saw
 * it. What players reported is a different page: the items and the quests.
 */
type Props = { params: Promise<{ id: string }> };

const relLabel: Record<string, string> = {
  created_by: "Creates",
  reagent_for: "Costs",
  in_skill_line: "Taught by",
  reward_from: "Reward from",
};

/**
 * The other end of one of the spell's relations: the target of one the spell starts (taught by), the item of
 * one that points at the spell (an item created by it, a reagent for it).
 */
const otherEnd = (e: Edge) => (e.toKind === "spell" ? { kind: e.fromKind, id: e.fromId } : { kind: e.toKind, id: e.toId });

/** Where a spell''s relation target has a page, a link to it; otherwise the kind and the id. */
function SpellTarget({ edge }: { edge: Edge }) {
  const { kind, id } = otherEnd(edge);
  const label = entityLabel(kind, id);
  const href = kind === "item" ? `/database/items/${id}`
    : kind === "npc" ? `/database/npcs/${id}`
    : kind === "quest" ? `/database/quests/${id}`
    : kind === "object" ? `/database/objects/${id}`
    : null;
  return href ? <Link href={href} className={LINK}>{label}</Link> : <span>{label}</span>;
}

const relationColumns: Column<Edge>[] = [
  { key: "to", header: "What", cell: (e) => <SpellTarget edge={e} /> },
  { key: "build", header: "Build", cell: (e) => e.build ?? "—" },
];

/** The row gate as the catalog states it: the points, and where they count when the files say. */
function gateText(t: SpellTalent): string {
  if (!t.gate) return "None";
  const where = t.gate.scope === "class" ? "in the class" : `in ${t.tree}`;
  return `${t.gate.points} ${where}${t.gate.scope === "unconfirmed" ? " (where they count is unconfirmed)" : ""}`;
}

/** Where the spell sits in a talent tree, from the committed talent catalog, with a link to that class's calculator. */
function TalentFacts({ talent, title }: { talent: SpellTalent; title: string }) {
  return (
    <div className="mb-6 min-w-0 sm:max-w-[280px] lg:max-w-[584px]">
      <p className="mb-2 text-meta text-fg-2">From the talent catalog, build {talent.build}: {talent.label}.</p>
      <Facts
        layout="list"
        label={`${title}: ${talent.className} talent`}
        items={[
          { label: "Class", value: <Link href={`/tools/talents/${talent.classSlug}`} className={LINK}>{talent.className} talent calculator</Link> },
          { label: "Tree", value: talent.tree },
          { label: "Row", value: talent.row, numeric: true },
          { label: "Column", value: talent.col, numeric: true },
          { label: "Ranks", value: talent.maxRanks, numeric: true },
          ...(talent.tier !== null ? [{ label: "Tier", value: talent.tier, numeric: true }] : []),
          { label: "Points spent first", value: gateText(talent) },
        ]}
      />
    </div>
  );
}

/**
 * The description from the name the files give, cut at a word when a long name leaves no room; the shape the other
 * database pages take (the lead sentence, what the page holds, the id). Without a name it says where the id comes from.
 */
function spellDescription(name: string | undefined, id: number): string {
  if (!name) return `Spell ${id} from the WoW: Forever client files: what it creates, what it costs and which talent teaches it, with the build it was read from.`;
  const lead = `${name} is a spell in WoW: Forever.`;
  const full = `${lead} What it creates, what it costs and which profession teaches it, from the game files. Spell ID ${id}.`;
  if (full.length <= DESCRIPTION_MAX) return full;
  // Eight characters shorter than the full form at most is not enough: the short form must still clear DESCRIPTION_MIN
  // at the name length where the full one first fails, so it keeps "what it costs" and drops only the source clause.
  const short = `${lead} What it creates, what it costs and who teaches it. Spell ID ${id}.`;
  return short.length <= DESCRIPTION_MAX ? short : `${short.slice(0, DESCRIPTION_MAX - 1).replace(/\s+\S*$/, "")}…`;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) return { robots: { index: false, follow: true } };
  const { all, name, tip, talents, unknown } = await loadSpell(Number(params.id));
  if (unknown) notFound();
  const shown = name ?? tip?.name ?? undefined;
  return {
    ...pageMetadata({
      // The item pages' title shape, "Blizzard – WoW Forever spell"; the layout adds "· Everloot" once.
      title: shown ? `${shown} – WoW Forever spell` : `Spell ${params.id}`,
      description: spellDescription(shown, Number(params.id)),
      path: `/database/spells/${params.id}`,
      image: `${`/database/spells/${params.id}`}/opengraph-image`,
    }),
    robots: { index: spellIndexable({ named: Boolean(name ?? tip?.name), text: Boolean(tip?.text), relations: all.length, talents: talents.length }), follow: true },
  };
}

export default async function SpellPage(props: Props) {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) notFound();
  const spellId = Number(params.id);
  const { edges, assets, all, name, tip, icon, talents, unknown, fromWiki, spellNames } = await loadSpell(spellId);
  if (unknown) notFound();
  // The tooltip numbers and what uses the spell, from the committed game-data files (lib/spell-card.ts).
  const numbers = spellNumbers(spellId);
  const ranks = spellRanks(spellId);
  const rank = ranks.length > 1 ? ranks.indexOf(spellId) + 1 : 0;
  const uses = spellUses(spellId);
  const schools = schoolNames(numbers?.school);
  const rows = numbers ? tooltipRows(numbers) : [];
  const duration = durationText(numbers?.durationMs);
  // Items follow the item name rule, as on the item pages: one the rule does not show yet is counted, never listed.
  const [shown, setNames] = await Promise.all([
    uses.items.length ? loadShownNames() : null,
    uses.sets.length ? loadItemSetNames(CLIENT_LAYER.build.version) : null,
  ]);
  const itemName = (item: number) => (shown ? shownItemName(item, shown.agreed, shown.matched?.names) : undefined);
  const tipped = shown ? uses.items.filter((u) => shown.showsTip(u.item)) : [];
  // A development leftover stays out, as in the item lists and on the item set pages; the line under the table counts it.
  const shownItems = tipped.filter((u) => !isDevelopmentItemName(itemName(u.item)?.name));
  const leftovers = tipped.length - shownItems.length;
  const itemTips = shownItems.length ? await loadItemTips(assets, [...new Set(shownItems.map((u) => u.item))]) : new Map<number, { icon: string | null }>();
  const spellName = (id: number) => spellNames?.names.get(id);
  const rel = (r: Rel) => all.filter((e) => e.rel === r);
  const title = name ?? tip?.name ?? `Spell ${spellId}`;
  const build = edges.client.find((e) => e.fromId === spellId || e.toId === spellId)?.build ?? CLIENT_LAYER.build.version;

  const creates = rel("created_by");
  const costs = rel("reagent_for");

  // The page in three lines: what it is, what the files say it does, and where the name came from.
  const summary = entitySummary({
    identity: [tip?.name ?? name, `Spell ${spellId}`].filter(Boolean).join(" · "),
    observed: creates.length
      ? `The files say it creates ${creates.length} ${creates.length === 1 ? "item" : "items"}${costs.length ? ` and costs ${costs.length} ${costs.length === 1 ? "reagent" : "reagents"}` : ""}.`
      : "The files say nothing about what it creates.",
    // Spell names come from the game files' names (or their tooltips); a wiki name only when the files have none.
    nameFrom: fromWiki ? "wiki" : name ? "files" : "none",
  });

  // Every relation here is the game files' own, so an empty one is not something a player report could fill: the tab
  // is left out rather than shown with the agreement meter and "Get the addon". When the files relate nothing to the
  // spell, one plain line names the build that was read instead of the tab strip.
  const relationTab = (id: string, label: string, r: Rel): TabItem | null => {
    const rows = rel(r);
    if (!rows.length) return null;
    return {
      id, label, count: rows.length,
      panel: <><p className="mb-2 text-meta text-fg-2">{evidenceLine(rows[0]!, Date.now())}</p><DataTable dense caption={`${label}: ${title}`} columns={relationColumns} rows={rows} rowKey={(e) => { const o = otherEnd(e); return `${e.rel}-${e.evidence}-${o.kind}-${o.id}`; }} /></>,
    };
  };

  const filesLine = <p className="mb-2 text-meta text-fg-2">From the game files, build {SPELLS_BUILD}; found in game files, unconfirmed.</p>;
  const hidden = uses.items.length - tipped.length;
  type RankRow = { spell: number; rank: number };
  type ItemRow = { item: number; trigger: number };
  type SetRow = { set: number; pieces: number };
  type EffectRow = NonNullable<NonNullable<typeof numbers>["effects"]>[number];

  const tabs = [
    talents.length
      ? { id: "talent", label: "Talent", count: talents.length, panel: <>{talents.map((t) => <TalentFacts key={`${t.classSlug}-${t.tree}-${t.row}-${t.col}`} talent={t} title={title} />)}</> }
      : null,
    ranks.length > 1 ? {
      id: "ranks", label: "Ranks", count: ranks.length,
      panel: <>{filesLine}<DataTable dense caption={`Ranks of ${title}`} rows={ranks.map((spell, i) => ({ spell, rank: i + 1 }))} rowKey={(r) => String(r.spell)} columns={[
        { key: "rank", header: "Rank", nowrap: true, cell: (r: RankRow) => `Rank ${r.rank}` },
        { key: "spell", header: "Spell", cell: (r: RankRow) => r.spell === spellId
          ? <span aria-current="true" className="font-semibold text-fg">{spellName(r.spell) ?? `Spell ${r.spell}`} (this spell)</span>
          : <EntityLink kind="spell" id={r.spell} name={spellName(r.spell)} icon={assets?.spellIcons.get(r.spell)} /> },
        { key: "level", header: "Spell level", numeric: true, cell: (r: RankRow) => spellNumbers(r.spell)?.level ?? "—" },
        { key: "cost", header: "Cost", cell: (r: RankRow) => spellNumbers(r.spell)?.costs?.map((c) => costText(c)).join(", ") ?? "—" },
      ]} /></>,
    } : null,
    uses.items.length ? {
      id: "items", label: "Items", count: shownItems.length,
      panel: <>
        {filesLine}
        {shownItems.length > 0 && <DataTable dense caption={`Items that cast ${title}`} rows={shownItems} rowKey={(r) => `${r.item}-${r.trigger}`} columns={[
          { key: "item", header: "Item", cell: (r: ItemRow) => <EntityLink kind="item" id={r.item} name={itemName(r.item)?.name} icon={itemTips.get(r.item)?.icon} /> },
          { key: "how", header: "Line", nowrap: true, cell: (r: ItemRow) => ITEM_TRIGGER[r.trigger] ?? "—" },
        ]} />}
        {hidden > 0 && <p className="py-2 text-meta text-fg-2">{`${hidden} ${hidden === 1 ? "item" : "items"} the game files list ${hidden === 1 ? "is" : "are"} not shown yet: an item's page and its lines show once players report it or a source names it.`}</p>}
        {leftovers > 0 && <p className="py-2 text-meta text-fg-2">{`${leftovers} ${leftovers === 1 ? "item" : "items"} the game files mark as a development item ${leftovers === 1 ? "is" : "are"} left out.`}</p>}
      </>,
    } : null,
    uses.sets.length ? {
      id: "item-sets", label: "Item sets", count: uses.sets.length,
      panel: <>{filesLine}<DataTable dense caption={`Item sets whose bonus is ${title}`} rows={uses.sets} rowKey={(r) => `${r.set}-${r.pieces}`} columns={[
        { key: "set", header: "Set", cell: (r: SetRow) => <Link prefetch={false} href={itemSetHref(r.set)} className={LINK}>{setNames?.names.get(r.set) ?? `Item set ${r.set}`}</Link> },
        { key: "pieces", header: "Pieces needed", numeric: true, cell: (r: SetRow) => r.pieces },
      ]} /></>,
    } : null,
    uses.mounts.length ? {
      id: "mounts", label: "Mount", count: uses.mounts.length,
      panel: <>{filesLine}<ul className="space-y-1">{uses.mounts.map((m) => <li key={m.id}><Link prefetch={false} href={mountHref(m.id, m.name)} className={LINK}>{m.name}</Link>{m.ridingSkill ? <span className="text-fg-2">{` · riding skill ${m.ridingSkill}`}</span> : null}</li>)}</ul></>,
    } : null,
    uses.pets.length ? {
      id: "pets", label: "Companion", count: uses.pets.length,
      panel: <>{filesLine}<ul className="space-y-1">{uses.pets.map((p) => <li key={p.id}><Link prefetch={false} href={petHref(p.id, p.name)} className={LINK}>{p.name}</Link></li>)}</ul></>,
    } : null,
    relationTab("creates", relLabel.created_by!, "created_by"),
    relationTab("costs", relLabel.reagent_for!, "reagent_for"),
    relationTab("taught-by", relLabel.in_skill_line!, "in_skill_line"),
    relationTab("reward-from", relLabel.reward_from!, "reward_from"),
    numbers?.effects?.length ? {
      id: "effects", label: "Effect values", count: numbers.effects.length,
      panel: <>
        <p className="mb-2 text-meta text-fg-2">The numbers behind the tooltip text, effect by effect, from the game files (build {SPELLS_BUILD}). The files do not name what each effect does.</p>
        <DataTable dense caption={`Effect values of ${title}`} rows={numbers.effects} rowKey={(e) => String(e[0])} columns={[
          { key: "effect", header: "Effect", numeric: true, cell: (e: EffectRow) => e[0] + 1 },
          { key: "value", header: "Value", numeric: true, cell: (e: EffectRow) => effectValue(e) },
          { key: "period", header: "Every", cell: (e: EffectRow) => (e[3] ? timeText(e[3]) : "—") },
          { key: "radius", header: "Radius", cell: (e: EffectRow) => (e[5] ? `${e[5]} yd` : "—") },
          { key: "chain", header: "Chain targets", numeric: true, cell: (e: EffectRow) => e[4] || "—" },
        ]} />
      </>,
    } : null,
  ].filter((t): t is TabItem => t !== null);

  const trail = [...trailFor("/database/spells")!, { name: title, path: `/database/spells/${spellId}` }];
  // What the build watch recorded about this spell, build by build; the slot stays out when it never changed.
  const changes = changesFor({ kind: "spell", id: spellId });

  return (
    <EntityPage
      name={title}
      jsonLd={{ name: title, path: `/database/spells/${spellId}`, identifier: `spell:${spellId}` }}
      header={{
        trail,
        icon: <EntityIcon src={icon} />,
        title: fromWiki ? <span title={NAME_FROM.wiki}>{title}<span className="sr-only">. {NAME_FROM.wiki}</span></span> : title,
        meta: ["Spell", <span key="id" className="tabular-nums">ID {spellId}</span>],
      }}
      box={
        <TooltipFrame
          name={rank ? <span className="flex justify-between gap-4"><span>{tip?.name ?? title}</span><span className="font-normal text-fg-2">Rank {rank}</span></span> : tip?.name ?? title}
          label={`${tip?.name ?? title}, from the game files`}
        >
          {rows.map((r, i) => (
            <p key={i} data-tip-pair className="flex justify-between gap-4 text-fg">
              <span>{r.left}</span>
              {r.left && r.right && <span className="sr-only">, </span>}
              <span className="text-right">{r.right}</span>
            </p>
          ))}
          {tip?.text ? <p className="text-tip-yellow">{tip.text}</p> : <p>No text for this spell in the client files.</p>}
          {(schools.length > 0 || duration) && (
            <div className="mt-1 text-muted">
              {schools.length > 0 && <p>School: {schools.join(", ")}</p>}
              {duration && <p>Duration: {duration}</p>}
            </div>
          )}
        </TooltipFrame>
      }
      facts={[
        ...(schools.length ? [{ label: "School", value: schools.join(", ") }] : []),
        // A talent's level is its row in the tree, shown on the Talent tab; the files' spell level would read as a second gate.
        ...(numbers?.level && !talents.length ? [{ label: "Spell level", value: <span className="tabular-nums">{numbers.level}</span>, numeric: true }] : []),
        ...(uses.classes.length ? [{
          label: uses.classes.length === 1 ? "Class" : "Classes",
          value: <span>{uses.classes.map((c, i) => <span key={c}>{i > 0 && ", "}<Link prefetch={false} href={`/classes/${c}`} className={LINK}>{classLabel(c)}</Link></span>)}</span>,
        }] : []),
        ...(talents.length ? [{ label: "Talent tree", value: [...new Set(talents.map((t) => `${t.className} · ${t.tree}`))].join(", ") }] : []),
        ...(numbers && dispelName(numbers) ? [{ label: "Dispel type", value: dispelName(numbers)! }] : []),
        ...(numbers && mechanicName(numbers) ? [{ label: "Mechanic", value: mechanicName(numbers)! }] : []),
        { label: "Spell id", value: <span className="tabular-nums">{spellId}</span>, numeric: true },
        { label: "Build", value: build },
        // Counts from the files; a spell that creates or costs nothing leaves the row out, as every empty fact above does.
        ...(creates.length ? [{ label: "Creates", value: <span className="tabular-nums">{creates.length}</span>, numeric: true }] : []),
        ...(costs.length ? [{ label: "Costs", value: <span className="tabular-nums">{costs.length}</span>, numeric: true }] : []),
      ]}
      summary={summary}
      main={tabs.length
        ? <Tabs label={`${title}: relations`} tabs={tabs} />
        : <EmptyTab message={EMPTY.files(build)} players={false} action={null} />}
      changes={changes.length ? <EntityChanges changes={changes} name={title} /> : undefined}
      screenshots={<EntityScreenshots type="spell" id={spellId} name={title} />}
      comments={<EntityComments type="spell" id={spellId} />}
      openData={{
        report: { type: "Spell", id: spellId, path: `/database/spells/${spellId}`, build },
        text: [`${title} (spell ${spellId})`, tip?.text ?? "", ...summary, `Source: https://everloot.app/database/spells/${spellId}`].filter(Boolean).join("\n"),
      }}
    />
  );
}
