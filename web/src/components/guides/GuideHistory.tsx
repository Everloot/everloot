import { SectionHeading } from "@/components/ui";
import type { GuideFrontMatter } from "../../../../kb/src/guides/guide";

// Every published version of a guide, newest first: who reviewed it, on which day, against which game build, and what
// changed. The guide check never lets a published entry change or go, so each version keeps its words and its anchor
// (#version-<n>) for as long as the guide is up.

export default function GuideHistory({ history, version }: { history: GuideFrontMatter["history"]; version: number }) {
  return (
    <section aria-labelledby="history" className="mt-12">
      <SectionHeading id="history" note="Every published version, newest first. A change to a published guide is a new version, with its own review.">
        Version history
      </SectionHeading>
      <ol className="space-y-4 text-sm">
        {[...history].reverse().map((h) => (
          <li key={h.version} id={`version-${h.version}`} className="scroll-mt-24 space-y-1">
            <p className="font-semibold text-fg">
              Version {h.version}{h.version === version && <span className="font-normal text-muted"> (this version)</span>}
            </p>
            <p className="text-fg-2">Reviewed by {h.by} on <time dateTime={h.on}>{h.on}</time> against game build {h.build}.</p>
            <p className="text-fg-2">{h.note}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
