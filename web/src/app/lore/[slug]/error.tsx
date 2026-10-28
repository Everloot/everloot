"use client";

import Link from "next/link";
import { Card, Container, PageHeader } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";

// Shown when the page throws because the knowledge release could not be opened. A failed render is
// never cached, so this page is served per request until the release opens again.
export default function LoreUnavailable({ reset }: { error: Error; reset: () => void }) {
  return (
    <Container width="reading">
      <article>
        <PageHeader trail={trailFor("/lore")!} title="Lore archive unavailable" />
        <Card>
          <p className="text-fg-2">The lore archive couldn&apos;t load right now. Try again in a few minutes.</p>
          <p className="mt-4 flex flex-wrap items-center gap-x-4 text-sm">
            <button type="button" onClick={reset} className="btn btn-primary">Try again</button>
            <Link href="/lore" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Lore archive</Link>
          </p>
        </Card>
      </article>
    </Container>
  );
}