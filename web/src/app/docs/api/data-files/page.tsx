import type { Metadata } from "next";
import Link from "@/components/Link";
import { C, H2, P, docLink } from "@/components/docs/blocks";
import { CodeGroup } from "@/components/docs/DocsClient";
import DocPage from "@/components/docs/DocPage";
import { BULK_URL, CONNECT_EXAMPLES as ex } from "@/lib/docs/connect-data";
import { guardOn } from "@/lib/data-guard";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Data files",
  description: "Bulk downloads of Everloot's published data: newline-delimited JSON files with an index that lists each file's size, SHA-256 and licence.",
  path: "/docs/api/data-files",
});

const REPO = "https://github.com/Everloot/everloot";

export default function DataFilesPage() {
  const guard = guardOn();
  return (
    <DocPage href="/docs/api/data-files">
      {BULK_URL ? (
        <>
          <P>
            The published data as files: one newline-delimited JSON file per dataset (the public corpus, drop rates, relations,
            items) and an <C>index.json</C> that lists each file with its row count, size, SHA-256, licence and the API response
            whose rows it holds, so a file and the API never disagree on a shape.
          </P>

          <H2 id="exports">Exports</H2>
          <P>
            Each export is its own folder, never changed after it is written. <a href={`${BULK_URL}/latest.json`} className={docLink}>latest.json</a>{" "}
            points at the newest one, by a path relative to the same address.
          </P>
          <P>
            Exports are made by hand, not on a schedule, so the newest one can be older than the live API. Check{" "}
            <C>generatedAt</C> and <C>dataAsOf</C> in its index, and use the{" "}
            <Link href="/docs/api/corpus-public" className={docLink}>corpus API</Link> when you need what was uploaded since.
          </P>
          <div className="mt-6">
            <CodeGroup title="Find the newest export" tabs={[{ label: "cURL", lang: "bash", code: ex.bulkCurl }]} />
          </div>

          <H2 id="index-shape">The index</H2>
          <P>
            The shape of <C>index.json</C> is the <Link href="/docs/api/schemas#bulkIndex" className={docLink}><C>bulkIndex</C></Link>{" "}
            schema, also at <a href="/schema/api/bulkIndex.json" className={docLink}><C>/schema/api/bulkIndex.json</C></a>.
          </P>
        </>
      ) : (
        <>
          <H2 id="no-bulk-download-yet">No bulk download yet</H2>
          <P>
            There is no bulk download yet. A full export of the published data is on the{" "}
            <a href={`${REPO}/blob/main/ROADMAP.md`} rel="noopener" className={docLink}>roadmap</a>, planned after launch.
          </P>
          <P>
            Until then the <Link href="/docs/api/corpus-public" className={docLink}>corpus API</Link> is the way to get the data as
            files: save the response{guard ? ", page by page, with a free key for the whole of it" : ""}. The export itself is
            built (<C>npm run export-bulk</C> in the repository); what is missing is the public bucket it is served from.
          </P>
          {guard && (
            <P>
              Keys and limits are on <Link href="/docs/api/keys" className={docLink}>Limits and keys</Link>.
            </P>
          )}
        </>
      )}
    </DocPage>
  );
}
