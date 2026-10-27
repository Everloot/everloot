import buildsJson from "../changes/builds.json" with { type: "json" };
import { buildsResource, CREDIT_LINE, GAME_DATA_CREDIT, LICENCE, MCP_CREDIT, MCP_RESOURCES, SITE, TERMS_URL, type BuildsResource, type McpResourceUri } from "@everloot/protocol";
import { CLIENT_LAYER } from "./client-layer-file.js";

/**
 * The MCP server's resources: documents a client reads whole, listed in the protocol's MCP_RESOURCES.
 * The builds registry is the committed kb/changes/builds.json, bundled like the client layer so the
 * site's mount and the standalone server read the same file. The two texts restate the site's
 * methodology page and docs/DATA_POLICY.md in short; resources.test.ts holds them to those documents.
 */

/** The build registry, newest first, with the build the game-file facts come from. */
export function buildsContents(): BuildsResource {
  const registry = [...(buildsJson as { builds: BuildsResource["registry"] }).builds]
    .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen) || b.buildId - a.buildId);
  return buildsResource.parse({ gameFiles: CLIENT_LAYER.build, registry, credit: GAME_DATA_CREDIT });
}

export function methodologyText(sourceUrl: string): string {
  return [
    "# How Everloot counts",
    "",
    "Every fact on Everloot comes from players running the Everloot addon and choosing to upload what it recorded. " +
      `This is how those uploads become the numbers the tools return, and what is never published. The full rules are the data policy, ${sourceUrl}/blob/main/docs/DATA_POLICY.md (short form: everloot://data-policy). The page: ${SITE}/methodology.`,
    "",
    "## Three installs have to agree",
    "",
    "A drop, a vendor item, a spawn point, a recipe range or a market price appears only once at least three different installs have reported it the same way. " +
      "For prices and catalog entries, \"different\" means different upload addresses, with an IPv6 address counted by its /64 block, so one household cannot make a fact true on its own. " +
      "Until three agree, the answer says so instead of guessing.",
    "",
    "## Unrecorded is not zero",
    "",
    "If nobody has recorded something, the answer says unrecorded. A zero appears only when it was measured: for example, \"0 drops in 40 kills\" once three installs killed that creature and none of them saw the item. " +
      "A storage outage or a missing source is never shown as zero either, and a tool that is not connected to the corpus says so: that is not a measured zero.",
    "",
    "Loot windows show what dropped, not how many kills it took, so they do not make a drop rate on their own. A rate is drops divided by recorded kills.",
    "",
    "## Game files and play are kept apart",
    "",
    "Some answers (entity_relations, item_categories, class_races, the talent calculator, the map) use data read from the game's own files. " +
      "It is labelled found in game files, unconfirmed, with the build it came from, until players see it in play. The build is in everloot://builds. " +
      `That data is Blizzard's and is not under Everloot's licence. ${GAME_DATA_CREDIT}`,
    "",
    "## What is never published",
    "",
    "- Character names, unless that player shares them on purpose from the upload page. Guild data needs an officer's upload.",
    "- An install id, or the address an upload came from. Where an address matters for counting, a keyed hash is kept in private storage.",
    "- A player's list of addons, row by row. It is off unless the player turns it on, and only counts that three installs share are shown.",
    "",
    "Uploaded observations are public as anonymous records, so anyone can check the counts.",
    "",
    "## Population numbers",
    "",
    "Everloot does not publish player counts yet. When it does, each character will be counted once however often it is seen, and the methodology page will say exactly how the count works before the first number goes up.",
    "",
    "## Age of the data and credit",
    "",
    `Answers built on player data end with how old the data is and the credit line. ${MCP_CREDIT}`,
    "",
  ].join("\n");
}

export function dataPolicyText(sourceUrl: string): string {
  const policy = `${sourceUrl}/blob/main/docs/DATA_POLICY.md`;
  return [
    "# Everloot data policy, in short",
    "",
    `Where Everloot's data comes from, what it refuses to use, and how it may be reused. The full policy is ${policy}; this is Everloot's reading of the rules, not legal advice.`,
    "",
    "## What is published",
    "",
    "- What players see in the game: drops, vendors, auction prices they browse, recipes, trainers, gold in and out, recorded by the Everloot addon and uploaded when the player chooses. " +
      "Uploaded observations are public as anonymous records, with no character names and without the addon's install id.",
    "- The facts the site states itself, such as drop rates, spawn points and recipe ranges, appear only once at least three installs have reported them (everloot://methodology).",
    "- Full auction scans are not public records. They feed market values only, and a value is published when three distinct reporters scanned the item.",
    "- Addon lists are never published row by row, only as counts for addons that at least three installs report. Guild data is published only through an officer's upload, and named records only with that person's sharing choice.",
    "- From the game files: the talent catalog, the map layer, the raid buff table, the client layer (item categories and relations) and build changes, read from unencrypted files only, " +
      "each labelled found in game files, unconfirmed, and stamped with its build. That data is Blizzard's, kept apart from Everloot's data and not under its licence; column names come from WoWDBDefs (CC BY-SA 4.0).",
    "- Blizzard's icons, tooltip text and frame art appear on the site's pages only. The downloads, the API and the MCP server carry ids and facts, plus a link to the page.",
    "- Blizzard's posts, as excerpts only: title, author, time, a short excerpt and the link to the original. The text is Blizzard's.",
    "- The lore archive is built from the Warcraft Wiki dump of 2023-11-13 (CC BY-SA 4.0). Every hit carries its source and licence.",
    "",
    "## What is refused",
    "",
    "- Bulk scraping of any site. No crawlers, no copying another database's rows, guides or text. If a site's terms or robots.txt say no, the answer is no.",
    "- Touching the running game. No reading or changing the game's memory, no automation, no bypassing protections. The addon uses only the game's own addon API.",
    "- Decrypting game data. Content Blizzard encrypts stays encrypted.",
    "- Bulk exports of Blizzard's art or text.",
    "- Unreviewed spoilers. No game file entry is shown as a discovery without review, and anything that could spoil unreleased content stays hidden unless the reader turns spoilers on.",
    "- We link to Wowhead and never copy it. Nothing from it is republished on the site, in the dataset or by the MCP server.",
    "",
    "## Licence, credit and limits",
    "",
    `- Everloot's own data is ${LICENCE}. Anyone may read it, copy it and build on it. Credit it wherever it appears: "${CREDIT_LINE}" What you build from it stays under the same licence.`,
    "- Game-file data and Blizzard's posts are Blizzard's, not Everloot's; the credit line and the licence do not apply to them. The code is AGPL-3.0.",
    `- Asking questions through this server is free and needs no key. Copying everything in bulk takes a free key, made on ${SITE}/docs/api/keys; the exact limits are on ${SITE}/connect.`,
    `- Terms: ${TERMS_URL}. Questions and takedown requests: hello@everloot.app or ${SITE}/contact.`,
    "",
  ].join("\n");
}

/** The contents of one resource, in the type MCP_RESOURCES declares for it. */
export function readResource(uri: McpResourceUri, sourceUrl: string): { mimeType: string; text: string } {
  const mimeType = MCP_RESOURCES[uri].mimeType;
  switch (uri) {
    case "everloot://builds": return { mimeType, text: JSON.stringify(buildsContents(), null, 2) };
    case "everloot://methodology": return { mimeType, text: methodologyText(sourceUrl) };
    case "everloot://data-policy": return { mimeType, text: dataPolicyText(sourceUrl) };
  }
}
