import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ShowcaseSections, { ShowcaseIdentity } from "@/components/showcase/ShowcaseSections";
import { Card, Container, Facts, PageHeader, SectionHeading } from "@/components/ui";
import { FOOTER_LINE, showcaseOn, type Showcase } from "@/lib/character-showcase";
import { guildPath, guildsOn } from "@/lib/guilds";
import { characterPath, optOutPath, playerPagesOn, type Player } from "@/lib/player-pages";
import { pageMetadata } from "@/lib/seo";
import { className, classText, describePlayer, PLAYER_SIGHTING_LINE, PLAYER_STORAGE_UNAVAILABLE, raceName } from "@/app/players/player-view";
import { characterParts, characterShowcase, plannedBuilds, publishedFacts, type Params } from "./character-view";

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
  return (
    <section aria-labelledby="character-sighting" data-part="sighting">
      <SectionHeading id="character-sighting" note={<>Last seen <span className="font-mono">{seen.lastSeen}</span></>}>Seen in game</SectionHeading>
      <div className="space-y-4">
        <Facts
          label="Seen in game"
          items={[
            { label: "Class", value: <span className={classText(seen.class)}>{className(seen.class)}</span> },
            { label: "Race", value: raceName(seen.race) },
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

const Unavailable = ({ text }: { text: string }) => <Card><p className="text-fg-2" role="status">{text}</p></Card>;

/**
 * A character's one page. The owner's showcase first, when the owner linked the character and made its page
 * public; then what the addon last saw of it, when the player pages are on and a row exists. Each part is drawn
 * from its own source and says so; neither is mixed into the other. Neither found is a 404.
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
  const showcase = found(owner) ? characterShowcase(owner, new Date(), await plannedBuilds(owner), await publishedFacts(owner)) : null;
  const sighted = found(seen) ? seen : null;
  const c = showcase?.input;
  const name = c?.name ?? sighted!.name;
  const realm = c?.realm ?? sighted!.realm;
  const path = c?.path ?? characterPath(sighted!.ruleset, sighted!.realm, sighted!.name);
  const titleClass = showcase ? (showcase.classSlug ? `text-class-${showcase.classSlug}` : undefined) : classText(sighted!.class);
  return (
    <Container width="reading">
      <article className="space-y-8">
        <PageHeader
          trail={trail(name, path)}
          title={<span className={titleClass}>{name}</span>}
          lede={`${showcase ? showcase.line : describePlayer(sighted!)} · ${realm}`}
        />
        {showcase ? <OwnerPart showcase={showcase} /> : owner === "unavailable" && <Unavailable text={UNAVAILABLE} />}
        {sighted ? <SightingPart seen={sighted} /> : seen === "unavailable" && <Unavailable text={PLAYER_STORAGE_UNAVAILABLE} />}
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
    </Container>
  );
}
