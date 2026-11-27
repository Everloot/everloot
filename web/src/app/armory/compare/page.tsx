import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import GameIcon from "@/components/game/GameIcon";
import ItemTip from "@/components/game/ItemTip";
import { Card, Container, PageHeader, SectionHeading } from "@/components/ui";
import { QUALITY_TEXT, type Quality } from "@/components/ui/quality";
import { QUALITIES } from "@/design/tokens";
import {
  ARMORY_BOARDS, armoryBoardHref, armoryCharacterPath, armoryOn, classTokenOfName, isArmoryRegion, metricOfKey, metricValue,
  boardValue, PLAY_HISTORY_METRICS, rankable, rankText, regionLabel, slotLabel,
} from "@/lib/armory";
import { armoryStore, type ArmoryCharacter, type ArmoryRank } from "@/lib/armory-store";
import { trailFor } from "@/lib/breadcrumbs";
import { loadSiteAssets, unknownItemIcon, type ItemTip as Tip } from "@/lib/game-assets";
import { loadEquippedTips } from "@/lib/equipped-item-tips";
import { classText } from "@/app/players/player-view";
import { RankBadges, type RankBadge } from "../[region]/[slug]/sheet";
import { LEFT, readTimes, RIGHT, WEAPONS } from "../profile";
import { ArmoryCredit, armoryMetadata, first, newest, NOT_FOUND_METADATA, RegionRuleset, Unreachable } from "../parts";
import ComparePicks from "./picker";
import { compareSide, type Side } from "./sides";

/** Read on every request, so a hidden character is gone at once. */
export const dynamic = "force-dynamic";

type Search = { a?: string | string[]; b?: string | string[]; q?: string | string[] };
/** A side as the page has it: the character, "missing" (not stored, hidden, or not an address), "unreachable", or not asked for. */
type Loaded = { asked: Side | null; raw: string | null; character: ArmoryCharacter | "missing" | "unreachable" | null };

async function loadSide(raw: string | undefined): Promise<Loaded> {
  if (!raw) return { asked: null, raw: null, character: null };
  const side = compareSide(raw);
  if (!side) return { asked: null, raw, character: "missing" };
  try {
    return { asked: side, raw, character: (await armoryStore().character(side.region, side.slug)) ?? "missing" };
  } catch {
    return { asked: side, raw, character: "unreachable" };
  }
}

const isCharacter = (c: Loaded["character"]): c is ArmoryCharacter => typeof c === "object" && c !== null;
const fullName = (c: ArmoryCharacter) => `${c.name} ${c.surname}`;

export async function generateMetadata(props: { searchParams: Promise<Search> }): Promise<Metadata> {
  if (!armoryOn()) return NOT_FOUND_METADATA;
  const s = await props.searchParams;
  const found = (await Promise.all([loadSide(first(s.a)), loadSide(first(s.b))])).map((l) => l.character).filter(isCharacter);
  if (found.length === 0) return NOT_FOUND_METADATA;
  const names = found.map(fullName).join(" and ");
  return armoryMetadata({
    title: `Compare ${names}`,
    description: `${names} side by side on WoW: Forever: gear slot by slot with item levels, Gear Score and ranks from Blizzard's API.`,
    path: "/armory/compare",
  });
}

const PLAY_HISTORY_KEYS = new Set<string>(PLAY_HISTORY_METRICS.map((m) => ARMORY_BOARDS[m].key));

/** The gear-and-kills ranks as the character page's badges say them, within the character's region and ruleset. */
function rankBadges(c: ArmoryCharacter, ranks: ArmoryRank[]): RankBadge[] {
  return ranks.flatMap((r) => {
    const metric = metricOfKey(r.metric);
    if (!metric || PLAY_HISTORY_KEYS.has(r.metric) || !rankable(boardValue(c, r.metric))) return [];
    const href = armoryBoardHref(metric, { region: isArmoryRegion(c.region) ? c.region : null, ruleset: c.rulesetId });
    return [{ label: `${regionLabel(c.region)} ${c.ruleset} · ${ARMORY_BOARDS[metric].title} ${rankText(r)}`, href }];
  });
}

/** Who the side is, its ranks and its talent points per tree in the trees' own order; or why it is not shown. */
function SideHead({ which, side, ranks }: { which: "a" | "b"; side: Loaded; ranks: RankBadge[] }) {
  const c = side.character;
  if (!isCharacter(c)) {
    if (c === null) return <div />;
    return <Card>
      <p data-compare-missing={which} role="status" className="text-sm text-fg-2">
        {c === "unreachable" ? "Storage did not answer for this character. Try again in a moment."
          : `No stored character at ${side.raw}. It may be hidden, or not added yet.`}
      </p>
    </Card>;
  }
  const trees = c.details?.talents?.trees ?? [];
  return <section aria-label={fullName(c)} data-compare-side={which} className="min-w-0 space-y-3 rounded-card border border-line bg-panel p-4">
    <div className="space-y-1">
      <h2 className="text-h2"><Link href={armoryCharacterPath(c.region, c.slug)} className={`underline decoration-edge underline-offset-4 hover:decoration-fg ${classText(classTokenOfName(c.class))}`}>{fullName(c)}</Link></h2>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-2">
        <span>Level {c.level} {c.race} {c.class}</span>
        <RegionRuleset region={c.region} ruleset={c.ruleset} />
      </p>
    </div>
    {trees.length > 0 && <p data-compare-spec className="text-sm">
      <span className="font-mono tabular-nums text-fg">{trees.map((t) => t.points).join(" / ")}</span>{" "}
      <span className="text-fg-2">{trees.map((t) => t.name).join(" / ")}</span>
    </p>}
    <RankBadges ranks={ranks} />
  </section>;
}

