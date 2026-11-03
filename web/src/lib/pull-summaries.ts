import type { IntakeRecord } from "@everloot/protocol";
import { linkRealmKey } from "./character-links";

/**
 * Pull summaries: each group member's damage meter totals for one boss pull, named, as the uploader's addon recorded
 * them (docs/design/specs/2026-11-02-pull-and-run-records-design.md). Everything here is off until
 * EVERLOOT_PULL_SUMMARIES=1. With it unset, intake parses as it did before pull timing (`runRecords: false`), so
 * pull_summary and instance_run are unknown kinds, and nothing writes the pull tables; only the cron's retention
 * still runs, so rows kept while it was on go after their year. With it on, intake writes them to the pull tables
 * (lib/pull-store.ts), never to the upload object or the corpus, so a hidden character can be deleted from them.
 * Nothing shows them.
 */

export type PullRow = Extract<IntakeRecord, { kind: "pull_summary" }>;
type PullMember = PullRow["members"][number];

export function isPullRow(row: IntakeRecord): row is PullRow {
  return row.kind === "pull_summary";
}

/** The owner's switch for collecting and storing pull summaries. */
export function pullSummariesOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.EVERLOOT_PULL_SUMMARIES === "1";
}

/** How long a pull is kept after it was received. A row dated further back would be deleted on arrival. */
export const PULL_KEPT_DAYS = 365;

/** A member as stored: its realm always filled in, so the hide form's realm and name reach it. */
export type StoredPullMember = PullMember & { realm: string };

/** One pull as the tables store it: the row without its members, and the members with their realms. */
export interface PullUpsert {
  installId: string;
  eventId: string;
  capturedAt: string;
  summary: Omit<PullRow, "members">;
  members: StoredPullMember[];
}

/** Why this row cannot be stored, or null. The date and realm come from the player's file. */
export function pullProblem(row: PullRow, now: Date): string | null {
  if (!row.eventId) return "A pull summary needs its event id.";
  const at = Date.parse(row.capturedAt);
  const day = 86_400_000;
  if (!Number.isFinite(at) || at > now.getTime() + day || at < now.getTime() - PULL_KEPT_DAYS * day) {
    return `A pull summary must be dated within ${PULL_KEPT_DAYS} days back and 1 day ahead of the server's time.`;
  }
  for (const m of row.members) {
    const realm = (m.realm ?? row.realm ?? "").trim();
    const key = linkRealmKey(realm);
    if (realm.length < 2 || realm.length > 40 || key.length < 2 || key.length > 40) {
      return "A pull summary needs a realm the store can keep for every member, so a hidden character can be found.";
    }
  }
  return null;
}

export function pullUpsert(row: PullRow): PullUpsert {
  const { members, ...summary } = row;
  return {
    installId: row.installId, eventId: row.eventId!, capturedAt: row.capturedAt, summary,
    members: members.map((m) => ({ ...m, realm: (m.realm ?? row.realm)!.trim() })),
  };
}
