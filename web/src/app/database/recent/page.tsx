import Link from "@/components/Link";
import { unstable_noStore as noStore } from "next/cache";
import EdgeDegraded from "@/components/EdgeDegraded";
import { Container, DataTitle } from "@/components/ui";
import { KIND_LABEL } from "@/lib/database-activity";
import { loadDatabaseActivity } from "@/lib/database-activity-store";
import { withPageNames } from "@/lib/home-live";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata({ title: "New public database facts", description: "Items, NPCs, quests, objects, bosses and entrances whose observations reached three installs recently. Follow the database RSS feed to see new public facts.", path: "/database/recent", feed: "/database/feed.xml" });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "27 Nov, 11:01 UTC": when the view was built, as a reader reads it (the full time stays in the tag). */
const builtAt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(+d) ? iso : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${d.toISOString().slice(11, 16)} UTC`;
};

export default async function RecentFactsPage() {
  const file = await loadDatabaseActivity();
  if (!file) noStore();
  // The names the fact pages and the home panel show, not the activity file's "Item #249881" fallback.
  const entries = file ? await withPageNames(file.entries) : [];
  return <Container><EdgeDegraded when={!file} /><article>
    <DataTitle title="New public facts" meta="The latest 500 entities to reach three installs in the last 30 days." />
    {file && <p className="mb-4 text-meta text-muted">Built <time dateTime={file.generatedAt}>{builtAt(file.generatedAt)}</time>.</p>}
    <p className="mb-4 text-meta text-muted">Updated by the snapshot every ten minutes. Historical dates marked estimated use the third report&apos;s capture day. <a href="/database/feed.xml" className="text-fg underline">RSS</a></p>
    {!file ? <p role="status">Public facts are temporarily unavailable. Please try again later.</p> : !entries.length ? <p>No new public facts in the last 30 days.</p> : <table className="w-full text-cell"><caption className="sr-only">Recently public database entities</caption><thead><tr><th scope="col">Entity</th><th scope="col">Kind</th><th scope="col">Public since (UTC)</th><th scope="col">Installs</th></tr></thead><tbody>{entries.map((e) => <tr key={`${e.kind}:${e.id}`} className="border-b border-edge"><td><Link prefetch={false} href={e.path} className="text-fg hover:underline">{e.name}</Link></td><td>{KIND_LABEL[e.kind] ?? e.kind}</td><td><time dateTime={e.publicAt}>{e.publicAt.slice(0, 10)}</time>{e.estimated ? " (estimated)" : ""}</td><td className="tabular-nums">{e.installs}</td></tr>)}</tbody></table>}
  </article></Container>;
}
