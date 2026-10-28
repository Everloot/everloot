import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container, DataTable, Facts, InShort, OpenData, Tabs, TooltipFrame, type Column, type TabItem } from "@/components/ui";
import { EmptyTab, EntityHeader, EntityTop, known, LINK } from "../../entity";
import { entitySummary, evidenceLine } from "@/lib/evidence";
import { loadEdges } from "@/lib/edges";
import { loadSiteAssets, loadSpellNames } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@/lib/items";
import { edgesFrom, edgesTo, type Edge, type Rel } from "../../../../../../kb/src/edges";
import { entityLabel } from "../../../../../../kb/src/edges";
import { trailFor } from "@/lib/breadcrumbs";
import { spellIndexable } from "@/lib/indexable";

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

/**
 * What the page reads about one spell. The spell is unknown, a 404 rather than an empty page, when the game
 * files' spell names are loaded and do not hold it, it has no tooltip and no relation points from or to it.
 * Without the names file, or with upload storage out of reach, nothing can be ruled out.
 */
async function loadSpell(spellId: number) {
  const [edges, assets, spellNames] = await Promise.all([
    loadEdges(),
    loadSiteAssets(),
    loadSpellNames(CLIENT_LAYER.build.version),
  ]);
  const both = [...edges.observed, ...edges.client];
  // Both directions: the files store what a spell creates and what it costs on the item (item -> created_by
  // or reagent_for -> spell), and what teaches it on the spell (spell -> in_skill_line -> skill).
  const all = [...edgesFrom(both, "spell", spellId), ...edgesTo(both, "spell", spellId)];
  const name = spellNames?.names.get(spellId);
  const tip = assets?.spellTips.get(spellId);
  const unknown = spellNames !== null && !edges.unreachable && name === undefined && !tip && !all.length;
  return { edges, assets, all, name, tip, unknown };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) return { robots: { index: false, follow: true } };
  const { all, name, tip, unknown } = await loadSpell(Number(params.id));
  if (unknown) notFound();
  return {
    title: `Spell ${params.id} · Everloot`,
    description: `Spell ${params.id} from the WoW: Forever client files: what it creates, what it costs and which talent teaches it, with the build it was read from.`,
    alternates: { canonical: `/database/spells/${params.id}` },
    robots: { index: spellIndexable({ named: Boolean(name ?? tip?.name), text: Boolean(tip?.text), relations: all.length }), follow: true },
  };
}

export default async function SpellPage(props: Props) {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) notFound();
  const spellId = Number(params.id);
  const { edges, assets, all, name, tip, unknown } = await loadSpell(spellId);
  if (unknown) notFound();
  const rel = (r: Rel) => all.filter((e) => e.rel === r);
  const icon = assets?.spellIcons.get(spellId);
  const title = name ?? tip?.name ?? `Spell ${spellId}`;
  const build = edges.client.find((e) => e.fromId === spellId || e.toId === spellId)?.build ?? CLIENT_LAYER.build.version;

  const creates = rel("created_by");
  const costs = rel("reagent_for");
  const taught = rel("in_skill_line");
  const rewards = rel("reward_from");

  // The page in three lines: what it is, what the files say it does, and where the name came from.
  const summary = entitySummary({
    identity: [tip?.name ?? name, `Spell ${spellId}`].filter(Boolean).join(" · "),
    observed: creates.length
      ? `The files say it creates ${creates.length} ${creates.length === 1 ? "item" : "items"}${costs.length ? ` and costs ${costs.length} ${costs.length === 1 ? "reagent" : "reagents"}` : ""}.`
      : "The files say nothing about what it creates.",
    named: Boolean(name),
  });

  const relationTab = (id: string, label: string, r: Rel, empty: string): TabItem => {
    const rows = rel(r);
    return {
      id, label, count: rows.length,
      panel: rows.length
        ? <><p className="mb-2 text-meta text-fg-2">{evidenceLine(rows[0]!, Date.now())}</p><DataTable dense caption={`${label}: ${title}`} columns={relationColumns} rows={rows} rowKey={(e) => { const o = otherEnd(e); return `${e.rel}-${e.evidence}-${o.kind}-${o.id}`; }} /></>
        : <EmptyTab message={empty} players={false} />,
    };
  };

  const tabs: TabItem[] = [
    relationTab("creates", relLabel.created_by!, "created_by", "The files say it creates nothing."),
    relationTab("costs", relLabel.reagent_for!, "reagent_for", "The files say it costs nothing."),
    relationTab("taught-by", relLabel.in_skill_line!, "in_skill_line", "The files say no profession teaches it."),
    ...(rewards.length ? [relationTab("reward-from", relLabel.reward_from!, "reward_from", "")] : []),
  ];

  const trail = [...trailFor("/database/spells")!, { name: title, path: `/database/spells/${spellId}` }];

  return (
    <Container width="data">
      <article>
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
                { label: "Creates", value: known(creates.length || null), numeric: true },
                { label: "Costs", value: known(costs.length || null), numeric: true },
              ]}
            />
          }
        />
        <InShort summary="In short" bullets={summary} note={<Link href="/database#reading" className={LINK}>How to read these numbers</Link>} />
        <OpenData
          text={[`${title} (spell ${spellId})`, tip?.text ?? "", ...summary, `Source: https://everloot.app/database/spells/${spellId}`].filter(Boolean).join("\n")}
        />
        <Tabs label={`${title}: relations`} tabs={tabs} />
      </article>
    </Container>
  );
}
