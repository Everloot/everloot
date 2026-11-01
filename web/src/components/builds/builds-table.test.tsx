import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { SavedBuild } from "@/lib/saved-builds";
import { loadCatalog } from "@/lib/talents/catalogs";
import type { ClassTalentChanges, TalentChange } from "@/lib/talents/freshness";
import { encodeBuild } from "@/lib/talents/share";
import BuildsTable from "./BuildsTable";
import { describeBuilds } from "./describe";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// The account's saved builds: what the list says about one made on an older game build than the calculator's tree.
// Made-up builds and talents on the real Mage tree, not game data.

const OLD = "1.0.0.1";
const saved = (over: Partial<SavedBuild> = {}): SavedBuild => ({
  id: "b1", slug: "frost1", name: "Frost", notes: null, classSlug: "mage", characterId: null,
  code: encodeBuild({ classSlug: "mage", specId: 0, build: OLD, ranks: { 90001: { rank: 1 } } }), code2: null,
  gameBuild: OLD, shared: false, active: false, link: null, updatedAt: "2026-10-20T12:00:00.000Z", showName: false, ...over,
});

/** One record from the tree's build back to OLD, changing `talents`; none at all when null. */
async function recordsFor(talents: TalentChange[] | null) {
  const { build } = await loadCatalog("mage");
  return (classId: number): ClassTalentChanges => ({
    classId,
    steps: talents === null ? [] : [{ build, previous: OLD, readable: true, baseline: false, spoiler: false, classChanged: false, talents, pointLevels: [], limits: [] }],
    unplaced: 0,
  });
}
const removed = (nodeId: number): TalentChange => ({ build: "9.9.9.9", nodeId, name: `Talent ${nodeId}`, spoiler: false, kind: "removed" });

test("a build made on an older game build whose talents changed says how many and links to the current calculator", async () => {
  const build = saved();
  const facts = await describeBuilds([build], await recordsFor([removed(90001), removed(90002)]));
  expect(facts.get("b1")).toMatchObject({ older: true, note: "Made on an older game build: the game files changed 1 of its talents since." });
  const html = renderToStaticMarkup(<BuildsTable builds={[build]} facts={facts} caption="Saved builds" />);
  expect(html).toContain("Made on an older game build: the game files changed 1 of its talents since.");
  expect(html.match(/<a href="([^"]+)"[^>]*>Open in the current calculator<\/a>/)?.[1]).toBe(`/tools/talents/mage?saved=b1#plan=${build.code}`);
  expect(html).toContain(OLD);
});

test("no note when none of its talents changed; only that it is older when the records cannot say", async () => {
  const build = saved();
  expect((await describeBuilds([build], await recordsFor([removed(90002)]))).get("b1")).toMatchObject({ older: true, note: null });
  const unknown = await describeBuilds([build], await recordsFor(null));
  expect(unknown.get("b1")?.note).toBe("Made on an older game build; whether its talents changed since is not known.");
  const current = (await loadCatalog("mage")).build;
  const fresh = saved({ gameBuild: current, code: encodeBuild({ classSlug: "mage", specId: 0, build: current, ranks: { 90001: { rank: 1 } } }) });
  const facts = await describeBuilds([fresh], await recordsFor(null));
  expect(facts.get("b1")).toMatchObject({ older: false, note: null });
  expect(renderToStaticMarkup(<BuildsTable builds={[fresh]} facts={facts} caption="Saved builds" />)).not.toContain("Open in the current calculator");
});
