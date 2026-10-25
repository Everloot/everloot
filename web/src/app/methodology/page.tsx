import type { Metadata } from "next";
import Link from "next/link";
import { WIKI_URL } from "@/components/LoreSource";
import { CURRENT_VERSION } from "@/lib/game-version";
import { loadSiteAssets } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@/lib/items";
import { guildsOn } from "@/lib/guild-switch";
import { playerPagesOn } from "@/lib/player-pages";
import { pageMetadata } from "@/lib/seo";
import { REPO_URL } from "@/lib/source";
import { CREDIT } from "@/lib/talents/assets";
import { MAP_SOURCE } from "@/lib/world-map";
import { PageHeader, ReadingLayout, SectionHeading, type TocItem } from "@/components/ui";

const description =
  "How Everloot turns addon uploads into WoW Forever facts: three installs must agree, addresses are never published, and names only on the player pages.";

export const metadata: Metadata = pageMetadata({ title: "How We Count WoW Forever Data", description, path: "/methodology" });

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

const SECTIONS: TocItem[] = [
  { id: "three", label: "Three installs have to agree" },
  { id: "zero", label: "Unrecorded is not zero" },
  { id: "never", label: "What we never publish" },
  { id: "files", label: "Game files and play are kept apart" },
  { id: "population", label: "Population numbers" },
  { id: "guilds", label: "How guilds are counted" },
  { id: "credits", label: "Credits" },
];

