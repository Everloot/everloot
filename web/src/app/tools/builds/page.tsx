import type { Metadata } from "next";
import DevicePlans from "@/components/workspace/DevicePlans";
import { Container, PageHeader } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { pageMetadata } from "@/lib/seo";

const TITLE = "Plans on this device";
const description = "Keep talent plans by name in this browser: open, rename, copy, back up and restore them. No account needed, and nothing is uploaded.";

// The plans are read in the browser, so the page is the same for everyone. Like /me, it is a private list,
// not a page for search. It is one of the protected pages (data/protected-paths.json): no ads or analytics load
// beside the plans and their notes.
export const metadata: Metadata = {
  ...pageMetadata({ title: TITLE, description, path: "/tools/builds" }),
  robots: { index: false, follow: false },
};

export default function DevicePlansPage() {
  return (
    <Container>
      <PageHeader
        title={TITLE}
        lede="Talent plans kept by name in this browser. No account needed, and nothing is uploaded."
        trail={trailFor("/tools/builds")!}
      />
      <DevicePlans />
    </Container>
  );
}
