import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ShowcaseSections, { ShowcaseIdentity } from "@/components/showcase/ShowcaseSections";
import { Card, Container, Facts, PageHeader, ReadingLayout, RailFacts, SectionHeading, type TocItem } from "@/components/ui";
import { CLASSES } from "@/design/tokens";
import { FOOTER_LINE, isPublic, showcaseOn, type Showcase } from "@/lib/character-showcase";
import { classLabel, contextLinks, MAX_LEVEL, type ClassSlug } from "@/lib/class-context";
import { dataAgeLabel } from "@/lib/data-age";
import { guildPath, guildsOn } from "@/lib/guilds";
import { characterPath, optOutPath, playerPagesOn, type Player } from "@/lib/player-pages";
import { pageMetadata } from "@/lib/seo";
import { className, classText, describePlayer, PLAYER_SIGHTING_LINE, PLAYER_STORAGE_UNAVAILABLE, raceName } from "@/app/players/player-view";
import { InstanceCard } from "@/app/guilds/parts";
import { characterGuild, GUILD_LINE, PLAN_LINE, raceFaction, type CharacterGuild } from "./character-guild";
import { characterParts, characterShowcase, plannedBuilds, type Params } from "./character-view";

/**
 * Read on every request and never cached, so a page switched off, or a character hidden, is gone at once. The
 * stricter of the two pages this one replaced: the sighting page was cached for an hour and cleared on a hide; the
 * showcase was never cached.
 */
export const dynamic = "force-dynamic";

/**
 * Every character page stays out of search engines, whatever the link's `indexable` switch or
 * EVERLOOT_PLAYER_PAGES_INDEX says, until indexing of these pages is accepted (showcase plan, S3).
 */
const NOINDEX = { index: false, follow: false } as const;

const UNAVAILABLE = "Character pages are unreachable right now. Try again in a moment.";
const GUILD_UNAVAILABLE = "The guild's data is unreachable right now. Try again in a moment.";
const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

const on = () => playerPagesOn() || showcaseOn();
const found = <T,>(v: T | null | "unavailable"): v is T => v !== null && v !== "unavailable";

export async function generateMetadata(props: { params: Promise<Params> }): Promise<Metadata> {
  if (!on()) return { title: "Page not found", robots: NOINDEX };
  const { showcase, seen } = await characterParts(await props.params);
  if (found(showcase)) {
    const s = characterShowcase(showcase, new Date());
    const c = s.input;
    return {
      ...pageMetadata({
        title: `${c.name}, ${s.line}`,
        description: `${c.name} on ${c.realm}: ${s.line}, from the player's own Everloot addon upload.`,
        path: c.path,
        image: `${c.path}/card.png`,
        alt: `Share card for ${c.name}`,
      }),
      robots: NOINDEX,
    };
  }
  if (found(seen)) {
    return {
      ...pageMetadata({ title: `${seen.name}, ${describePlayer(seen)}`, description: `${seen.name} on ${seen.realm}: ${describePlayer(seen)}, as last seen by the Everloot addon.`, path: characterPath(seen.ruleset, seen.realm, seen.name) }),
      robots: NOINDEX,
    };
  }
  if (showcase === "unavailable" || seen === "unavailable") return { title: "Character", robots: NOINDEX };
  return { title: "Page not found", robots: NOINDEX };
}

/** Home, then the character search while the player pages are on (it is a 404 otherwise), then the character. */
function trail(name: string, path: string) {
  return [{ name: "Home", path: "/" }, ...(playerPagesOn() ? [{ name: "Characters", path: "/players" }] : []), { name, path }];
}

/** The owner's part: the link row and the owner's own uploads, dated, with the line that says who reported it. */
function OwnerPart({ showcase }: { showcase: Showcase }) {
  return (
    <div className="space-y-8" data-part="showcase">
      <p className="text-sm text-muted" data-freshness>{showcase.freshness}</p>
      <ShowcaseIdentity showcase={showcase} />
      <ShowcaseSections showcase={showcase} preview={false} />
      <p className="text-sm text-fg-2">{FOOTER_LINE}</p>
    </div>
  );
}

