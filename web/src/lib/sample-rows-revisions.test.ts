import { expect, test } from "vitest";
import { AGGREGATES_REVISION } from "./aggregate-store";
import { FARM_AREAS_REVISION } from "./farm-areas-store";
import { INSTANCE_FACTS_REVISION } from "./instance-facts-store";
import { NPC_FACTS_REVISION } from "./npc-facts-store";
import { SEARCH_NAMES_REVISION } from "./search-names-store";

/**
 * The stored views built from the corpus were written while it still published the upload page's sample rows (a
 * Forest Spider, NPC 1234, at level 60, and a drop of item 456). A view is rewritten on an idle run only when its
 * stamp differs, so each one moved past the revision those files carry.
 */
test("every stored view built from the corpus moved past the revision written with the sample rows", () => {
  const written = { aggregates: "npc-facts-1", npcFacts: "npc-facts-1", instanceFacts: "instance-facts-1", farmAreas: "farm-2", searchNames: "names-2" };
  const now = { aggregates: AGGREGATES_REVISION, npcFacts: NPC_FACTS_REVISION, instanceFacts: INSTANCE_FACTS_REVISION, farmAreas: FARM_AREAS_REVISION, searchNames: SEARCH_NAMES_REVISION };
  for (const [view, revision] of Object.entries(now)) expect(revision, view).not.toBe(written[view as keyof typeof written]);
});
