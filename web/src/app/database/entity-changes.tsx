import Link from "next/link";
import { SectionHeading } from "@/components/ui";
import { ChangeEntry } from "@kb/build-watch/changes";
import { entityChanges, type EntityBuildChanges, type EntityRef } from "@kb/build-watch/entity-changes";
import { PUBLISHED_CHANGES } from "@/lib/talents/freshness-records";
import { LINK } from "./entity";

let parsed: ChangeEntry[] | null = null;

/**
 * One entity's changes across builds, from the build watch's committed records (web/src/data/game-data/changes/).
 * A record that does not read is skipped: the talent pages already flag it, and a page must not fail over it.
 */
export function changesFor(ref: EntityRef): EntityBuildChanges[] {
  parsed ??= PUBLISHED_CHANGES.flatMap((raw) => {
    const r = ChangeEntry.safeParse(raw);
    return r.success ? [r.data] : [];
  });
  return entityChanges(parsed, ref);
}

/** The build on the /changes timeline, filtered to builds and to that version. */
const buildHref = (version: string) => `/changes?show=builds&q=${encodeURIComponent(version)}`;

/**
 * The Changes slot of an entity page: what each build changed about this entity, newest first. Nothing at all when it
 * never changed in a build players can play.
 */
export default function EntityChanges({ changes, name }: { changes: EntityBuildChanges[]; name: string }) {
  if (!changes.length) return null;
  return (
    <section aria-labelledby="entity-changes">
      <SectionHeading id="entity-changes" note="From the game files of each build: found in game files, unconfirmed.">Changes across builds</SectionHeading>
      <ol className="space-y-4" aria-label={`${name}: changes across builds`}>
        {changes.map((b) => (
          <li key={b.id}>
            <p className="text-sm text-fg-2">Changed in build <Link href={buildHref(b.build)} className={`${LINK} font-mono tabular-nums`}>{b.build}</Link></p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-cell">
              {b.rows.map((r, i) => (
                <li key={i}>{r.before === null && r.after === null ? r.label : <>{r.label}: <span className="tabular-nums">{r.before ?? "none"} → {r.after ?? "none"}</span></>}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
