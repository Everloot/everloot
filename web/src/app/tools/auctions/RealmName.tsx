import { RULESET_LABEL, realmParts, type RulesetSlug } from "@/lib/realms";

/** The class for each ruleset's name colour, spelled out so Tailwind keeps them. */
const RULESET_TEXT: Record<RulesetSlug, string> = {
  normal: "text-realm-normal", pvp: "text-realm-pvp", rp: "text-realm-rp", "rp-pvp": "text-realm-rp-pvp", hardcore: "text-realm-hardcore",
};

/** A recorded CAMWOW name without its ruleset ("CAMWOW US1 Realm 4") as it is shown ("US1 · Realm 4"); other names as they are. */
function shortBase(base: string): string {
  const compact = /^CAMWOW ([A-Z]{2}\d+) Realm (\d+)$/i.exec(base);
  return compact ? `${compact[1]} · Realm ${compact[2]}` : base;
}

/** A realm's name as sentences and hover titles show it: "CAMWOW US1 Realm 4 PvP" is "US1 · Realm 4 PvP". Display only. */
export function realmDisplayName(name: string): string {
  const { base, ruleset } = realmParts(name);
  return ruleset ? `${shortBase(base)} ${RULESET_LABEL[ruleset]}` : name;
}

/**
 * Recorded CAMWOW labels are shortened for display, and the hover title gives the same display name.
 * The ruleset keeps its own colour. Other names remain intact.
 */
export function RealmName({ name }: { name: string }) {
  const { base, ruleset } = realmParts(name);
  if (!ruleset) return <>{name}</>;
  return (
    <span title={realmDisplayName(name)}>
      {shortBase(base)}{" "}
      <span data-ruleset={ruleset} className={`font-medium ${RULESET_TEXT[ruleset]}`}>{RULESET_LABEL[ruleset]}</span>
    </span>
  );
}
