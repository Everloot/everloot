import { RULESET_LABEL, realmParts, type RulesetSlug } from "@/lib/realms";

/** The class for each ruleset's name colour, spelled out so Tailwind keeps them. */
const RULESET_TEXT: Record<RulesetSlug, string> = {
  normal: "text-realm-normal", pvp: "text-realm-pvp", rp: "text-realm-rp", "rp-pvp": "text-realm-rp-pvp", hardcore: "text-realm-hardcore",
};

/**
 * A realm's name with its ruleset split off, as the game's realm list splits it: "CAMWOW US1 Realm 4" and, in the
 * ruleset's colour, "PvP". A realm with no ruleset is its plain name.
 */
export function RealmName({ name }: { name: string }) {
  const { base, ruleset } = realmParts(name);
  if (!ruleset) return <>{name}</>;
  return (
    <>
      {base}{" "}
      <span data-ruleset={ruleset} className={`font-medium ${RULESET_TEXT[ruleset]}`}>{RULESET_LABEL[ruleset]}</span>
    </>
  );
}
