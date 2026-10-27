import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { pageMetadata } from "@/lib/seo";
import AltPlanner from "./AltPlanner";

const TITLE = "Alts on this device";
const description = "Keep your characters in this browser: realm, class, level, faction, professions, notes and the talent plans each uses. Add them by hand or from your Everloot.lua. No account needed, and nothing is uploaded.";

// The alts are read in the browser, so the page is the same for everyone. Like Plans on this device it is a private
// list, not a page for search, and one of the protected pages (data/protected-paths.json): no ads or analytics load
// beside the alts and their notes.
export const metadata: Metadata = {
  ...pageMetadata({ title: TITLE, description, path: "/tools/alts" }),
  robots: { index: false, follow: false },
};

export default function AltsPage() {
  return (
    <Container>
      <PageHeader
        title={TITLE}
        lede="Your characters and the plans each uses, kept in this browser. No account needed, and nothing is uploaded."
        trail={trailFor("/tools/alts")!}
      />
      <AltPlanner />
    </Container>
  );
}
