import { guildBoard, guildFactsFromRecords, type GuildBoard, type GuildFacts } from "../../../kb/src/guild-board";
import { guildKey, guildKillsFromRecords, instanceDefs, officerKills, type AgreedKill, type GuildKillRow, type InstanceDef } from "../../../kb/src/guilds";
import { instanceFactsFromRecords } from "../../../kb/src/instances";
import { playerHideKey } from "./player-store";

/** What one corpus read rolls up to, kept until the corpus changes. */
export interface GuildRollup {
  key: string;
  rows: GuildKillRow[];
  instances: InstanceDef[];
  facts: GuildFacts;
  /** The officer boards, by guild key, for every guild an officer upload names. Names unchecked: never shown as they are. */
  boards: Map<string, GuildBoard>;
  /** Every character the officers' facts name, as `playerHideKey` keys. */
  names: Set<string>;
  officers: AgreedKill[];
}

/** A board worth keeping: something in it was agreed by two officer uploads. */
const published = (b: GuildBoard) => b.memberCount !== null || b.roster.length > 0 || b.progression.length > 0 || b.loot.length > 0 || b.present.length > 0;

export function buildGuildRollup(key: string, records: readonly unknown[], asOf: Date): GuildRollup {
  const facts = guildFactsFromRecords(records as unknown[]);
  const instances = instanceDefs(instanceFactsFromRecords(records as unknown[]), asOf);
  const named = new Map<string, { guildName: string; realm: string }>();
  for (const r of [...facts.counts, ...facts.members, ...facts.bosses, ...facts.loot, ...facts.attendance]) {
    if (r.guildName.trim() && r.realm.trim()) named.set(guildKey(r.realm, r.guildName), { guildName: r.guildName, realm: r.realm });
  }
  const boards = new Map<string, GuildBoard>();
  for (const [k, g] of named) {
    const board = guildBoard(g.guildName, g.realm, facts);
    if (published(board)) boards.set(k, board);
  }
  const names = new Set([
    ...facts.members.map((m) => playerHideKey(m.realm, m.name)), ...facts.loot.map((l) => playerHideKey(l.realm, l.recipient)),
    ...facts.attendance.map((a) => playerHideKey(a.realm, a.name)), ...facts.gear.map((g) => playerHideKey(g.realm, g.character)),
  ]);
  return { key, rows: guildKillsFromRecords(records), instances, facts, boards, names, officers: officerKills([...boards.values()], instances) };
}
