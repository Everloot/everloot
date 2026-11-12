/** Presentation only: the recorded identity remains the filter key. */
export function opsRealmLabel(recorded: string): { label: string; ruleset: "PvP" | "PvE" | null } {
  const match = /^CAMWOW ([A-Z]{2}\d+) Realm (\d+) (PvP|PvE)$/.exec(recorded);
  return match ? { label: `${match[1]} · Realm ${match[2]}`, ruleset: match[3] as "PvP" | "PvE" } : { label: recorded, ruleset: null };
}
