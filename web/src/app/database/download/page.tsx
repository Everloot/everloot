import type { Metadata } from "next";
import Link from "next/link";
import { CREDIT_LINE, LICENCE, LICENCE_URL } from "@everloot/protocol";
import type { ManifestFile } from "../../../../../kb/src/open-data/manifest";
import { GAME_FILES_LABEL, OPEN_DATA_EXCLUDED, OPEN_DATA_METHOD, OPEN_DATA_NOT_YET, OPEN_DATA_READING, OPEN_DATA_VERIFY } from "../../../../../kb/src/open-data/text";
import { Container, DataTable, DataTitle, Facts } from "@/components/ui";
import { loadOpenData } from "@/lib/open-data";
import { pageMetadata } from "@/lib/seo";
import { LINK } from "../entity";

export const metadata: Metadata = pageMetadata({
  title: "Download the WoW Forever data",
  description: "Everloot's published WoW: Forever data as NDJSON files: what three installs agree on, and the game files' layer, with the licence and the counts.",
  path: "/database/download",
});
// Its one read, the bulk bucket's manifest, is a public fetch kept five minutes (lib/open-data.ts); no store, no cookies.
// Five minutes is the lists row of lib/cache-policy.js, which next-config.test.ts holds this number to.
export const revalidate = 300;

const n = (x: number) => x.toLocaleString("en-US");
const day = (iso: string | null) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "[?]");
const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

const H2 = "mt-8 mb-2 text-cell font-semibold text-fg";
const P = "mt-2 max-w-reading text-sm text-fg-2";

