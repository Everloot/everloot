"use client";

import SectionUnavailable from "@/components/SectionUnavailable";
import { trailFor } from "@/lib/breadcrumbs";

// Shown when a tool page throws, most often because storage could not be read (the profession pages read the
// whole corpus per request). It says the page could not be read, not that it is empty.
export default function ToolsUnavailable({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SectionUnavailable
      trail={trailFor("/tools")!}
      title="Tool unavailable"
      message="This tool could not be read right now. That does not mean its data is empty. Try again in a few minutes."
      hubHref="/tools"
      hubLabel="All tools"
      reset={reset}
    />
  );
}
