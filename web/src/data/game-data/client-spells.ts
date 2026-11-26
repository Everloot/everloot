// The tooltip numbers of the spells the site links (school, level, cast time, range, cooldown, duration, costs, the rank
// each replaces, effect values and the items that cast it), ids and numbers only. The JSON beside this file is generated
// by `npm run kb -- client-spells` (see README.md); do not edit it by hand.
import spellsJson from "./client-spells.json";
import { ClientSpells } from "@kb/client-spells";

export const CLIENT_SPELLS: ClientSpells = ClientSpells.parse(spellsJson);
