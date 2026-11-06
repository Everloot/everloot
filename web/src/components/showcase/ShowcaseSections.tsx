import Link from "next/link";
import type { ReactNode } from "react";
import { BossStrip, Progress } from "@/app/guilds/parts";
import { Bar } from "@/app/tools/collections/CompletionView";
import GameIcon from "@/components/game/GameIcon";
import { Card, DataTable, Disclosure, Facts, PageHeader, QUALITY_TEXT, qualityOf, SectionHeading } from "@/components/ui";
import type { Crumb } from "@/lib/jsonld";
import {
  averageItemLevel, EMPTY_LINE, GEAR_SLOTS, isPublic, NOT_RECORDED_LINE, PAPER_DOLL, paperDoll, PLANNED_LINE, PRIVATE_LINE, reputationGroups, STALE_LINE, UNSUPPORTED_LINE,
  type CollectionsData, type GearRow, type GearSlot, type ProfessionRow, type RaidsData, type ReputationRow, type Section, type Showcase, type ShownSection, type StatsData, type TalentsData,
} from "@/lib/character-showcase";

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const number = (n: number) => n.toLocaleString("en-US");

/** One line in place of a section's content: what is missing, never a zero. */
const Line = ({ children }: { children: ReactNode }) => <Card><p className="text-sm text-fg-2">{children}</p></Card>;

/** A small heading inside a section's card. */
const Sub = ({ children }: { children: ReactNode }) => <h3 className="text-cell font-semibold text-fg">{children}</h3>;

/** A label and its value on one hairline row, as the database pages' quick facts draw them. */
function Row({ label, value, numeric = true }: { label: ReactNode; value: ReactNode; numeric?: boolean }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3 border-b border-line py-1 last:border-b-0">
      <dt className="min-w-0 text-muted">{label}</dt>
      <dd className={`shrink-0 text-right text-fg ${numeric ? "font-mono tabular-nums" : ""}`}>{value}</dd>
    </div>
  );
}

/** A name, its numbers and a bar under them: reputations, professions and achievement categories. */
function BarRow({ name, done, total, said }: { name: ReactNode; done: number; total: number; said: string }) {
  return (
    <li className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 text-fg">{name}</span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-fg-2">{said}</span>
      </div>
      <Bar done={done} total={total} label={typeof name === "string" ? name : said} />
    </li>
  );
}

const itemName = (r: GearRow) => r.name ?? `Item ${r.itemId}`;
const qualityText = (r: GearRow) => (r.quality === null ? "text-fg" : QUALITY_TEXT[qualityOf(r.quality)]);

/** One slot of the paper doll: its name, then the item in its quality's colour and its item level, or "Empty". */
function Slot({ slot, row }: { slot: GearSlot; row: GearRow | null }) {
  return (
    <li data-slot={slot} data-empty={row ? undefined : ""} className="flex items-center gap-3 border-b border-line px-4 py-2 sm:px-6">
      {row?.icon ? <GameIcon src={row.icon} size={32} /> : null}
      <div className="min-w-0 flex-1">
        <p className="text-meta text-muted">{GEAR_SLOTS[slot]}</p>
        {row
          ? <Link href={`/database/items/${row.itemId}`} className={`text-cell ${qualityText(row)} underline decoration-edge underline-offset-4 hover:decoration-current [overflow-wrap:anywhere]`}>{itemName(row)}</Link>
          : <p className="text-cell text-muted">Empty</p>}
      </div>
      {row && <span className="shrink-0 font-mono text-cell tabular-nums text-fg-2"><span className="sr-only">Item level </span>{row.itemLevel}</span>}
    </li>
  );
}

/**
 * The equipped gear as the character window lays it out: the left and right columns, then the weapons. Each
 * column is an ordered list in the game's slot order, so a screen reader reads it top to bottom as text; the same
 * rows also sit in a table under it.
 */
