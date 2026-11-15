import { classHubHref, type ClassContext } from "./class-context";

export interface StartTile { key: string; label: string; note: string; href: string }

/** Fixed job order: the existing usage counters cover API/MCP calls, not page popularity. */
export function startTiles(armory: boolean, players = false): StartTile[] {
  return [
    { key: "talents", label: "Talents", note: "Plan and share a class build.", href: "/tools/talents" },
    { key: "items", label: "Gear and items", note: "Find equipment and recorded sources.", href: "/database/items" },
    { key: "dungeons", label: "Dungeons and raids", note: "Find entrances, bosses and reported loot.", href: "/database/instances" },
    { key: "professions", label: "Professions", note: "Browse recipes and leveling paths.", href: "/tools/professions" },
    { key: "auctions", label: "Auction prices", note: "Compare prices from auction scans.", href: "/tools/auctions" },
    { key: "map", label: "World map", note: "Explore zones and instance entrances.", href: "/map" },
    { key: "guides", label: "Guides", note: "See which class guides are reviewed.", href: "/guides" },
    { key: "addon", label: "Get the addon", note: "Record what you see while playing.", href: "/addon" },
    ...(armory || players ? [{ key: "character", label: armory ? "Armory" : "Characters", note: armory ? "Look up character gear and guilds." : "Find characters players have shared.", href: armory ? "/armory" : "/players" }] : []),
    { key: "class", label: "Your class hub", note: "Find your class’s tools and guides.", href: "/classes" },
  ];
}

export function startHref(tile: StartTile, context: ClassContext | null): string {
  if (!context) return tile.href;
  if (tile.key === "talents") return `/tools/talents/${context.classSlug}`;
  if (tile.key === "class") return classHubHref(context);
  return tile.href;
}
