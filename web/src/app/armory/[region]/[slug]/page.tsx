import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Card, Container, DataTable, Facts, PageHeader, SectionHeading, type Column, type Fact } from "@/components/ui";
import { QUALITY_TEXT, type Quality } from "@/components/ui/quality";
import {
  ARMORY_PATH, armoryBoardHref, armoryCharacterPath, armoryGuildPath, armoryHidePath, armoryOn, classTokenOfName, isArmoryRegion,
  metricOfKey, metricValue, regionLabel, slotLabel, validArmorySlug, ARMORY_BOARDS,
} from "@/lib/armory";
import { armoryStore, type ArmoryCharacter, type ArmoryItem, type ArmoryRank } from "@/lib/armory-store";
import { classText } from "@/app/players/player-view";
import { ArmoryCredit, armoryMetadata, day, link, NOT_FOUND_METADATA, Unreachable } from "../../parts";

/** Read on every request, so a hidden character is gone at once. */
export const dynamic = "force-dynamic";

type Params = { region: string; slug: string };

/** The character, null when there is none (or the address is not one), "unreachable" when storage did not answer. */
const load = cache(async (region: string, slug: string): Promise<ArmoryCharacter | null | "unreachable"> => {
  if (!isArmoryRegion(region) || !validArmorySlug(slug)) return null;
  try { return await armoryStore().character(region, slug); } catch { return "unreachable"; }
});

export async function generateMetadata(props: { params: Promise<Params> }): Promise<Metadata> {
  if (!armoryOn()) return NOT_FOUND_METADATA;
  const { region, slug } = await props.params;
  const c = await load(region, slug);
  if (c === null) return NOT_FOUND_METADATA;
  if (c === "unreachable") return { title: "Character", robots: NOT_FOUND_METADATA.robots };
  return armoryMetadata({
    title: `${c.name} ${c.surname}, level ${c.level} ${c.race} ${c.class}`,
    description: `${c.name} ${c.surname}, a level ${c.level} ${c.race} ${c.class} on WoW: Forever ${regionLabel(c.region)} ${c.ruleset}: gear, item level and honorable kills from Blizzard's API.`,
    path: armoryCharacterPath(c.region, c.slug),
  });
}

const QUALITIES = new Set(Object.keys(QUALITY_TEXT));
/** The API's quality type ("EPIC") as the site's quality colour; plain text for one the tokens do not know. */
const qualityText = (q: string | null) => (q && QUALITIES.has(q.toLowerCase()) ? QUALITY_TEXT[q.toLowerCase() as Quality] : "text-fg");

const itemColumns: Column<ArmoryItem>[] = [
  { key: "slot", header: "Slot", nowrap: true, cell: (i) => <span className="text-fg-2">{slotLabel(i.slot)}</span> },
  { key: "item", header: "Item", cell: (i) => <Link href={`/database/items/${i.itemId}`} className={`underline decoration-edge underline-offset-4 hover:decoration-fg ${qualityText(i.quality)}`}>{i.name}</Link> },
  { key: "level", header: "Item level", numeric: true, cell: (i) => i.level ?? <span className="text-muted">Not given</span> },
];

function rankFacts(c: ArmoryCharacter, ranks: ArmoryRank[]): Fact[] {
  return ranks.flatMap((r) => {
    const metric = metricOfKey(r.metric);
    if (!metric) return [];
    const href = armoryBoardHref(metric, { region: isArmoryRegion(c.region) ? c.region : null, ruleset: c.rulesetId });
    return [{ label: `${ARMORY_BOARDS[metric].title} rank`, value: <Link href={href} className={link}>#{r.rank} of {r.of.toLocaleString("en-US")}</Link>, numeric: true }];
  });
}

export default async function ArmoryCharacterPage(props: { params: Promise<Params> }) {
  if (!armoryOn()) notFound();
  const { region, slug } = await props.params;
  const c = await load(region, slug);
  if (c === null) notFound();
  if (c === "unreachable") {
    return (
      <Container width="reading">
        <PageHeader trail={[{ name: "Home", path: "/" }, { name: "Armory", path: ARMORY_PATH }]} title="Character" />
        <Unreachable />
      </Container>
    );
  }
  // A rank the store cannot give leaves the ranks out; the rest of the page stands.
  const ranks = await armoryStore().rank(c.region, c.slug).catch(() => [] as ArmoryRank[]);
  const path = armoryCharacterPath(c.region, c.slug);
  const fullName = `${c.name} ${c.surname}`;
  const lastLogin = day(c.lastLogin);
  const facts: Fact[] = [
    ...(c.itemLevel !== null ? [{ label: "Item level", value: metricValue("item-level", c.itemLevel), numeric: true }] : []),
    ...(c.averageItemLevel !== null ? [{ label: "Average item level", value: c.averageItemLevel, numeric: true }] : []),
    ...(c.gearScore !== null ? [{ label: "Gear Score", value: metricValue("gear-score", c.gearScore), numeric: true }] : []),
    ...(c.honorableKills !== null ? [{ label: "Honorable kills", value: metricValue("honorable-kills", c.honorableKills), numeric: true }] : []),
    ...(c.pvpRank !== null ? [{ label: "PvP rank", value: c.pvpRank, numeric: true }] : []),
    ...rankFacts(c, ranks),
  ];

  return (
    <Container width="reading">
      <article className="space-y-8">
        <PageHeader
          trail={[{ name: "Home", path: "/" }, { name: "Armory", path: ARMORY_PATH }, { name: fullName, path }]}
          title={<span className={classText(classTokenOfName(c.class))}>{fullName}</span>}
          lede={`Level ${c.level} ${c.race} ${c.class}`}
          meta={
            <span>
              {c.faction} · {regionLabel(c.region)} {c.ruleset}
              {c.guildName && <> · {c.guildSlug ? <Link href={armoryGuildPath(c.region, c.guildSlug)} className={link}>{c.guildName}</Link> : c.guildName}</>}
              {lastLogin && <> · Last login <span className="font-mono tabular-nums">{lastLogin}</span></>}
            </span>
          }
        />

        {facts.length > 0 && <Facts label="Numbers" items={facts} />}

        <section aria-labelledby="armory-gear" className="space-y-3">
          <SectionHeading id="armory-gear">Equipment</SectionHeading>
          {c.equipment.length === 0
            ? <p className="text-sm text-fg-2">Nothing equipped when it was read.</p>
            : <DataTable dense caption={`What ${fullName} wears`} columns={itemColumns} rows={c.equipment} rowKey={(i) => `${i.slot}/${i.itemId}`} />}
        </section>

        <footer className="space-y-3">
          <ArmoryCredit at={c.fetchedAt} />
          <Card className="text-sm text-fg-2">
            <p>
              Is this your character, and do you want it off Everloot?{" "}
              <Link href={armoryHidePath({ region: c.region, name: c.name, surname: c.surname })} rel="nofollow" className={link}>Hide this character</Link>.
              No account is needed. <Link href="/privacy#armory" className={link}>Privacy policy</Link>.
            </p>
          </Card>
        </footer>
      </article>
    </Container>
  );
}
