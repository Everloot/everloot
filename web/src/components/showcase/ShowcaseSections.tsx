import Link from "next/link";
import type { ReactNode } from "react";
import { className, raceName } from "@/app/players/player-view";
import { Bar } from "@/app/tools/collections/CompletionView";
import { Card, DataTable, Facts, SectionHeading } from "@/components/ui";
import {
  averageItemLevel, EMPTY_LINE, isPublic, PRIVATE_LINE, STALE_LINE, UNSUPPORTED_LINE,
  type CollectionsData, type GearRow, type ProfessionRow, type RaidsData, type ReputationRow, type Section, type Showcase, type ShownSection, type TalentsData,
} from "@/lib/character-showcase";

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

/** One line in place of a section's content: what is missing, never a zero. */
const Line = ({ children }: { children: ReactNode }) => <Card><p className="text-sm text-fg-2">{children}</p></Card>;

function Gear({ rows }: { rows: GearRow[] }) {
  return (
    <DataTable
      caption="Equipped gear"
      rows={rows}
      rowKey={(r) => r.slot}
      columns={[
        { key: "slot", header: "Slot", cell: (r) => r.slot, nowrap: true },
        { key: "item", header: "Item", cell: (r) => <Link href={`/database/items/${r.itemId}`} className={link}>{r.name ?? `Item ${r.itemId}`}</Link> },
        { key: "ilvl", header: "Item level", cell: (r) => r.itemLevel, numeric: true },
      ]}
      footer={<span className="text-sm text-fg-2">Average item level <span className="font-mono tabular-nums text-fg">{averageItemLevel(rows)}</span></span>}
    />
  );
}

function Talents({ data, classSlug }: { data: TalentsData; classSlug: string | null }) {
  const calculator = classSlug ? `/tools/talents/${classSlug}${data.code ? `#plan=${data.code}` : ""}` : null;
  return (
    <Card className="space-y-4">
      <Facts layout="list" label="Points per tree" items={data.trees.map((t) => ({ label: t.name, value: t.points, numeric: true }))} />
      {calculator && (
        <p className="text-sm">
          <Link href={calculator} className={link}>{data.code ? "Open this build in the talent calculator" : "Open the talent calculator"}</Link>
        </p>
      )}
      {data.planned.length > 0 && (
        <div className="space-y-1 text-sm">
          <h3 className="text-fg">Planned build</h3>
          <ul className="space-y-1">
            {data.planned.map((b) => <li key={b.slug}><Link href={`/b/${b.slug}`} className={link}>{b.name}</Link></li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Professions({ rows }: { rows: ProfessionRow[] }) {
  return <Facts layout="rows" label="Professions" items={rows.map((p) => ({ label: p.name, value: `${p.rank} / ${p.maxRank}`, numeric: true }))} />;
}

function Reputations({ rows }: { rows: ReputationRow[] }) {
  return (
    <Card as="div" className="space-y-4">
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.faction} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-fg">{r.faction}</span>
              {"renown" in r
                ? <span className="text-fg-2">{UNSUPPORTED_LINE}</span>
                : <span className="font-mono text-xs tabular-nums text-fg-2">{r.standing} · {r.value} / {r.max}</span>}
            </div>
            {!("renown" in r) && <Bar done={r.value} total={r.max} label={r.faction} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Raids({ data }: { data: RaidsData }) {
  return (
    <Card className="space-y-4 text-sm">
      {data.lockouts.length
        ? (
          <ul className="space-y-1">
            {data.lockouts.map((l) => (
              <li key={`${l.instance}:${l.difficulty}`}>
                <span className="text-fg">{l.instance}</span> ({l.difficulty}): <span className="font-mono tabular-nums">{l.killed}/{l.total}</span> bosses, resets {l.resets}
              </li>
            ))}
          </ul>
        )
        : <p className="text-fg-2">No lockout this week.</p>}
      {data.guildKills && (
        <div className="space-y-1">
          <h3 className="text-fg">The guild&apos;s kills, not this character&apos;s attendance</h3>
          <ul className="space-y-1">
            {data.guildKills.map((k) => <li key={k.instance}>{k.instance}: <span className="font-mono tabular-nums">{k.killed}/{k.total}</span></li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Collections({ data }: { data: CollectionsData }) {
  return (
    <Facts
      layout="rows"
      label="Collections"
      items={[
        { label: "Achievements", value: data.achievements, numeric: true },
        { label: "Achievement points", value: data.points, numeric: true },
        { label: "Titles", value: data.titles.length ? data.titles.join(", ") : "None" },
        // No collector writes these yet: a line, never a zero.
        { label: "Mounts", value: UNSUPPORTED_LINE },
        { label: "Pets", value: UNSUPPORTED_LINE },
      ]}
    />
  );
}

function Body({ s, classSlug }: { s: ShownSection; classSlug: string | null }) {
  const section = s.section;
  if (section.state === "empty") return <Line>{EMPTY_LINE}</Line>;
  if (section.state === "private") return <Line>{PRIVATE_LINE}</Line>;
  if (section.state === "unsupported") return <Line>{UNSUPPORTED_LINE}</Line>;
  const data = (section as Extract<Section<unknown>, { state: "shown" }>).data;
  switch (s.key) {
    case "gear": return <Gear rows={data as GearRow[]} />;
    case "talents": return <Talents data={data as TalentsData} classSlug={classSlug} />;
    case "professions": return <Professions rows={data as ProfessionRow[]} />;
    case "reputations": return <Reputations rows={data as ReputationRow[]} />;
    case "raids": return <Raids data={data as RaidsData} />;
    case "collections": return <Collections data={data as CollectionsData} />;
  }
}

/** The identity section: from the link row. A guild only when the owner shows it, linked when its page is public. */
export function ShowcaseIdentity({ showcase }: { showcase: Showcase }) {
  const c = showcase.input;
  return (
    <section aria-labelledby="showcase-identity" data-section="identity" data-state="shown">
      <SectionHeading id="showcase-identity">Character</SectionHeading>
      <Facts
        label="Character"
        items={[
          { label: "Class", value: <span className={showcase.classSlug ? `text-class-${showcase.classSlug}` : "text-fg"}>{className(c.class)}</span> },
          { label: "Race", value: raceName(c.race) },
          { label: "Level", value: c.level, numeric: true },
          { label: "Faction", value: c.faction ?? "None" },
          { label: "Realm", value: c.realm },
          ...(c.guild ? [{ label: "Guild", value: c.guild.path ? <Link href={c.guild.path} className={link}>{c.guild.name}</Link> : c.guild.name }] : []),
        ]}
      />
    </section>
  );
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
