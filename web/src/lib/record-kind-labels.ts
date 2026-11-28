import type { RecordKind } from "@everloot/protocol";

/**
 * Each upload record kind as the upload preview names it ("NPC sightings", not npc_sighting). Typed against every
 * protocol kind, so a new kind fails the typecheck until it has a name here.
 */
export const RECORD_KIND_LABEL: Record<RecordKind, string> = {
  npc_sighting: "NPC sightings",
  loot: "Loot",
  quest: "Quests",
  vendor: "Vendors",
  item_seen: "Items seen",
  instance_entrance: "Dungeon and raid entrances",
  encounter: "Boss encounters",
  instance_run: "Dungeon and raid runs",
  object_sighting: "Object sightings",
  item_fact: "Item tooltip facts",
  guild_snapshot: "Guild rosters",
  raid_lockout: "Raid lockouts",
  attendance: "Raid attendance",
  loot_award: "Loot awards",
  gear_snapshot: "Gear",
  collection_catalog: "Collection lists",
  collection_owned: "Collections owned",
  achievement_catalog: "Achievement lists",
  reputation_catalog: "Reputation lists",
  title_catalog: "Title lists",
  quest_chain_catalog: "Quest chain lists",
  achievement_owned: "Achievements earned",
  reputation_owned: "Reputation standings",
  title_owned: "Titles earned",
  quest_owned: "Quests completed",
  auction_scan: "Auction scans",
  auction_snapshot: "Auction snapshots",
  recipe_seen: "Recipes seen",
  price_seen: "Prices seen",
  recipe_observed: "Recipes observed",
  trainer_seen: "Trainers seen",
  gold_snapshot: "Gold",
  money_event: "Money changes",
  addon_seen: "Installed addons",
  map_bounds: "Map bounds",
  talent_snapshot: "Talents",
  census_self: "Census: your characters",
  census_seen: "Census: characters seen",
  player_seen: "Players seen",
  character_link: "Character links",
  guild_kill: "Guild kills",
  pull_summary: "Boss pulls",
};

/** A kind's preview name; a kind the protocol does not know keeps its key. */
export const recordKindLabel = (kind: string): string => (RECORD_KIND_LABEL as Record<string, string>)[kind] ?? kind;
