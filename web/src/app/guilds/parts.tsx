import type { Metadata } from "next";
import type { GuildFaction } from "../../../../kb/src/guilds";
import { factionLabel, guildIndexingOn } from "@/lib/guilds";

export const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
export const number = (n: number) => n.toLocaleString("en-US");
/** The day of an ISO time, the only part a guild page shows. */
export const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/** Guild pages stay out of search engines until EVERLOOT_GUILDS_INDEX=1; a search result page always does. */
export function guildRobots(alwaysNoindex = false): Metadata["robots"] {
  return alwaysNoindex || !guildIndexingOn() ? { index: false, follow: false } : { index: true, follow: true };
}

/** The faction as a word with its mark: a solid dot for the Alliance, a dashed ring for the Horde, as the rankings draw them. */
export function FactionMark({ faction }: { faction: GuildFaction | null }) {
  const label = factionLabel(faction);
  if (!label) return <span className="text-muted">Not known yet</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-fg-2">
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${faction === "horde" ? "border border-dashed border-fg-2" : "bg-fg-2"}`} />
      {label}
    </span>
  );
}

/** Bosses killed out of the instance's bosses, with a thin bar. The numbers carry it; the bar is decoration. */
export function Progress({ killed, bosses, className = "" }: { killed: number; bosses: number; className?: string }) {
  const share = bosses > 0 ? Math.min(1, killed / bosses) : 0;
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <span className="font-mono tabular-nums text-fg">{killed}/{bosses}</span>
      <span aria-hidden="true" className="block h-1 w-16 shrink-0 rounded-full bg-line lg:w-24">
        <span className="block h-1 rounded-full bg-accent" style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
    </span>
  );
}

/** Who reported a kill, in words. */
export const sourceLabel = (source: "members" | "officers" | null) => (source === "members" ? "Members" : source === "officers" ? "Officers" : "");
