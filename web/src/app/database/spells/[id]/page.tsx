import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { entityPageJsonLd } from "@/lib/jsonld";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container, DataTable, Facts, InShort, OpenData, Tabs, TooltipFrame, type Column, type TabItem } from "@/components/ui";
import { EmptyTab, EntityHeader, EntityTop, LINK } from "../../entity";
import { entitySummary, evidenceLine } from "@/lib/evidence";
import { loadEdges } from "@/lib/edges";
import { loadSiteAssets, loadSpellNames } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@/lib/items";
import { edgesFrom, edgesTo, type Edge, type Rel } from "../../../../../../kb/src/edges";
import { entityLabel } from "../../../../../../kb/src/edges";
import { trailFor } from "@/lib/breadcrumbs";
import { spellIndexable } from "@/lib/indexable";
import { loadSpellTalents, type SpellTalent } from "@/lib/talents/spell-talents";
import { DESCRIPTION_MAX, pageMetadata } from "@/lib/seo";

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
 * What the page reads about one spell. The spell is unknown, a 404 rather than an empty page, when the game
 * files' spell names are loaded and do not hold it, it has no tooltip and no relation points from or to it.
 * Without the names file, or with upload storage out of reach, nothing can be ruled out.
 */
async function loadSpell(spellId: number) {
  const [edges, assets, spellNames, talentIndex] = await Promise.all([
    loadEdges(),
    loadSiteAssets(),
    loadSpellNames(CLIENT_LAYER.build.version),
    loadSpellTalents(),
  ]);
  const both = [...edges.observed, ...edges.client];
  // Both directions: the files store what a spell creates and what it costs on the item (item -> created_by
  // or reagent_for -> spell), and what teaches it on the spell (spell -> in_skill_line -> skill).
  const all = [...edgesFrom(both, "spell", spellId), ...edgesTo(both, "spell", spellId)];
  const name = spellNames?.names.get(spellId);
  const tip = assets?.spellTips.get(spellId);
  const talents = talentIndex.get(spellId) ?? [];
  const unknown = spellNames !== null && !edges.unreachable && name === undefined && !tip && !all.length && !talents.length;
  return { edges, assets, all, name, tip, talents, unknown };
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
    }),
    robots: { index: spellIndexable({ named: Boolean(name ?? tip?.name), text: Boolean(tip?.text), relations: all.length, talents: talents.length }), follow: true },
  };
}

export default async function SpellPage(props: Props) {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) notFound();
  const spellId = Number(params.id);
  const { edges, assets, all, name, tip, talents, unknown } = await loadSpell(spellId);
  if (unknown) notFound();
  const rel = (r: Rel) => all.filter((e) => e.rel === r);
  const icon = assets?.spellIcons.get(spellId);
  const title = name ?? tip?.name ?? `Spell ${spellId}`;
  const build = edges.client.find((e) => e.fromId === spellId || e.toId === spellId)?.build ?? CLIENT_LAYER.build.version;

  const creates = rel("created_by");
  const costs = rel("reagent_for");
  const taught = rel("in_skill_line");

  // The page in three lines: what it is, what the files say it does, and where the name came from.
  const summary = entitySummary({
    identity: [tip?.name ?? name, `Spell ${spellId}`].filter(Boolean).join(" · "),
    observed: creates.length
      ? `The files say it creates ${creates.length} ${creates.length === 1 ? "item" : "items"}${costs.length ? ` and costs ${costs.length} ${costs.length === 1 ? "reagent" : "reagents"}` : ""}.`
      : "The files say nothing about what it creates.",
    named: Boolean(name),
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

  const tabs = [
    relationTab("creates", relLabel.created_by!, "created_by"),
    relationTab("costs", relLabel.reagent_for!, "reagent_for"),
    relationTab("taught-by", relLabel.in_skill_line!, "in_skill_line"),
    relationTab("reward-from", relLabel.reward_from!, "reward_from"),
    talents.length
      ? { id: "talent", label: "Talent", count: talents.length, panel: <>{talents.map((t) => <TalentFacts key={`${t.classSlug}-${t.tree}-${t.row}-${t.col}`} talent={t} title={title} />)}</> }
      : null,
  ].filter((t): t is TabItem => t !== null);

  const trail = [...trailFor("/database/spells")!, { name: title, path: `/database/spells/${spellId}` }];

  return (
    <Container width="data">
      <article>
        <JsonLd data={entityPageJsonLd({ name: title, path: `/database/spells/${spellId}`, identifier: `spell:${spellId}` })} />
        <EntityHeader trail={trail} title={title} meta={["Spell", <span key="id" className="tabular-nums">ID {spellId}</span>]} />
        <EntityTop
          box={
            <TooltipFrame name={tip?.name ?? title} label={`${tip?.name ?? title}, from the game files`}>
              {tip?.text ? <p>{tip.text}</p> : <p>No text for this spell in the client files.</p>}
            </TooltipFrame>
          }
          facts={
            <Facts
              layout="list"
              label={`${title}: quick facts`}
              items={[
                { label: "Spell id", value: <span className="tabular-nums">{spellId}</span>, numeric: true },
                { label: "Build", value: build },
                // Counts from the files, so a zero is a zero and not an agreement meter waiting on a report.
                { label: "Creates", value: <span className="tabular-nums">{creates.length}</span>, numeric: true },
                { label: "Costs", value: <span className="tabular-nums">{costs.length}</span>, numeric: true },
              ]}
            />
          }
        />
        <InShort summary="In short" bullets={summary} note={<Link href="/database#reading" className={LINK}>How to read these numbers</Link>} />
        <OpenData
          text={[`${title} (spell ${spellId})`, tip?.text ?? "", ...summary, `Source: https://everloot.app/database/spells/${spellId}`].filter(Boolean).join("\n")}
        />
        {tabs.length
          ? <Tabs label={`${title}: relations`} tabs={tabs} className="mt-6" />
          : <EmptyTab message={`The game files list nothing here (build ${build}).`} players={false} action={null} />}
      </article>
    </Container>
  );
}
