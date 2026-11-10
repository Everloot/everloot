"use client";

import SectionUnavailable from "@/components/SectionUnavailable";
import { trailFor } from "@/lib/breadcrumbs";

// Shown when a database list or entity page throws, most often because storage could not be read. It says the
// page could not be read, not that it is empty, and the root boundary would not name the database.
export default function DatabaseUnavailable({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SectionUnavailable
      trail={trailFor("/database")!}
      title="Database unavailable"
      message="This part of the database could not be read right now. That does not mean it is empty. Try again in a few minutes."
      hubHref="/database"
      hubLabel="The database"
      reset={reset}
    />
  );
}
