"use client";

import Link from "next/link";
import type { Crumb } from "@/lib/jsonld";
import { Card, Container, PageHeader } from "@/components/ui";

/**
 * What a section's error.tsx shows when a page below it throws (a storage read that failed, a release that would
 * not open). It names the section and says the page could not be read, so a visitor does not take it for an empty
 * one, and keeps the retry and the way back to the section hub. A failed render is never cached, so the page is
 * served per request until the read works again.
 */
export default function SectionUnavailable({ trail, title, message, hubHref, hubLabel, reset }: {
  trail: Crumb[];
  title: string;
  message: string;
  hubHref: string;
  hubLabel: string;
  reset: () => void;
}) {
  return (
    <Container width="reading">
      <article>
        <PageHeader trail={trail} title={title} />
        <Card>
          <p className="text-fg-2">{message}</p>
          <p className="mt-4 flex flex-wrap items-center gap-x-4 text-sm">
            <button type="button" onClick={reset} className="btn btn-primary">Try again</button>
            <Link href={hubHref} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{hubLabel}</Link>
          </p>
        </Card>
      </article>
    </Container>
  );
}
