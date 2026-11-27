import Link from "@/components/Link";
import { longDate } from "@/data/wow-forever";
import { TYPE_LABEL, postDay, postPath, type ChangeEntry } from "@/lib/changes";

/**
 * A short list of timeline entries: the title in a blue post's blue, linked to its page on Everloot (a build
 * has none, so its title stays plain), then its long date, kept on one line. `types` puts the type before the
 * date, for a list that mixes posts, hotfixes and builds. `posts` gives an entry that stands for several posts under one
 * title that day (foldTitleDay) its count.
 */
export default function ChangeList({ entries, types = false, columns = false, posts }: {
  entries: ChangeEntry[]; types?: boolean; columns?: boolean; posts?: ReadonlyMap<string, number>;
}) {
  return (
    <ul className={columns ? "grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3" : "space-y-3"}>
      {entries.map((e) => {
        const page = postPath(e);
        return (
          <li key={e.id} className="min-w-0 text-cell">
            {page
              ? <Link href={page} className="text-blue-post hover:underline underline-offset-4 [overflow-wrap:anywhere]">{e.title}</Link>
              : <span className="text-fg [overflow-wrap:anywhere]">{e.title}</span>}
            {(posts?.get(e.id) ?? 1) > 1 && <span className="text-muted"> · {posts!.get(e.id)} posts</span>}
            <span className="block text-meta text-muted">
              {types && <span className="font-mono text-xs">{e.source === "manual" && e.type === "post" ? "Post" : TYPE_LABEL[e.type]} · </span>}
              <time dateTime={e.source === "manual" ? e.at.slice(0, 10) : e.at} className="whitespace-nowrap">{longDate(postDay(e))}</time>
            </span>
            {e.source === "manual" && <span className="block text-meta text-muted">Summary by Everloot. {e.summary} {e.url && <a href={e.url} className="text-fg underline underline-offset-4">Original source</a>}</span>}
          </li>
        );
      })}
    </ul>
  );
}
