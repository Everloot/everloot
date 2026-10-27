import Link from "next/link";
import { longDate } from "@/data/wow-forever";
import { TYPE_LABEL, postPath, type ChangeEntry } from "@/lib/changes";

/**
 * A short list of timeline entries: the title in a blue post's blue, linked to its page on Everloot (a build
 * has none, so its title stays plain), then its long date, kept on one line. `types` puts the type before the
 * date, for a list that mixes posts, hotfixes and builds.
 */
export default function ChangeList({ entries, types = false, columns = false }: { entries: ChangeEntry[]; types?: boolean; columns?: boolean }) {
  return (
    <ul className={columns ? "grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3" : "space-y-3"}>
      {entries.map((e) => {
        const page = postPath(e);
        return (
          <li key={e.id} className="min-w-0 text-cell">
            {page
              ? <Link href={page} className="text-blue-post hover:underline underline-offset-4 [overflow-wrap:anywhere]">{e.title}</Link>
              : <span className="text-fg [overflow-wrap:anywhere]">{e.title}</span>}
            <span className="block text-meta text-muted">
              {types && <span className="font-mono text-xs">{TYPE_LABEL[e.type]} · </span>}
              <time dateTime={e.at} className="whitespace-nowrap">{longDate(e.at.slice(0, 10))}</time>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