/** The sighting part: what another player's addon last saw, as the players table holds it, and nothing more. */
function SightingPart({ seen }: { seen: Player }) {
  // Derived from the race, not reported: a race on both sides (Skyborne) names no faction.
  const faction = raceFaction(seen.race);
  return (
    <section aria-labelledby="character-sighting" data-part="sighting">
      <SectionHeading id="character-sighting" note={<>Last seen <span className="font-mono">{seen.lastSeen}</span></>}>Seen in game</SectionHeading>
      <div className="space-y-4">
        <Facts
          label="Seen in game"
          items={[
            { label: "Class", value: <span className={classText(seen.class)}>{className(seen.class)}</span> },
            { label: "Race", value: raceName(seen.race) },
            ...(faction ? [{ label: "Faction", value: faction }] : []),
            { label: "Level", value: seen.level, numeric: true },
            // With the guild pages on, the guild names its page; the page 404s for a hidden guild.
            { label: "Guild", value: seen.guild ? (guildsOn() ? <Link href={guildPath(seen.realm, seen.guild)} className={link}>{seen.guild}</Link> : seen.guild) : "None seen" },
            { label: "Realm", value: seen.realm },
            { label: "Last seen", value: seen.lastSeen, numeric: true },
          ]}
        />
        <p className="text-sm text-fg-2">{PLAYER_SIGHTING_LINE}</p>
      </div>
    </section>
  );
}

/** The guild part: the sighted guild as its own page shows it, then other characters seen in it. */
function GuildPart({ guild }: { guild: CharacterGuild }) {
  const officer = guild.officer;
  return (
    <section aria-labelledby="character-guild" data-part="guild" className="space-y-4">
      <SectionHeading id="character-guild" note={dataAgeLabel(guild.dataAsOf)}>Guild</SectionHeading>
      <Facts
        label="Guild"
        items={[
          { label: "Guild", value: <Link href={guild.path} className={link}>{guild.guildName}</Link> },
          ...(guild.members ? [{ label: "Size", value: guild.members }] : []),
          ...(officer?.rank ? [{ label: "Rank", value: officer.rank }] : []),
        ]}
      />
      <p className="text-sm text-fg-2">{GUILD_LINE}</p>
      <div className="space-y-3" data-guild="progression">
        <h3 className="text-cell font-semibold text-fg">Raid progress</h3>
        {guild.progression.length
          ? <div className="grid gap-4 md:grid-cols-2">{guild.progression.map((p) => <InstanceCard key={p.instanceMapId} progress={p} headingLevel={4} />)}</div>
          : <p className="text-sm text-fg-2">No agreed kill for this guild yet.</p>}
      </div>
      {officer && (officer.loot.length > 0 || officer.present) && (
        <div className="space-y-2 text-sm" data-guild="officers">
          <h3 className="text-cell font-semibold text-fg">From the officers&apos; board</h3>
          {officer.loot.length > 0 && (
            <ul className="space-y-1 text-fg-2">
              {officer.loot.map((l) => <li key={`${l.itemId}/${l.sourceBoss}`}><Link href={`/database/items/${l.itemId}`} className={link}>Item {l.itemId}</Link>, from {l.sourceBoss}</li>)}
            </ul>
          )}
          {officer.present && <p className="text-fg-2">Present at the guild&apos;s last raid.</p>}
        </div>
      )}
      {guild.guildmates.length > 0 && (
        <div className="space-y-2 text-sm" data-guild="guildmates">
          <h3 className="text-cell font-semibold text-fg">Also seen in {guild.guildName}</h3>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {guild.guildmates.map((m) => (
              <li key={m.path}><Link href={m.path} className={`${link} ${classText(m.class)}`}>{m.name}</Link> <span className="font-mono text-xs tabular-nums text-muted">{m.level}</span></li>
            ))}
          </ul>
          {guild.guildmatesTotal > guild.guildmates.length && (
            <p><Link href={guild.path} className={link}>All {guild.guildmatesTotal} on the guild&apos;s page</Link></p>
          )}
        </div>
      )}
    </section>
  );
}

/** The class slug for a store token ("SHAMAN"), or null for a class the site has no pages for. */
function classSlugOf(token: string): ClassSlug | null {
  const slug = token.toLowerCase();
  return (CLASSES as readonly string[]).includes(slug) ? (slug as ClassSlug) : null;
}

/** The site's own pages for the class, at the character's level: links only, nothing read from the character. */
function PlanPart({ classSlug, level }: { classSlug: ClassSlug; level: number }) {
  const lvl = Number.isInteger(level) && level >= 1 && level <= MAX_LEVEL ? level : undefined;
  const name = classLabel(classSlug);
  return (
    <section aria-labelledby="character-plan" data-part="plan" className="space-y-3">
      <SectionHeading id="character-plan">{lvl ? `Plan a level ${lvl} ${name}` : `Plan a ${name}`}</SectionHeading>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {contextLinks({ classSlug, ...(lvl ? { level: lvl } : {}) }).map((l) => (
          <li key={l.key}><Link href={l.href} className={link}>{l.key === "hub" ? `${name} class page` : l.label}</Link></li>
        ))}
      </ul>
      <p className="text-sm text-fg-2">{PLAN_LINE}</p>
    </section>
  );
}

