import { sharingCategory, type IntakeRecord, type SharingCategory } from "@everloot/protocol";

export { sharingCategory, type SharingCategory };
export interface PublicationGrant {
  tokenHash: string;
  installId: string;
  realm: string;
  subjectType: "guild" | "character" | "install";
  subject: string;
  categories: SharingCategory[];
  expiresAt: string;
  verifiedBy: string;
  evidence: string;
  revokedAt: string | null;
}
export interface Suppression { realm: string; character: string }
export interface PublicationState { grants: PublicationGrant[]; suppressions: Suppression[] }

const clean = (s: string) => s.trim().toLowerCase();
/**
 * A realm as an opt-out matches it, however it was spelled: the rule of public.link_realm_key (lower case, the curly
 * apostrophe as a straight one, any run of spaces and hyphens as one space). The opt-out form stores realms this way.
 */
const realmKey = (s: string) => s.toLowerCase().replace(/’/g, "'").replace(/[\s-]+/g, " ").trim();

/** Schema-valid names and install strings never confer authority. Grants are server-issued. */
export function authorizeRecord(row: IntakeRecord, hashes: string[], state: PublicationState, now: Date): IntakeRecord | null {
  const category = sharingCategory(row);
  if (!category) return row;
  const allowed = state.grants.some((g) => hashes.includes(g.tokenHash) && !g.revokedAt &&
    Date.parse(g.expiresAt) > now.getTime() && g.installId === row.installId && g.categories.includes(category) &&
    ("realm" in row && row.realm !== undefined ? clean(g.realm) === clean(row.realm) : true) &&
    ("guildName" in row ? g.subjectType === "guild" && clean(g.subject) === clean(row.guildName) :
      "character" in row ? g.subjectType === "character" && clean(g.subject) === clean(row.character) : g.subjectType === "install"));
  if (!allowed) return null;
  const suppressed = (name: string, realm: string) => state.suppressions.some((s) => realmKey(s.realm) === realmKey(realm) && clean(s.character) === clean(name));
  if ("character" in row && suppressed(row.character, row.realm)) return null;
  if (row.kind === "loot_award" && suppressed(row.recipient, row.realm)) return null;
  if (row.kind === "guild_snapshot") {
    const members = row.members.filter((m) => !suppressed(m.name, row.realm));
    return members.length ? { ...row, members, claimToken: "verified-officer-grant" } : null;
  }
  if (row.kind === "attendance") {
    const present = row.present.filter((name) => !suppressed(name, row.realm));
    return present.length ? { ...row, present } : null;
  }
  return row;
}
