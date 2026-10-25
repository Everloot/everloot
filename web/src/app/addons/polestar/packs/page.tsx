import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { POLESTAR, POLESTAR_PACKS } from "@/data/polestar";
import { trailFor } from "@/lib/breadcrumbs";
import { Container, Entry, EntryList, PageHeader, SectionHeading } from "@/components/ui";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Polestar Guide Packs for WoW Forever", description: "An independent list of guide packs for Polestar, the WoW: Forever leveling addon: who made each, what it covers, its licence and where to get it.", path: "/addons/polestar/packs" }),
};

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

export default function PacksPage() {
  return (
    <Container width="reading">
      <article>
        <PageHeader
          trail={trailFor("/addons/polestar/packs")!}
          title="Guide packs for Polestar"
          lede={<>Each pack is a separate addon and appears in Polestar under &quot;Guide packs&quot; (<span className="font-mono">/polestar packs</span>).</>}
        />
        <p className="mb-6 text-sm text-fg-2">
          The first entry is Polestar&apos;s own guides, which ship with Polestar. Every other pack is made by its own
          author, and neither Polestar nor Everloot tests or vouches for it: a pack is an addon like any other, so install
          packs from authors you trust and report problems to the pack&apos;s author.
        </p>

        <EntryList label="Guide packs">
          {POLESTAR_PACKS.map((pack) => (
            <Entry
              key={pack.id}
              title={pack.title}
              meta={`by ${pack.author} · version ${pack.version}`}
              actions={pack.downloads.map((download) => (
                <a key={download.url} href={download.url} className="btn min-h-11">{download.label}</a>
              ))}
            >
              <ul className="list-disc space-y-1 pl-6">
                {pack.coverage.map((line) => <li key={line}>{line}</li>)}
              </ul>
              <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
                <dt className="text-muted">Pack id</dt><dd className="font-mono">{pack.id}</dd>
                <dt className="text-muted">Licence</dt><dd>{pack.license}</dd>
                {pack.folder && (<><dt className="text-muted">Folder</dt><dd className="font-mono [overflow-wrap:anywhere]">{pack.folder}</dd></>)}
                {pack.needs && (<><dt className="text-muted">Needs</dt><dd>Polestar {pack.needs} or newer</dd></>)}
                {pack.source && (<><dt className="text-muted">Source</dt><dd>{pack.source}</dd></>)}
                {pack.website && (<><dt className="text-muted">Website</dt><dd className="[overflow-wrap:anywhere]"><a className={link} href={pack.website}>{pack.website.replace(/^https?:\/\//, "")}</a></dd></>)}
              </dl>
              <p className="font-mono text-xs text-muted">Listed {pack.listed} · details checked {pack.checked}</p>
            </Entry>
          ))}
        </EntryList>

        <section className="mt-12" aria-labelledby="list-yours">
          <SectionHeading id="list-yours">List your pack</SectionHeading>
          <p className="text-fg-2">
            Email <a className={link} href="mailto:hello@everloot.app?subject=Polestar%20guide%20pack">hello@everloot.app</a> with
            your <span className="font-mono">pack.json</span>, what the pack covers and a download link. Packs follow
            Polestar&apos;s <a className={link} href={POLESTAR.packFormat}>pack format</a>; the <a className={link} href={POLESTAR.handbook}>handbook</a> covers
            writing and publishing one. Looking for something to build? See <Link className={link} href="/addons/polestar/wanted">pack ideas</Link>.
          </p>
        </section>
      </article>
    </Container>
  );
}
