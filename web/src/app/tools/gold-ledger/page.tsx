import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { webApplicationJsonLd } from "@/lib/jsonld";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { goldFactsFromRecords, handleGoldLedger } from "../../../../../kb/src/gold-ledger";
import { STORAGE_UNREACHABLE, uploadStore } from "@/lib/upload-store";
import { dataAgeLabel } from "@/lib/data-age";
import { trailFor } from "@/lib/breadcrumbs";
import { Card, Container, Disclosure, EmptyState, Field, PageHeader, SectionHeading } from "@/components/ui";
import LocalLedger from "./LocalLedger";

export const dynamic = "force-dynamic";

const HEADING = "Gold ledger";
const lede = "Your gold, income and spending across characters, read from your own addon file in this browser.";

export const metadata: Metadata = {
  ...pageMetadata({ title: "WoW Forever Gold Ledger", description: "Drop your Everloot.lua to see gold per character, money in and out per day and category, and every money event. The file is read in your browser and never sent.", path: "/tools/gold-ledger" }),
};

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function GoldLedgerPage(
  props: {
    searchParams: Promise<{ character?: string | string[]; realm?: string | string[] }>;
  }
) {
  const searchParams = await props.searchParams;
  const character = one(searchParams.character);
  const realm = one(searchParams.realm);
  const corpus = await uploadStore.loadCorpus();
  const facts = corpus.unreachable ? { snapshots: [], events: [] } : goldFactsFromRecords(corpus.records);
  const answer = corpus.unreachable
    ? STORAGE_UNREACHABLE
    : handleGoldLedger({ character, realm }, facts.snapshots, facts.events);
  const pending = !corpus.unreachable && facts.snapshots.length + facts.events.length === 0;

  return (
    <Container>
      <JsonLd data={webApplicationJsonLd({ name: HEADING, path: "/tools/gold-ledger", description: lede })} />
      <PageHeader
        trail={trailFor("/tools/gold-ledger")!}
        title={HEADING}
        lede={lede}
        meta={<span>{corpus.unreachable ? "Storage unreachable" : dataAgeLabel(corpus.dataAsOf)}</span>}
        actions={<>
          <Link href="/tools/auctions" className="btn">Auction House</Link>
        </>}
      />

      <div className="space-y-8">
        <LocalLedger />

        <section aria-labelledby="published-ledgers" className="space-y-4">
          <SectionHeading id="published-ledgers" note="Peak gold and money events a player chose to upload and share.">Published ledgers</SectionHeading>
          <Card>
            <form method="get" className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Character" name="character" defaultValue={character} />
                <Field label="Realm" name="realm" defaultValue={realm} />
              </div>
              <button type="submit" className="btn btn-primary text-sm">Show the ledger</button>
            </form>
          </Card>

          {pending
            ? <EmptyState message="No gold ledger yet: a character's ledger appears once its player uploads the Everloot addon's file." />
            : <Card><pre className="whitespace-pre-wrap text-sm text-fg">{answer}</pre></Card>}
        </section>

        <Disclosure summary="What does the ledger record?">
          <p>
            Addon 0.2.4 records loot, quest rewards, vendor sales, flight costs, auction sales taken from the mailbox
            (after the house cut), postage and auction buyouts. Bids, deposits, other mail, other spending, and gameplay
            stay unrecorded until an event is seen. The difference is unrecorded. This is the same answer as the
            gold_ledger tool.
          </p>
        </Disclosure>
      </div>
    </Container>
  );
}