function Gear({ rows }: { rows: GearRow[] }) {
  const doll = paperDoll(rows);
  const list = (slots: GearSlot[]) => slots.map((s) => <Slot key={s} slot={s} row={doll[s]} />);
  const equipped = (Object.keys(GEAR_SLOTS) as GearSlot[]).flatMap((s) => (doll[s] ? [doll[s]] : []));
  return (
    <div className="space-y-3" data-paper-doll>
      <Card padding="none">
        <div className="grid md:grid-cols-2">
          <ol aria-label="Armour, left column" className="md:border-r md:border-line">{list(PAPER_DOLL.left)}</ol>
          <ol aria-label="Armour, right column">{list(PAPER_DOLL.right)}</ol>
        </div>
        <ol aria-label="Weapons" className="grid sm:grid-cols-3 sm:[&>li]:border-r sm:[&>li:last-child]:border-r-0 sm:[&>li]:border-line">{list(PAPER_DOLL.weapons)}</ol>
        <p className="px-4 py-3 text-sm text-fg-2 sm:px-6">
          Average item level <span className="font-mono tabular-nums text-fg">{averageItemLevel(rows)}</span>
          <span className="text-muted">, over {equipped.length} equipped {equipped.length === 1 ? "item" : "items"}</span>
        </p>
      </Card>
      <Disclosure summary="The same gear as a table">
        <DataTable
          caption="Equipped gear"
          rows={equipped}
          rowKey={(r) => r.slot}
          columns={[
            { key: "slot", header: "Slot", cell: (r) => GEAR_SLOTS[r.slot], nowrap: true },
            { key: "item", header: "Item", cell: (r) => <Link href={`/database/items/${r.itemId}`} className={link}>{itemName(r)}</Link> },
            { key: "ilvl", header: "Item level", cell: (r) => r.itemLevel, numeric: true },
          ]}
        />
      </Disclosure>
    </div>
  );
}

