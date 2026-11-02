import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { loadSiteAssets } from "@/lib/game-assets";
import { pageMetadata } from "@/lib/seo";
import { loadCatalog } from "@/lib/talents/catalogs";
import { EXAMPLE_PLAN_SPECS, examplePlans } from "@/lib/workspace-examples";
import { workspaceIcons } from "@/lib/workspace-icons";
import AltPlanner from "./AltPlanner";

const TITLE = "Alts on this device";
const description = "Your characters in this browser: class, level, faction, professions, notes and the talent plans each uses. Add them by hand or from your Everloot.lua. No account needed, and nothing is uploaded.";

// The alts are read in the browser, so the page is the same for everyone. Like Plans on this device it is a private
// list, not a page for search, and one of the protected pages (data/protected-paths.json): no ads or analytics load
// beside the alts and their notes.
export const metadata: Metadata = {
  ...pageMetadata({ title: TITLE, description, path: "/tools/alts" }),
  robots: { index: false, follow: false },
};

export default async function AltsPage() {
  // Only the classes the example plans use; the trees stay on the server.
  const catalogs = Object.fromEntries(await Promise.all(EXAMPLE_PLAN_SPECS.map(async ({ classSlug }) => [classSlug, await loadCatalog(classSlug)] as const)));
  const icons = workspaceIcons(await loadSiteAssets());
  return (
    <Container>
      <PageHeader
        title={TITLE}
        lede="Your characters and the plans each uses, kept in this browser. No account needed, and nothing is uploaded. Add them by hand, or read them from your addon's Everloot.lua; the file stays on this page."
        trail={trailFor("/tools/alts")!}
      />
      <AltPlanner examplePlans={examplePlans(catalogs)} icons={icons} />
    </Container>
  );
}