/** The facts strip of both, one row per number. A number a read did not bring says "Not read", never 0. */
function FactsTable({ a, b }: { a: ArmoryCharacter | null; b: ArmoryCharacter | null }) {
  const rows: [string, (c: ArmoryCharacter) => ReactNode][] = [
    ["Item level", (c) => c.itemLevel === null ? null : metricValue("item-level", c.itemLevel)],
    ["Gear Score", (c) => c.gearScore === null ? null : metricValue("gear-score", c.gearScore)],
    ["Honorable kills", (c) => c.honorableKills === null ? null : metricValue("honorable-kills", c.honorableKills)],
    ["Achievements", (c) => c.details?.achievements ? c.details.achievements.rows.length.toLocaleString("en-US") : null],
    ["Quests completed", (c) => c.details?.quests ? c.details.quests.completed.length.toLocaleString("en-US") : null],
  ];
  const cell = (c: ArmoryCharacter | null, value: (c: ArmoryCharacter) => ReactNode) => {
    const v = c ? value(c) : null;
    return <td className="px-3 py-2 text-right font-mono tabular-nums">{v ?? <span className="font-sans text-fg-2">{c ? "Not read" : "—"}</span>}</td>;
  };
  return <section aria-labelledby="compare-facts" className="space-y-3">
    <SectionHeading id="compare-facts">At a glance</SectionHeading>
    <div className="overflow-x-auto rounded-card border border-line bg-panel">
      <table className="w-full text-cell">
        <thead><tr className="border-b border-line text-th text-muted">
          <th scope="col" className="px-3 py-2 text-left font-normal"><span className="sr-only">Number</span></th>
          <th scope="col" className="px-3 py-2 text-right font-normal">{a ? fullName(a) : "—"}</th>
          <th scope="col" className="px-3 py-2 text-right font-normal">{b ? fullName(b) : "—"}</th>
        </tr></thead>
        <tbody className="divide-y divide-line">{rows.map(([label, value]) => <tr key={label}>
          <th scope="row" className="px-3 py-2 text-left font-normal text-muted">{label}</th>
          {cell(a, value)}
          {cell(b, value)}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

const qualityName = (q: string | null | undefined): Quality | undefined => QUALITIES.find((x) => x === q?.toLowerCase());
type Item = ArmoryCharacter["equipment"][number];

/** One side's item in a slot: its icon in its quality's border, its name in its quality's colour, its item level. */
function ItemCell({ owner, item, tip, unknownIcon }: { owner: ArmoryCharacter | null; item: Item | undefined; tip: Tip | undefined; unknownIcon: string | null }) {
  // On a phone the pair stacks, so each half names whose it is.
  const whose = owner && <span className="text-cell-2 text-muted sm:hidden">{owner.name}</span>;
  if (!owner) return <div className="min-w-0 text-cell text-muted">—</div>;
  if (!item) return <div className="min-w-0">{whose}<p className="text-cell text-muted">Not equipped</p></div>;
  const href = `/database/items/${item.itemId}`;
  const src = tip?.icon ?? unknownIcon;
  const name = <Link href={href} className={`text-cell underline decoration-edge underline-offset-4 [overflow-wrap:anywhere] hover:decoration-fg ${QUALITY_TEXT[qualityName(item.quality) as Quality] ?? "text-fg"}`}>{item.name}</Link>;
  return <div className="flex min-w-0 items-center gap-3">
    {src && <Link href={href} tabIndex={-1} aria-hidden="true" className="shrink-0"><GameIcon src={src} size={32} quality={qualityName(item.quality) ?? qualityName(tip?.quality)} /></Link>}
    <div className="min-w-0 flex-1">
      <p className="flex items-baseline gap-2">{whose}{item.level != null && <span className="font-mono text-cell-2 tabular-nums text-fg-2" aria-label={`Item level ${item.level}`}>{item.level}</span>}</p>
      {tip ? <ItemTip tip={tip} icon={null}>{name}</ItemTip> : name}
    </div>
  </div>;
}

/** B's item level against A's in one slot: accent when higher, danger when lower, muted when even; none without two levels. */
function Delta({ a, b, bName }: { a: Item | undefined; b: Item | undefined; bName: string }) {
  if (a?.level == null || b?.level == null) return <span aria-hidden="true" />;
  const d = b.level - a.level;
  const text = d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0";
  const said = d === 0 ? `${bName}: same item level` : `${bName}: ${Math.abs(d)} item levels ${d > 0 ? "higher" : "lower"}`;
  return <span data-delta={d} aria-label={said} className={`self-center text-right font-mono text-cell tabular-nums ${d > 0 ? "text-accent" : d < 0 ? "text-danger" : "text-muted"}`}>{text}</span>;
}

function GearPairs({ a, b, tips, unknownIcon }: { a: ArmoryCharacter | null; b: ArmoryCharacter | null; tips: Map<number, Tip>; unknownIcon: string | null }) {
  const gear = (c: ArmoryCharacter | null) => new Map((c?.equipment ?? []).map((i) => [i.slot, i]));
  const ga = gear(a), gb = gear(b);
  return <section aria-labelledby="compare-gear" className="space-y-3">
    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
      <SectionHeading id="compare-gear">Equipment</SectionHeading>
      {a && b && <p className="text-meta text-muted">Item level difference is {b.name}&apos;s against {a.name}&apos;s.</p>}
    </div>
    <ol className="grid gap-2">{[...LEFT, ...RIGHT, ...WEAPONS].map((slot) => {
      const ia = ga.get(slot), ib = gb.get(slot);
      return <li key={slot} data-compare-slot={slot} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 rounded-control border border-line bg-panel px-3 py-2 sm:grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)]">
        <p className="col-span-full text-cell-2 text-muted">{slotLabel(slot)}</p>
        <ItemCell owner={a} item={ia} tip={ia ? tips.get(ia.itemId) : undefined} unknownIcon={unknownIcon} />
        <div className="row-span-2 flex justify-end sm:row-span-1 sm:justify-center"><Delta a={ia} b={ib} bName={b?.name ?? ""} /></div>
        <ItemCell owner={b} item={ib} tip={ib ? tips.get(ib.itemId) : undefined} unknownIcon={unknownIcon} />
      </li>;
    })}</ol>
  </section>;
}

/** "Compare with…": a name search for the other side, answered in the browser by the site's people search. */
function ComparePicker({ keep, q }: { keep: ArmoryCharacter; q: string }) {
  const field = "min-h-11 w-full rounded-control border border-edge bg-canvas px-3 text-fg placeholder:text-muted focus:border-accent";
  return <section aria-labelledby="compare-with" className="space-y-3">
    <SectionHeading id="compare-with">Compare with…</SectionHeading>
    <form action="/armory/compare" method="get" className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="a" value={`${keep.region}/${keep.slug}`} />
      <div className="min-w-0 flex-1 space-y-1">
        <label htmlFor="compare-q" className="text-sm text-fg">Character name</label>
        <input id="compare-q" name="q" required minLength={2} maxLength={40} autoComplete="off" defaultValue={q} placeholder="First name or full name" className={field} />
      </div>
      <button type="submit" className="btn">Search</button>
    </form>
    {q && <ComparePicks keep={{ region: keep.region, slug: keep.slug }} q={q} />}
  </section>;
}

export default async function ArmoryComparePage(props: { searchParams: Promise<Search> }) {
  if (!armoryOn()) notFound();
  const s = await props.searchParams;
  const [la, lb] = await Promise.all([loadSide(first(s.a)), loadSide(first(s.b))]);
  const a = isCharacter(la.character) ? la.character : null;
  const b = isCharacter(lb.character) ? lb.character : null;
  const unreachable = la.character === "unreachable" || lb.character === "unreachable";
  if (!a && !b && !unreachable) notFound();
  const trail = [...trailFor("/armory")!, { name: "Compare", path: "/armory/compare" }];
  if (!a && !b) {
    return <Container width="reading">
      <PageHeader trail={trail} title="Compare characters" />
      <div className="space-y-3"><Unreachable /><ArmoryCredit at={null} /></div>
    </Container>;
  }
  // A rank the store cannot give leaves that side's ranks out; the rest stands.
  const ranksOf = (c: ArmoryCharacter | null) => (c ? armoryStore().rank(c.region, c.slug).then((r) => rankBadges(c, r)).catch(() => []) : Promise.resolve([]));
  const [ra, rb] = await Promise.all([ranksOf(a), ranksOf(b)]);
  const assets = await loadSiteAssets().catch(() => null);
  const tips = await loadEquippedTips(assets, [...(a?.equipment ?? []), ...(b?.equipment ?? [])], undefined, true);
  const unknownIcon = assets ? unknownItemIcon(assets.base) : null;
  const keep = a ?? b;
  const q = (first(s.q) ?? "").trim().slice(0, 40);

  return (
    <Container width="data">
      <article className="space-y-8">
        <PageHeader trail={trail} title="Compare characters" lede="Two armory characters side by side: gear slot by slot, the numbers and the ranks." />
        <div className="grid gap-4 sm:grid-cols-2">
          <SideHead which="a" side={la} ranks={ra} />
          <SideHead which="b" side={lb} ranks={rb} />
        </div>
        {(!a || !b) && keep && <ComparePicker keep={keep} q={q} />}
        <FactsTable a={a} b={b} />
        <GearPairs a={a} b={b} tips={tips} unknownIcon={unknownIcon} />
        <ArmoryCredit at={newest([...(a ? readTimes(a) : []), ...(b ? readTimes(b) : [])])} />
      </article>
    </Container>
  );
}
