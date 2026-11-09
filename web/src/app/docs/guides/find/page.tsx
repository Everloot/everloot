import type { Metadata } from "next";
import Link from "next/link";
import { Callout, C, Cards, H2, LinkCard, List, P, docLink } from "@/components/docs/blocks";
import DocPage from "@/components/docs/DocPage";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Find things on the site",
  description: "How to search Everloot, browse the database and zone pages, use the world map, read the lore archive and open the tools.",
  path: "/docs/guides/find",
});

export default function Page() {
  return (
    <DocPage href="/docs/guides/find">
      <P>
        Everloot has a few ways in. Search is the quickest if you know a name or an id. The database, the map, the lore
        archive and the tools are for when you want to look around.
      </P>
      <Cards cols={3}>
        <LinkCard href="/search" title="Search" icon="search">Items, NPCs, quests, zones, lore and tools.</LinkCard>
        <LinkCard href="/database" title="Database" icon="database">Items, NPCs, quests, vendors, drops and zones.</LinkCard>
        <LinkCard href="/map" title="World map" icon="compass">Continents, zones, flight paths and coordinates.</LinkCard>
        <LinkCard href="/lore" title="Lore archive" icon="book">Warcraft lore and history.</LinkCard>
        <LinkCard href="/tools/talents" title="Tools" icon="spark">Start with the talent calculator.</LinkCard>
      </Cards>

      <H2 id="search">Search</H2>
      <P>
        Use the search box in the header, or go straight to <Link href="/search" className={docLink}>/search</Link>. It
        looks across items, NPCs, quests, zones, lore pages and Everloot&apos;s tools. Type a name or an id: an exact id or
        name comes first.
      </P>
      <Callout kind="note">
        <p>
          Items, NPCs and quests are searchable by name once 3 installs agree on the name. An id always opens its page,
          so try the id if a name finds nothing.
        </p>
      </Callout>

      <H2 id="database">The database</H2>
      <P>
        The <Link href="/database" className={docLink}>database</Link> is built from what players upload. A fact is
        public once 3 installs agree on it. It has these sections:
      </P>
      <List>
        <li><Link href="/database/zones" className={docLink}>Zones</Link>: every zone by continent, with its map, the dungeons and raids entered there, and the NPCs, vendors and quests players have confirmed in it.</li>
        <li><Link href="/database/items" className={docLink}>Items</Link>: every item in the current build by class, subclass, slot and quality, read from the game files and labelled unconfirmed until players see it.</li>
        <li><Link href="/database/drops" className={docLink}>Drops</Link>: how often an item was seen in a loot window from a source. These are observations, not verified drop probabilities.</li>
        <li><Link href="/database/npcs" className={docLink}>NPCs</Link>: where an NPC has been seen, from corroborated sightings.</li>
        <li><Link href="/database/vendors" className={docLink}>Vendors</Link>: merchant lists. A price is public after 3 installs agree on the item and the price.</li>
        <li><Link href="/database/quests" className={docLink}>Quests</Link>: givers, turn-ins and rewards.</li>
        <li><Link href="/database/objects" className={docLink}>Objects</Link>: chests, herbs, ore veins and fishing pools, with what players looted from them.</li>
      </List>
      <P>
        Entries read from the game files rather than seen in play are labelled &quot;found in game files, unconfirmed&quot;.
        That means the game files list it, not that it is, or will be, in the game.
      </P>

      <H2 id="map">The world map</H2>
      <P>
        The <Link href="/map" className={docLink}>world map</Link> shows zones, dungeon and raid entrances, flight masters
        and flight paths, plus the NPCs and vendors players have seen.
      </P>
      <List>
        <li><strong>Zoom.</strong> Pick a continent at the top of the sidebar. Click a zone to zoom to it, and click a pin for its card. Drag, scroll or pinch to move around, or use the arrow keys, plus and minus.</li>
        <li><strong>Search.</strong> The search box in the sidebar finds a zone, entrance, flight master or NPC.</li>
        <li><strong>Categories.</strong> The sidebar groups what the map can show: travel, instances, places, services and gathering, each category with how many the zone in view (or the continent) has. Services and gathering fill from addon uploads once 3 installs agree on a place; until then they show 0, and how many places 1 or 2 installs have seen so far. Show all and Hide all switch them together. The arrow at the top folds the sidebar away; the map remembers that in your browser.</li>
        <li><strong>List.</strong> The List tab has everything the map shows, as lists, with a Show on map button on each row. It follows the same category switches.</li>
        <li><strong>On a phone.</strong> The bar along the bottom opens Categories, Search and the List as sheets. Drag a sheet up for the whole screen, or down to close it.</li>
        <li><strong>Coordinates.</strong> Select a pin or zone and use Copy /way on its card. Paste the line into the game chat to set a waypoint, in the form <C>/way 42.5 61 Name</C>.</li>
        <li><strong>Links.</strong> Each continent has its own page, <Link href="/map/eastern-kingdoms" className={docLink}>Eastern Kingdoms</Link> and <Link href="/map/kalimdor" className={docLink}>Kalimdor</Link>. The address keeps your view, the categories shown, an open search and the List tab, so a link opens the same place; Copy link on a card links that one pin. Back returns from a zone to the continent.</li>
      </List>
      <Callout kind="warning">
        <p>
          Zone outlines, entrances and flights are read from the game files, so they are unconfirmed until players see
          them. Zones that may not be released are held back. Show spoilers, in the sidebar, shows them,
          dashed and marked unconfirmed.
        </p>
      </Callout>

      <H2 id="lore">The lore archive</H2>
      <P>
        The <Link href="/lore" className={docLink}>lore archive</Link> is the Warcraft Wiki as it stood on 13 November
        2023, searchable, with a source link on every page and credit under CC BY-SA 4.0. It is lore and history, not
        data collected from WoW: Forever.
      </P>

      <H2 id="tools">Tools</H2>
      <P>
        The Tools menu in the header lists every tool. Some are live and some are still collecting data, and each page
        says which. A few to start with:
      </P>
      <Cards>
        <LinkCard href="/tools/talents" title="Talent calculator">Plan a build and share it with its game build attached. Trees and rules are unconfirmed, read from build 1.60.1.</LinkCard>
        <LinkCard href="/tools/raid" title="Raid group builder">Plan a raid and see which buffs it covers.</LinkCard>
        <LinkCard href="/tools/auctions" title="Auction prices">Auction prices from full scans players started and uploaded.</LinkCard>
        <LinkCard href="/census" title="Census">Who plays what: race, class, level and faction counts from the addon&apos;s census.</LinkCard>
      </Cards>
      <P>
        Gold per hour is now part of the addon: <C>/everloot gph start</C> in game. See{" "}
        <Link href="/docs/guides/addon#commands" className={docLink}>the slash commands</Link>.
      </P>
    </DocPage>
  );
}