export default async function DownloadPage() {
  const loaded = await loadOpenData();
  const ok = loaded.state === "ok" ? loaded : null;
  const columns = (base: string) => [
    { key: "file", header: "File", cell: (f: ManifestFile) => <a href={`${base}/${f.path}`} className={LINK}>{f.path}</a> },
    { key: "rows", header: "Rows", numeric: true, cell: (f: ManifestFile) => n(f.rows) },
    { key: "of", header: "Of how many", numeric: true, cell: (f: ManifestFile) => (f.candidates === null ? "[?]" : n(f.candidates)) },
    { key: "counts", header: "What that counts", cell: (f: ManifestFile) => f.candidatesAre },
    { key: "size", header: "Size", numeric: true, nowrap: true, cell: (f: ManifestFile) => size(f.bytes) },
    { key: "sha", header: "SHA-256", nowrap: true, cell: (f: ManifestFile) => <code title={f.sha256} className="text-meta">{f.sha256.slice(0, 12)}</code> },
  ];

  return (
    <Container width="data">
      <article>
        <DataTitle title="Download the data" meta={ok ? `Made ${day(ok.manifest.generatedAt)} · data as of ${day(ok.manifest.dataAsOf)}` : "No export to download yet"} />
        <p className={P}>
          The published data as files you can build on: one JSON object per line, in two folders. <code>observed/</code> is what players saw in the
          game and at least three installs agree on. <code>game-files/</code> is what the game&apos;s own files say, kept apart because it is Blizzard&apos;s.
        </p>

        {ok ? (
          <>
            <Container width="reading" className="mt-4">
              <Facts layout="list" label="This export" items={[
                { label: "Made", value: day(ok.manifest.generatedAt), numeric: true },
                { label: "Data as of", value: day(ok.manifest.dataAsOf), numeric: true },
                { label: "Game build", value: ok.manifest.gameFiles.version, numeric: true },
                { label: "Read", value: `${n(ok.manifest.source.records)} public records from ${n(ok.manifest.source.installs)} ${ok.manifest.source.installs === 1 ? "install" : "installs"}`, numeric: true },
                { label: "Rule", value: `${ok.manifest.method.agreement} or more installs agree` },
              ]} />
            </Container>
            <p className={P}>
              Exports are made by hand, not on a schedule, so this one can be older than the live site. Rows is what is in the file. Of how many is
              what the rows were chosen from, and the next column says what that counts.
            </p>
            <div className="mt-4">
              <DataTable
                dense
                caption={`Files of the export made ${day(ok.manifest.generatedAt)}`}
                columns={columns(ok.base)}
                rows={ok.manifest.files}
                rowKey={(f) => f.path}
                meta={(f) => `${n(f.rows)} of ${f.candidates === null ? "[?]" : n(f.candidates)} · ${size(f.bytes)}`}
              />
            </div>
            <p className={P}>
              Also in the folder: <a href={`${ok.base}/manifest.json`} className={LINK}>manifest.json</a>, <a href={`${ok.base}/README.md`} className={LINK}>README.md</a>,{" "}
              <a href={`${ok.base}/LICENCE.md`} className={LINK}>LICENCE.md</a> and a JSON Schema for each file in <code>schema/</code>.
            </p>
          </>
        ) : loaded.state === "unreachable" ? (
          <p className="mt-4 max-w-reading text-sm text-fg-2">The latest export could not be read just now, so its date and counts are [?]. Try again in a few minutes.</p>
        ) : (
          <>
            <p className="mt-4 max-w-reading text-sm text-fg-2">
              There is no published export yet, so there are no counts to show. A maintainer makes one by hand and puts it here. Until then the{" "}
              <Link href="/docs/api/corpus-public" className={LINK}>corpus API</Link> serves the anonymous records page by page, and the{" "}
              <Link href="/docs/api/data-files" className={LINK}>data files page</Link> has the older bulk files.
            </p>
          </>
        )}

        <h2 className={H2} id="licence">Licence and credit</h2>
        <p className={P}>
          <code>observed/</code> is under <a href={LICENCE_URL} rel="noopener" className={LINK}>{LICENCE}</a>. Credit it with this line, and release what you build from it under the same licence:
        </p>
        <p className="mt-2 max-w-reading rounded-card border border-line bg-panel px-3 py-2 font-mono text-meta text-fg">{CREDIT_LINE}</p>
        <p className={P}>
          <code>game-files/</code> is Blizzard&apos;s data and is not under that licence. Each row is {GAME_FILES_LABEL.toLowerCase()}: it is in the files of the build named above,
          which does not mean it is, or will be, in the game. Everloot is a fan project and is not affiliated with or endorsed by Blizzard. The{" "}
          <Link href="/methodology#credits" className={LINK}>credits</Link> name the sources, and the{" "}
          <a href="https://github.com/Everloot/everloot/blob/main/docs/DATA_POLICY.md" rel="noopener" className={LINK}>data policy</a> has the rules.
        </p>

        <h2 className={H2} id="method">Method</h2>
        <p className={P}>{OPEN_DATA_METHOD}</p>
        <ul className="mt-2 max-w-reading list-disc space-y-1 pl-5 text-sm text-fg-2">
          {OPEN_DATA_READING.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <p className={P}>A <code>null</code> in a row is an unknown, where fewer than three installs agree. Nothing is guessed or left blank.</p>

        <h2 className={H2} id="not-included">What is not in the files</h2>
        <ul className="mt-2 max-w-reading list-disc space-y-1 pl-5 text-sm text-fg-2">
          {OPEN_DATA_EXCLUDED.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <p className={`${P} mt-3`}>Not in this version yet:</p>
        <ul className="mt-1 max-w-reading list-disc space-y-1 pl-5 text-sm text-fg-2">
          {OPEN_DATA_NOT_YET.map((line) => <li key={line}>{line}</li>)}
        </ul>

        <h2 className={H2} id="verify">How to verify a count</h2>
        <ol className="mt-2 max-w-reading list-decimal space-y-1 pl-5 text-sm text-fg-2">
          {OPEN_DATA_VERIFY.map((line) => <li key={line}>{line}</li>)}
        </ol>
      </article>
    </Container>
  );
}
