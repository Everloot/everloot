import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { validPlayerName } from "@everloot/protocol";
import { pageMetadata } from "@/lib/seo";
import { optOutPath, playerPagesOn, playerPath, type Player } from "@/lib/player-pages";
import { playerStore } from "@/lib/player-store";
import { Card, Container, Facts, PageHeader } from "@/components/ui";
import { className, classText, describePlayer, PLAYER_STORAGE_UNAVAILABLE, playerRobots, raceName } from "../../../player-view";

/** One hour. An opt-out clears the page at once (api/players/opt-out), so this only bounds how stale a level can be. */
export const revalidate = 3600;

/** No page is built ahead of time; the first visit to a character renders it and caches it for `revalidate`. */
export function generateStaticParams() { return []; }

type Params = { ruleset: string; realm: string; name: string };

const decode = (part: string) => { try { return decodeURIComponent(part); } catch { return ""; } };

/**
 * The address parts the store is worth asking about: a ruleset of letters, digits and hyphens, a realm slug
 * (2 to 40 characters, no spaces, as realmSlug writes it) and a 2-to-12-letter name. Anything else is a 404
 * without a request.
 */
function parse(p: Params): Params | null {
  const ruleset = decode(p.ruleset), realm = decode(p.realm), name = decode(p.name);
  if (!/^[a-z0-9-]+$/i.test(ruleset)) return null;
  if (realm.length < 2 || realm.length > 40 || /\s/.test(realm)) return null;
  if (!validPlayerName(name)) return null;
  return { ruleset, realm, name };
}

/** The row, null when there is none, or "unavailable" when the store could not answer; never a throw. */
async function lookup(p: Params): Promise<Player | null | "unavailable"> {
  const parts = parse(p);
  if (!parts) return null;
  try {
    return await playerStore().get(parts.ruleset, parts.realm, parts.name);
  } catch {
    return "unavailable";
  }
}

export async function generateMetadata(props: { params: Promise<Params> }): Promise<Metadata> {
  if (!playerPagesOn()) return { title: "Page not found", robots: { index: false } };
  const player = await lookup(await props.params);
  if (player === "unavailable") return { title: "Player", robots: { index: false } };
  if (!player) return { title: "Page not found", robots: { index: false } };
  return {
    ...pageMetadata({ title: `${player.name}, ${describePlayer(player)}`, description: `${player.name} on ${player.realm}: ${describePlayer(player)}, as last seen by the Everloot addon.`, path: playerPath(player) }),
    robots: playerRobots(),
  };
}

const link = "text-accent hover:underline underline-offset-4";

export default async function PlayerPage(props: { params: Promise<Params> }) {
  if (!playerPagesOn()) notFound();
  const player = await lookup(await props.params);
  if (player === "unavailable") {
    return (
      <Container width="reading">
        <PageHeader trail={[{ name: "Home", path: "/" }, { name: "Players", path: "/players" }]} title="Player" />
        <Card><p className="text-fg-2" role="status">{PLAYER_STORAGE_UNAVAILABLE}</p></Card>
      </Container>
    );
  }
  if (!player) notFound();

  return (
    <Container width="reading">
      <article className="space-y-6">
        <PageHeader
          trail={[{ name: "Home", path: "/" }, { name: "Players", path: "/players" }, { name: player.realm, path: playerPath(player) }]}
          title={player.name}
          lede={describePlayer(player)}
          meta={<span className="font-mono text-xs">Last seen {player.lastSeen}</span>}
        />

        <Facts
          label="Character"
          items={[
            { label: "Class", value: <span className={classText(player.class)}>{className(player.class)}</span> },
            { label: "Race", value: raceName(player.race) },
            { label: "Level", value: player.level, numeric: true },
            { label: "Guild", value: player.guild ?? "None seen" },
            { label: "Realm", value: player.realm },
            { label: "Last seen", value: player.lastSeen, numeric: true },
          ]}
        />

        <Card className="space-y-2 text-sm text-fg-2">
          <p>
            This is what a player running the Everloot addon last saw of this character, on the day above. It is not checked
            against the game, and it may be out of date: the level and guild are as of that day. The page holds no position,
            gear or history.
          </p>
          <p>
            Is this your character, and do you want it off Everloot?{" "}
            <Link href={optOutPath(player)} rel="nofollow" className={link}>Hide this character</Link>. No account is needed.
            How the data is handled: <Link href="/privacy#player-pages" className={link}>privacy policy</Link>.
          </p>
        </Card>
      </article>
    </Container>
  );
}
