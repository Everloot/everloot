import { publicCharacter } from "@/lib/character-links-store";
import { characterShowcase, publishedFacts } from "@/app/characters/[ruleset]/[realm]/[name]/character-view";

/** Reuse the existing public readers: association never grants access to a private category. */
export async function addonProfile(identity: { ruleset: string; realm: string; name: string }) {
  const character = await publicCharacter(identity.ruleset, identity.realm, identity.name);
  if (!character) return null;
  const found = { ruleset: identity.ruleset, character };
  const facts = await publishedFacts(found);
  return characterShowcase(found, new Date(), [], facts);
}
