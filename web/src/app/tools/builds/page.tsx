import type { Metadata } from "next";
import DevicePlans, { type PlanTrees } from "@/components/workspace/DevicePlans";
import TransferPlans from "@/components/workspace/TransferPlans";
import { Container } from "@/components/ui";
import YourEverlootHeader from "@/components/YourEverloot";
import { trailFor } from "@/lib/breadcrumbs";
import { loadSiteAssets } from "@/lib/game-assets";
import { savedBuildsOn } from "@/lib/saved-builds";
import { TALENT_CLASSES, loadCatalog, type TalentClassSlug } from "@/lib/talents/catalogs";
import { publishedClassChanges } from "@/lib/talents/freshness-records";
import { pageMetadata } from "@/lib/seo";
import type { TalentCatalog } from "@/lib/talents/types";
import { examplePlans } from "@/lib/workspace-examples";
import { workspaceIcons } from "@/lib/workspace-icons";

const TITLE = "Plans on this device";
const description = "Keep talent plans by name in this browser: open, rename, copy, back up and restore them. No account needed, and nothing is uploaded.";

// The plans are read in the browser, so the page is the same for everyone. Like /me, it is a private list,
// not a page for search. It is one of the protected pages (data/protected-paths.json): no ads or analytics load
// beside the plans and their notes.
export const metadata: Metadata = {
  ...pageMetadata({ title: TITLE, description, path: "/tools/builds" }),
  robots: { index: false, follow: false },
};

/** Each class's tree build and change records, for the plans' notes; the trees themselves stay on the server. */
function planTrees(catalogs: Record<TalentClassSlug, TalentCatalog>): PlanTrees {
  return Object.fromEntries(TALENT_CLASSES.map((slug) => {
    const { classId, classSlug, build } = catalogs[slug];
    return [slug, { tree: { classId, classSlug, build }, changes: publishedClassChanges(classId) }] as const;
  }));
}

export default async function DevicePlansPage() {
  // With saved builds on, a signed-in player can save the plans kept signed out to the account, when they ask.
  const transfer = savedBuildsOn();
  const catalogs = Object.fromEntries(await Promise.all(TALENT_CLASSES.map(async (slug) => [slug, await loadCatalog(slug)] as const))) as Record<TalentClassSlug, TalentCatalog>;
  const icons = workspaceIcons(await loadSiteAssets());
  return (
    <Container>
      <YourEverlootHeader
        current="/tools/builds"
        title={TITLE}
        lede={`Talent plans kept by name in this browser. No account needed, and nothing is uploaded${transfer ? " unless you save plans to your account" : ""}. Tie a plan to a character on Alts on this device, which can read your addon's Everloot.lua.`}
        trail={trailFor("/tools/builds")!}
      />
      {transfer && <TransferPlans />}
      <DevicePlans trees={planTrees(catalogs)} examples={examplePlans(catalogs)} icons={icons} />
    </Container>
  );
}
