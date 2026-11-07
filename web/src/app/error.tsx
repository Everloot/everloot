"use client";

import Link from "next/link";
import { Card, Container, PageHeader } from "@/components/ui";

// The site-wide boundary for a page that throws and has no boundary of its own. The header and footer
// around it come from the root layout, so the visitor still has the nav and a way back.
export default function SiteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Container width="reading">
      <article>
        <PageHeader title="Something went wrong" />
        <Card>
          <p className="text-fg-2">This page hit a problem and couldn&apos;t load. Try again, or head back to the start.</p>
          <p className="mt-4 flex flex-wrap items-center gap-x-4 text-sm">
            <button type="button" onClick={reset} className="btn btn-primary">Try again</button>
            <Link href="/" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Home</Link>
            <Link href="/database" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">The database</Link>
          </p>
        </Card>
      </article>
    </Container>
  );
}