/** The character sheet's numbers in the game's groups. */
function Stats({ data }: { data: StatsData }) {
  return (
    <Card>
      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((g) => (
          <div key={g.group} className="space-y-2" data-stat-group={g.group}>
            <Sub>{g.group}</Sub>
            <dl className="text-meta">{g.stats.map((s) => <Row key={s.label} label={s.label} value={s.value} />)}</dl>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Talents({ data, classSlug }: { data: TalentsData; classSlug: string | null }) {
  // No trees: nothing was synced from the game, only planned builds, so there is no in-game build to open.
  const inGame = data.trees.length > 0;
  const spent = data.trees.reduce((sum, t) => sum + t.points, 0);
  const main = inGame ? data.trees.reduce((a, b) => (b.points > a.points ? b : a)) : null;
  const calculator = inGame && classSlug ? `/tools/talents/${classSlug}${data.code ? `#plan=${data.code}` : ""}` : null;
  return (
    <Card className="space-y-4">
      {main && (
        <>
          <p className="text-sm text-fg-2">
            <span className="text-fg">{main.name}</span>{" "}
            <span className="font-mono tabular-nums">{data.trees.map((t) => t.points).join(" / ")}</span>
          </p>
          <ul className="space-y-3" aria-label="Points per tree">
            {data.trees.map((t) => <BarRow key={t.name} name={t.name} done={t.points} total={Math.max(1, spent)} said={`${t.points} ${t.points === 1 ? "point" : "points"}`} />)}
          </ul>
        </>
      )}
      {calculator && (
        <p className="text-sm">
          <Link href={calculator} className={link}>{data.code ? "Open this build in the talent calculator" : "Open the talent calculator"}</Link>
        </p>
      )}
      {data.planned.length > 0 && (
        <div className="space-y-1 text-sm">
          <h3 className="text-fg">{data.planned.length === 1 ? "Planned build" : "Planned builds"}</h3>
          <p className="text-fg-2">{PLANNED_LINE}</p>
          <ul className="space-y-1">
            {data.planned.map((b) => <li key={b.slug}><Link href={`/b/${b.slug}`} className={link}>{b.name}</Link></li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Professions({ rows }: { rows: ProfessionRow[] }) {
  return (
    <Card>
      <ul className="space-y-4" aria-label="Professions">
        {rows.map((p) => <BarRow key={p.name} name={p.name} done={p.rank} total={p.maxRank} said={`${p.rank} / ${p.maxRank}`} />)}
      </ul>
    </Card>
  );
}

function Reputations({ rows }: { rows: ReputationRow[] }) {
  return (
    <Card className="space-y-6">
      {reputationGroups(rows).map((g) => (
        <div key={g.standing} className="space-y-3" data-standing={g.standing}>
          <Sub>{g.standing}</Sub>
          <ul className="space-y-4">
            {g.rows.map((r) => ("renown" in r
              ? <li key={r.faction} className="flex items-baseline justify-between gap-3 text-sm"><span className="text-fg">{r.faction}</span><span className="text-fg-2">{NOT_RECORDED_LINE}</span></li>
              : <BarRow key={r.faction} name={r.faction} done={r.value} total={r.max} said={`${number(r.value)} / ${number(r.max)}`} />))}
          </ul>
        </div>
      ))}
    </Card>
  );
}

/** "Tuesday, 2026-11-10": the reset day as the game's raid window names it, with the date the page uses elsewhere. */
const resetDay = (date: string) => `${new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}, ${date}`;

function Raids({ data }: { data: RaidsData }) {
  return (
    <div className="space-y-4">
      <Card padding="none">
        <div className="px-4 pt-4 sm:px-6"><Sub>This week&apos;s lockouts</Sub></div>
        {data.lockouts.length
          ? (
            <ul className="mt-2">
              {data.lockouts.map((l) => (
                <li key={`${l.instance}:${l.difficulty}`} data-lockout={l.instance} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3 text-cell sm:px-6">
                  <span className="min-w-0 flex-1 basis-48">
                    <span className="text-fg">{l.instance}</span> <span className="text-muted">{l.difficulty}</span>
                  </span>
                  {l.bosses.length > 0 && <BossStrip list={l.bosses.map((b, i) => ({ encounterId: i, name: b.name, killed: b.killed, killedAt: null }))} />}
                  <Progress killed={l.killed} bosses={l.total} />
                  <span className="basis-full text-meta text-muted">Resets {resetDay(l.resets)}</span>
                </li>
              ))}
            </ul>
          )
          : <p className="px-4 pb-4 pt-2 text-sm text-fg-2 sm:px-6">No lockout this week.</p>}
      </Card>
      {data.guildKills && (
        <Card className="space-y-3">
          <Sub>The guild&apos;s kills, not this character&apos;s attendance</Sub>
          <ul className="space-y-2 text-cell">
            {data.guildKills.map((k) => (
              <li key={k.instance} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <span className="text-fg">{k.instance}</span>
                <Progress killed={k.killed} bosses={k.total} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Completion: the counts, the newest achievements, each category's share, titles; mounts and pets as a line each. */
function Collections({ data }: { data: CollectionsData }) {
  return (
    <div className="space-y-4">
      <Facts
        label="Progress"
        items={[
          { label: "Achievements", value: number(data.achievements), numeric: true },
          { label: "Achievement points", value: number(data.points), numeric: true },
          { label: "Quests completed", value: data.quests === null ? <span className="text-sm text-fg-2">{NOT_RECORDED_LINE}</span> : number(data.quests), numeric: data.quests !== null },
          { label: "Titles", value: number(data.titles.length), numeric: true },
        ]}
      />
      <div className="grid gap-4 md:grid-cols-2">
        {data.recent.length > 0 && (
          <Card className="space-y-2">
            <Sub>Recent achievements</Sub>
            <dl className="text-meta">{data.recent.map((a) => <Row key={a.name} label={<span className="text-fg">{a.name}</span>} value={a.date} />)}</dl>
          </Card>
        )}
        {data.categories.length > 0 && (
          <Card className="space-y-3">
            <Sub>Achievements by category</Sub>
            <ul className="space-y-3">
              {data.categories.map((c) => <BarRow key={c.name} name={c.name} done={c.done} total={c.total} said={`${c.done} of ${c.total}`} />)}
            </ul>
          </Card>
        )}
      </div>
      <Facts
        layout="rows"
        label="Titles and collections"
        items={[
          { label: "Titles", value: data.titles.length ? data.titles.join(", ") : "None" },
          // No collector writes these yet: a line, never a zero.
          { label: "Mounts", value: NOT_RECORDED_LINE },
          { label: "Pets", value: NOT_RECORDED_LINE },
        ]}
      />
    </div>
  );
}

function Body({ s, classSlug }: { s: ShownSection; classSlug: string | null }) {
  const section = s.section;
  if (section.state === "empty") return <Line>{EMPTY_LINE}</Line>;
  if (section.state === "private") return <Line>{PRIVATE_LINE}</Line>;
  // The game shows its stats; what is missing for them is a collector, and the line says so.
  if (section.state === "unsupported") return <Line>{s.key === "stats" ? NOT_RECORDED_LINE : UNSUPPORTED_LINE}</Line>;
  const data = (section as Extract<Section<unknown>, { state: "shown" }>).data;
  switch (s.key) {
    case "gear": return <Gear rows={data as GearRow[]} />;
    case "stats": return <Stats data={data as StatsData} />;
    case "talents": return <Talents data={data as TalentsData} classSlug={classSlug} />;
    case "professions": return <Professions rows={data as ProfessionRow[]} />;
    case "reputations": return <Reputations rows={data as ReputationRow[]} />;
    case "raids": return <Raids data={data as RaidsData} />;
    case "collections": return <Collections data={data as CollectionsData} />;
  }
}

/**
 * The page's header band, from the link row: the name in its class colour and the title it wears, the level, race
 * and class, then the guild (only when the owner shows it, linked when its page is public), realm and faction, the
 * upload date, and beside them the headline numbers of the shown sections. It is the page's one PageHeader.
 */
export function ShowcaseHeader({ showcase, trail, actions }: { showcase: Showcase; trail: Crumb[]; actions?: ReactNode }) {
  const c = showcase.input;
  const dot = <span aria-hidden="true">·</span>;
  return (
    <div id="showcase-identity" data-section="identity" data-state="shown">
      <PageHeader
        trail={trail}
        title={(
          <>
            <span className={showcase.classSlug ? `text-class-${showcase.classSlug}` : undefined}>{c.name}</span>
            {c.title && <span className="block text-cell font-normal text-fg-2" data-title>{c.title}</span>}
          </>
        )}
        lede={showcase.line}
        meta={(
          <>
            {c.guild && <span data-guild>{c.guild.path ? <Link href={c.guild.path} className={link}>&lt;{c.guild.name}&gt;</Link> : <>&lt;{c.guild.name}&gt;</>}</span>}
            {c.guild && dot}
            <span>{c.realm}</span>
            {/* Skyborne plays on both sides: no faction is named for it. */}
            {c.faction && <>{dot}<span data-faction>{c.faction}</span></>}
            {dot}
            <span data-freshness>{showcase.freshness}</span>
          </>
        )}
        actions={(showcase.headlines.length > 0 || actions) && (
          <>
            {showcase.headlines.length > 0 && (
              <dl className="flex gap-6" data-headlines>
                {showcase.headlines.map((h) => (
                  <div key={h.label} className="flex flex-col-reverse">
                    <dt className="text-meta text-muted">{h.label}</dt>
                    <dd className="font-mono text-h2-sm tabular-nums text-fg">{number(h.value)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {actions}
          </>
        )}
      />
    </div>
  );
}

/** The rail's contents for the showcase: the header, then each section the view shows. */
export function showcaseContents(showcase: Showcase, preview: boolean): { id: string; label: string }[] {
  return [
    { id: "showcase-identity", label: "Character" },
    ...showcase.sections.filter((s) => preview || isPublic(s.section)).map((s) => ({ id: `showcase-${s.key}`, label: s.title })),
  ];
}

/**
 * The showcase's sections in page order, each with its own date. `preview` is the owner's view (and the sample's):
 * every state shows. Without it, as the public page, sections with nothing synced or switched off are left out.
 */
export default function ShowcaseSections({ showcase, preview }: { showcase: Showcase; preview: boolean }) {
  const shown = showcase.sections.filter((s) => preview || isPublic(s.section));
  return (
    <>
      {shown.map((s) => (
        <section key={s.key} aria-labelledby={`showcase-${s.key}`} data-section={s.key} data-state={s.section.state}>
          <SectionHeading
            id={`showcase-${s.key}`}
            note={s.asOf ? <>As of <span className="font-mono">{s.asOf}</span>{s.stale ? `. ${STALE_LINE}` : ""}</> : undefined}
          >
            {s.title}
          </SectionHeading>
          <Body s={s} classSlug={showcase.classSlug} />
        </section>
      ))}
    </>
  );
}
