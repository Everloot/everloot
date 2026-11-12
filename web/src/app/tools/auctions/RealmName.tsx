import { RULESET_LABEL, realmParts, type RulesetSlug } from "@/lib/realms";

/** The class for each ruleset's name colour, spelled out so Tailwind keeps them. */
const RULESET_TEXT: Record<RulesetSlug, string> = {
  normal: "text-realm-normal", pvp: "text-realm-pvp", rp: "text-realm-rp", "rp-pvp": "text-realm-rp-pvp", hardcore: "text-realm-hardcore",
};

/**
 * Recorded CAMWOW labels are shortened for display, with the full identity available as an abbreviation title.
 * The ruleset keeps its own colour. Other names remain intact.
 */
export function RealmName({ name }: { name: string }) {
  const { base, ruleset } = realmParts(name);
  if (!ruleset) return <>{name}</>;
  const compact = /^CAMWOW ([A-Z]{2}\d+) Realm (\d+)$/i.exec(base);
  const label = compact ? `${compact[1]} · Realm ${compact[2]}` : base;
  return (
    <abbr title={name} className="no-underline">
      {label}{" "}
      <span data-ruleset={ruleset} className={`font-medium ${RULESET_TEXT[ruleset]}`}>{RULESET_LABEL[ruleset]}</span>
    </abbr>
  );
}