const Unavailable = ({ text }: { text: string }) => <Card><p className="text-fg-2" role="status">{text}</p></Card>;

/**
 * A character's one page. The owner's showcase first, when the owner linked the character and made its page
 * public; then what the addon last saw of it, when the player pages are on and a row exists; then the guild it was
 * seen in, as the guild's page shows it; then the site's pages for its class. Each part is drawn from its own source
 * and says so; none is mixed into another. The rail lists the parts and each source's date. Neither the showcase nor
 * a sighting found is a 404.
 */
export default async function CharacterPage(props: { params: Promise<Params> }) {
  if (!on()) notFound();
  const p = await props.params;
  const { showcase: owner, seen } = await characterParts(p);
  if (!found(owner) && !found(seen)) {
    if (owner !== "unavailable" && seen !== "unavailable") notFound();
    return (
      <Container width="reading">
        <PageHeader trail={[{ name: "Home", path: "/" }]} title="Character" />
        <div className="space-y-4">
          {owner === "unavailable" && <Unavailable text={UNAVAILABLE} />}
          {seen === "unavailable" && <Unavailable text={PLAYER_STORAGE_UNAVAILABLE} />}
        </div>
      </Container>
    );
  }
  const showcase = found(owner) ? characterShowcase(owner, new Date(), await plannedBuilds(owner)) : null;
  const sighted = found(seen) ? seen : null;
  const guildRead = sighted ? await characterGuild(sighted) : null;
  const guild = guildRead === "unreachable" ? null : guildRead;
  const c = showcase?.input;
  const name = c?.name ?? sighted!.name;
  const realm = c?.realm ?? sighted!.realm;
  const path = c?.path ?? characterPath(sighted!.ruleset, sighted!.realm, sighted!.name);
  const titleClass = showcase ? (showcase.classSlug ? `text-class-${showcase.classSlug}` : undefined) : classText(sighted!.class);
  // The header's class and level: the owner's when there is a showcase, else the sighting's, as the lede says.
  const classSlug = classSlugOf(c?.class ?? sighted!.class);
  const level = c?.level ?? sighted!.level;

  const contents: TocItem[] = [
    ...(showcase
      ? [{ id: "showcase-identity", label: "Character" }, ...showcase.sections.filter((s) => isPublic(s.section)).map((s) => ({ id: `showcase-${s.key}`, label: s.title }))]
      : []),
    ...(sighted ? [{ id: "character-sighting", label: "Seen in game" }] : []),
    ...(guild ? [{ id: "character-guild", label: "Guild" }] : []),
    ...(classSlug ? [{ id: "character-plan", label: "Plan this class" }] : []),
  ];
  const sources = [
    ...(c ? [{ label: "Linked player's upload", value: <span className="font-mono">{c.lastUpload}</span> }] : []),
    ...(sighted ? [{ label: "Last seen by the addon", value: <span className="font-mono">{sighted.lastSeen}</span> }] : []),
    ...(guild ? [{ label: "Guild data", value: dataAgeLabel(guild.dataAsOf) }] : []),
  ];

  return (
    <Container width="wide">
      <ReadingLayout
        items={contents.length > 1 ? contents : []}
        meta={<div className="space-y-2" data-rail="sources"><p className="font-mono text-xs text-muted">Where this comes from</p><RailFacts items={sources} /></div>}
      >
        <article className="space-y-8">
          <PageHeader
            trail={trail(name, path)}
            title={<span className={titleClass}>{name}</span>}
            lede={`${showcase ? showcase.line : describePlayer(sighted!)} · ${realm}`}
          />
          {showcase ? <OwnerPart showcase={showcase} /> : owner === "unavailable" && <Unavailable text={UNAVAILABLE} />}
          {sighted ? <SightingPart seen={sighted} /> : seen === "unavailable" && <Unavailable text={PLAYER_STORAGE_UNAVAILABLE} />}
          {guild ? <GuildPart guild={guild} /> : guildRead === "unreachable" && <Unavailable text={GUILD_UNAVAILABLE} />}
          {classSlug && <PlanPart classSlug={classSlug} level={level} />}
          {playerPagesOn() && (
            <Card className="space-y-2 text-sm text-fg-2">
              <p>
                {sighted ? "Is this your character, and do you want it off Everloot?" : "Is this your character, and you did not publish this page?"}{" "}
                <Link href={optOutPath({ realm, name })} rel="nofollow" className={link}>Hide this character</Link>. No account is needed.
                {sighted && <> How the data is handled: <Link href="/privacy#player-pages" className={link}>privacy policy</Link>.</>}
              </p>
            </Card>
          )}
        </article>
      </ReadingLayout>
    </Container>
  );
}
