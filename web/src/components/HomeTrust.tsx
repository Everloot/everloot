import Link from "next/link";
import { Card, GET_THE_ADDON, SectionHeading } from "@/components/ui";
import type { CoverageSummary } from "@/lib/coverage-summary";
import { dataAgeLabel } from "@/lib/data-age";

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const count = (value: number) => value.toLocaleString("en-US");

/**
 * The site's one promise with its numbers beside it: how many installs have reported, how many facts they have
 * confirmed and how many wait on one or two more installs, and when the data was current. Each figure says what it
 * counts. A score that cannot be read says "unrecorded" for every figure, never zero.
 */
export default function HomeTrust({ summary }: { summary: CoverageSummary | null }) {
  const figures = [
    { id: "installs", label: summary?.installs === 1 ? "install reporting" : "installs reporting", value: summary?.installs, note: "Distinct installs behind the facts counted here." },
    { id: "confirmed", label: "confirmed facts", value: summary?.confirmed, note: "Facts that 3 or more installs agree on." },
    { id: "waiting", label: "facts waiting", value: summary?.waiting, note: "Seen by 1 or 2 installs; each needs 1 or 2 more to agree." },
  ];
  return (
    <section aria-labelledby="promise" data-home-trust>
      <SectionHeading
        id="promise"
        note="Counted across the released zones, from the same score the MCP coverage tool reads."
        action={<Link href="/database/coverage" className={link}>Coverage by zone →</Link>}
      >
        Every fact shows how many players saw it, and when.
      </SectionHeading>
      <Card className="space-y-4">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
          {figures.map((f) => (
            <div key={f.id} data-figure={f.id}>
              <dt className="font-mono text-xs text-muted">{f.label}</dt>
              <dd className={f.value === undefined ? "mt-1 text-2xl font-semibold text-fg-2" : "mt-1 text-4xl font-bold tabular-nums tracking-tight text-fg"}>
                {f.value === undefined ? "unrecorded" : count(f.value)}
              </dd>
              <dd className="mt-1 max-w-[32ch] text-sm text-muted">{f.note}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted">
          {summary ? `${dataAgeLabel(summary.dataAsOf)}${summary.build ? `, build ${summary.build}` : ""}.` : "Data age unrecorded: the coverage score could not be read just now."}
        </p>
        <p className="text-sm text-fg-2">
          {summary && summary.waiting > 0
            ? "Every install that uploads moves facts from waiting to confirmed."
            : "A fact shows once 3 installs agree on it."}{" "}
          <Link href={GET_THE_ADDON.href} className={link}>{GET_THE_ADDON.label}</Link>
        </p>
      </Card>
    </section>
  );
}