export default async function MethodologyPage() {
  // The art's build comes from the asset manifest, only when the asset URL is set.
  const assets = await loadSiteAssets();
  return (
    <ReadingLayout items={SECTIONS}>
      <PageHeader
        title="How we count"
        lede="Every fact on Everloot comes from players running the Everloot addon and choosing to upload what it recorded."
        trail={[{ name: "Home", path: "/" }, { name: "How we count", path: "/methodology" }]}
      />
      <div className="space-y-12">
        <p className="text-fg-2">
          This page says how those uploads become the numbers you see, and what we never publish. The full rules are in the{" "}
          <a href={`${REPO_URL}/blob/main/docs/DATA_POLICY.md`} rel="noopener" className={link}>data policy</a>.
        </p>

        <section aria-labelledby="three">
          <SectionHeading id="three">Three installs have to agree</SectionHeading>
          <div className="space-y-4">
            <p className="text-fg-2">
              A drop, a vendor item, a spawn point, a recipe range or a market price appears only once at least three different installs
              have reported it the same way. For prices and catalog entries, &ldquo;different&rdquo; means different upload addresses,
              with an IPv6 address counted by its /64 block, so one household can&apos;t make a fact true on its own. Until three agree,
              the page says so instead of guessing.
            </p>
            <p className="text-fg-2">
              A fact that comes from a Polestar Recorder file needs three different characters uploading from three different
              addresses, and a player&apos;s alts or connections never confirm each other.
            </p>
            {playerPagesOn() && (
              <p className="text-fg-2">
                The player pages are the one exception. They are not facts: one upload makes a page, and the page says its data
                is unchecked. They show a character&apos;s name, realm, race, class, level, guild and the day it was last seen, and
                nothing else.
              </p>
            )}
          </div>
        </section>

        <section aria-labelledby="zero">
          <SectionHeading id="zero">Unrecorded is not zero</SectionHeading>
          <div className="space-y-4">
            <p className="text-fg-2">
              If nobody has recorded something, the page says <em>unrecorded</em>. A zero appears only when it was measured: for example,
              &ldquo;0 drops in 40 loot windows&rdquo; once three installs looted that creature and none of them saw the item. A storage
              outage or a missing source is never shown as zero either.
            </p>
            <p className="text-fg-2">
              A drop rate is the share of recorded loot windows on a creature or object that held the item. A kill nobody looted
              isn&apos;t counted, because the addon never saw it. The API calls that count <code className="font-mono text-fg">kills</code>,
              but it counts loot windows.
            </p>
          </div>
        </section>

        <section aria-labelledby="never">
          <SectionHeading id="never">What we never publish</SectionHeading>
          <div className="space-y-4">
            <ul className="list-disc pl-6 space-y-1 text-fg-2">
              <li>Character names, unless that player shares them on purpose from the <Link href="/upload" className={link}>upload page</Link>, a guild&apos;s officers publish its guild board, or the player pages are on: those show a character&apos;s name, realm, race, class, level, guild and the day it was last seen, and nothing else. Guild data needs an officer&apos;s upload.</li>
              <li>Your install id, or the address an upload came from. Where an address matters for counting, we keep a keyed hash in private storage.</li>
              <li>Your list of addons, row by row. It is off unless you turn it on, and only counts that three installs share are shown.</li>
            </ul>
            <p className="text-fg-2">
              Uploaded observations are public as anonymous records, so anyone can check our counts. Player rows are not
              part of those records.
            </p>
          </div>
        </section>

        <section aria-labelledby="files">
          <SectionHeading id="files">Game files and play are kept apart</SectionHeading>
          <div className="space-y-4">
            <p className="text-fg-2">
              Some pages, such as the <Link href="/tools/talents" className={link}>talent calculator</Link> and the{" "}
              <Link href="/map" className={link}>map</Link>, use data read from the game&apos;s own files. It is labelled as found in the game
              files and unconfirmed until players see it in play. It comes from the {CURRENT_VERSION.label} build {CURRENT_VERSION.build}.
            </p>
          </div>
        </section>

        <section aria-labelledby="population">
          <SectionHeading id="population">Population numbers</SectionHeading>
          <div className="space-y-4">
            <p className="text-fg-2">
              The <Link href="/census" className={link}>census</Link> counts characters from players who run the census in the addon:
              their own characters, and the players they target, mouse over or group with. For other players the addon reads only race,
              class, level and faction. Never a name. The census is on in a new install and says so once in chat. An install from
              before the census keeps it off. <code className="font-mono text-fg">/everloot census off</code> turns it off and deletes
              its rows.
            </p>
            <p className="text-fg-2">
              Each character is counted once. The game&apos;s id for a character never reaches storage: before an upload is stored, the id is
              replaced with a keyed code that can&apos;t be turned back into it. The census keeps the latest report of each character, from
              any install, so a player seen by fifty uploaders who also uploads their own characters counts once, at the latest level seen.
            </p>
            <ul className="list-disc pl-6 space-y-1 text-fg-2">
              <li>Two windows: active in the last 7 days (the last seven UTC days, today included), and seen since launch. Reports from
                before launch, in the beta, are not counted.</li>
              <li>A count shows only when it covers at least 10 characters reported by at least 3 installs from at least 3 different
                addresses (each address is kept only as a keyed hash, so it can be counted but not read back). Below that it reads
                &ldquo;not enough reports&rdquo;, and until a whole window gets there the page says it is still collecting. Before launch it says so.</li>
              <li>A hidden count could otherwise be worked out by taking the shown counts away from their total. So wherever one is
                hidden, more are hidden with it: in every total, at least two counts are hidden and together they cover at least
                10 characters. &ldquo;Not enough reports&rdquo; therefore means fewer than 10 characters, fewer than 3 installs or fewer than 3 addresses, or hidden to
                protect a small count.</li>
              <li>Every count that shows is rounded to the nearest 5, each from its own true number, so the shown counts don&apos;t
                add up exactly to their total either.</li>
              <li>Together these make a small count hard to work out from the published ones. They narrow what can be learned; they
                are not a guarantee. Someone who can send forged uploads could still probe a count by adding rows one at a time,
                which the limits on how much one install can send slow down but don&apos;t stop.</li>
              <li>Levels are grouped 1&ndash;9, 10&ndash;19 and so on up to 50&ndash;59, and at 60.</li>
              <li>One view for all of WoW: Forever for now. Realms are split by ruleset and region once launch shows how Forever names them.</li>
            </ul>
            <p className="text-fg-2">
              Both sources lean. Own characters over-represent people who install addons; players seen over-represent the zones uploaders
              play in. The census page shows what share came from each, so you can judge.
            </p>
          </div>
        </section>

        {/* Only while the guild pages are on: it describes pages, a ladder and a hide form that are off otherwise. */}
        {guildsOn() && <section aria-labelledby="guilds">
          <SectionHeading id="guilds">How guilds are counted</SectionHeading>
          <div className="space-y-4">
            <p className="text-fg-2">
              A guild&apos;s boss kills come from its own members. With <code className="font-mono text-fg">/everloot players on</code>,
              a kill inside a dungeon or raid is one row for the player&apos;s guild: the guild, the realm, the faction, the boss and the
              time. No names. A kill counts as the guild&apos;s once two installs report the same guild and boss, and its date is the
              earliest of their reports. One member&apos;s upload is not enough.
            </p>
            <ul className="list-disc pl-6 space-y-1 text-fg-2">
              <li>The ladder ranks one raid or dungeon at a time: bosses killed, then whoever reached their latest kill first. Guilds
                level on both share a rank. There is no score and no total across instances.</li>
              <li>An instance&apos;s boss list is the encounters three installs reported there. A kill of a boss not on it counts for
                nothing.</li>
              <li>Officers can also publish their guild&apos;s lockouts through the guild board. Those kills carry no date, so they rank
                after dated kills with the same count. A boss both report is listed once.</li>
              <li>The roster on a guild page is the characters the addon saw in that guild, newest first. They are sightings, not the
                game&apos;s member list. An officers&apos; roster, when they publish one, is shown above it.</li>
              <li>Anyone can hide a guild on the <Link href="/guilds/hide" className={link}>guild hide form</Link>, without an account or
                an officer rank. The guild leaves the pages, the ladder and the search at once, and its kills are not kept from then on.
                A character is hidden on its own <Link href="/players/opt-out" className={link}>hide form</Link>.</li>
            </ul>
          </div>
        </section>}

        {/* The full attribution. Pages carry none of their own; the footer's one line links here (docs/DATA_POLICY.md). */}
        <section aria-labelledby="credits">
          <SectionHeading id="credits">Credits</SectionHeading>
          <ul className="list-disc pl-6 space-y-3 text-fg-2">
            <li>
              <span className="text-fg">Blizzard Entertainment.</span> Game data, map pictures and loading screen art are © Blizzard
              Entertainment, Inc., read from the public game client and not under Everloot&apos;s licence. {CREDIT} Game files read from build{" "}
              <span className="font-mono">{CLIENT_LAYER.build.version}</span>; the map from build <span className="font-mono">{MAP_SOURCE.version}</span>
              {assets && <>; icons, tooltip text, map pictures and loading screen art from build <span className="font-mono">{assets.version}</span>, {assets.label}</>}.
              Blue posts on the <Link href="/changes" className={link}>changes page</Link> are Blizzard&apos;s text, each linked to its original on
              Blizzard&apos;s forum or Bluesky.
            </li>
            <li>
              <span className="text-fg">Warcraft Wiki contributors.</span> Item names, where the game files and the{" "}
              <a href={WIKI_URL} rel="noopener" className={link}>Warcraft Wiki</a> give the same one, quest titles, where the game files
              list the quest and the wiki titles it, and the{" "}
              <Link href="/lore" className={link}>lore archive</Link> (the wiki as of 13 November 2023), under CC BY-SA 4.0. Each lore page
              links its source.
            </li>
            <li>
              <span className="text-fg">WoWDBDefs.</span> Column names for the game&apos;s data tables, from{" "}
              <a href="https://github.com/wowdev/WoWDBDefs" rel="noopener" className={link}>WoWDBDefs</a>, CC BY-SA 4.0.
            </li>
            <li>
              <span className="text-fg">Everloot contributors.</span> Every drop, vendor, price, census count and addon install count comes from
              players&apos; uploads, published under CC BY-SA 4.0 and credited to Everloot contributors. The code is AGPL-3.0. Addon repository
              facts are read from GitHub; the <Link href="/addons/polestar" className={link}>Polestar</Link> addon is GPL-3.0 and its authors&apos;.
            </li>
          </ul>
        </section>
      </div>
    </ReadingLayout>
  );
}
