import { SectionHeading } from "@/components/ui";
import type { GuideFrontMatter } from "../../../../kb/src/guides/guide";

// A guide's sources: the Blizzard posts it cites, each linked where the claim it supports is made and listed with the
// day it was last checked. A guide that cites none says what it rests on instead, rather than leaving the list empty.

const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

export default function GuideSources({ sources }: { sources: GuideFrontMatter["sources"] }) {
  return (
    <section aria-labelledby="sources" className="mt-12">
      <SectionHeading id="sources">Sources</SectionHeading>
      {sources.length === 0 ? (
        <p className="text-sm text-fg-2">
          This guide cites no Blizzard post: its plan is checked against the talent tree from the game files, and the rest is its author&apos;s
          advice, reviewed before it was published.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} rel="noopener" className={LINK}>{s.title}</a>{" "}
              <span className="text-meta text-muted">· checked on <time dateTime={s.checkedOn}>{s.checkedOn}</time></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
