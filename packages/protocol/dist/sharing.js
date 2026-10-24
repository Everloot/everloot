import { COMPLETION_OWNED_KINDS } from "./records.js";
/** The sharing category a record falls under, or null for anonymous records that need no choice. */
export function sharingCategory(row) {
    // A guild kill names a guild and a boss, never a person; it is public once 2 members' installs report it, with no grant.
    if (row.kind === "guild_kill")
        return null;
    if ("guildName" in row)
        return "guild";
    if (row.kind === "gear_snapshot")
        return "gear";
    if (row.kind === "gold_snapshot" || row.kind === "money_event")
        return "gold";
    if (row.kind === "collection_owned" || COMPLETION_OWNED_KINDS.includes(row.kind))
        return "collection";
    return null;
}
