"use client";

import SectionUnavailable from "@/components/SectionUnavailable";
import { trailFor } from "@/lib/breadcrumbs";

// Shown when the page throws because the knowledge release could not be opened. A failed render is
// never cached, so this page is served per request until the release opens again.
export default function LoreUnavailable({ reset }: { error: Error; reset: () => void }) {
  return (
    <SectionUnavailable
      trail={trailFor("/lore")!}
      title="Lore archive unavailable"
      message="The lore archive couldn't load right now. Try again in a few minutes."
      hubHref="/lore"
      hubLabel="Lore archive"
      reset={reset}
    />
  );
}
