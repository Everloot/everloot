import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { webApplicationJsonLd } from "@/lib/jsonld";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { collectionFactsFromRecords, handleCollectionGap } from "../../../../../kb/src/collection-gap";
import {
  ANOTHER_CHARACTER_NOTE, COMPLETION_AGREEMENT, completionEmptyState, completionProgress, droppedCharactersNote, overviewOf,
} from "../../../../../kb/src/completion";
import { loadCompletion } from "@/lib/completion-store";
import { STORAGE_UNREACHABLE, uploadStore } from "@/lib/upload-store";
import { dataAgeLabel } from "@/lib/data-age";
import CompletionView, { CharacterClosest } from "./CompletionView";
import { CategoryDetail, OverviewBars, TotalBar } from "./OverviewView";
import RememberCharacter from "./RememberCharacter";
import { GAP_VIEW, showOf, viewHref, type ViewQuery } from "./overview";
import { trailFor } from "@/lib/breadcrumbs";
import { Card, Container, DataTitle, Disclosure, EmptyState, Field, LinkTabs, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";

const HEADING = "Completion and collections";
const lede = "How much of the agreed achievement, reputation, title and quest chain lists a character has done, and owned versus missing in a collection.";

export const metadata: Metadata = {
  ...pageMetadata({ title: "WoW Forever Completionist: Collections, Achievements, Reputation", description: "Owned versus missing in a WoW: Forever collection, plus a character's achievement, reputation, title and quest progress. Lists come from agreeing uploads.", path: "/tools/collections" }),
};

const NO_LIST = `No list is public yet: an entry appears when ${COMPLETION_AGREEMENT} players (installs uploading from different addresses) report the same achievement, faction, title or chain.`;

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const className = (cls: string) => `${cls[0] ?? ""}${cls.slice(1).toLowerCase()}`;

async function gapView({ collection, install }: { collection: string; install: string }) {
  const corpus = await uploadStore.loadCorpus();
  const facts = corpus.unreachable ? null : collectionFactsFromRecords(corpus.records);
  const answer = facts ? handleCollectionGap({ collection, ownerInstallId: install }, facts) : STORAGE_UNREACHABLE;
  // No collection upload of any kind yet: every gap would read "unrecorded".
  const pending = facts !== null && facts.catalog.length + facts.owned.length === 0;
  return (
    <>
      <p className="text-meta text-muted">{corpus.unreachable ? "Storage unreachable" : dataAgeLabel(corpus.dataAsOf)}</p>
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="view" value={GAP_VIEW} />
          <div className="min-w-48 flex-1"><Field label="Collection" name="collection" defaultValue={collection} /></div>
          <div className="min-w-48 flex-1"><Field label="Install id" name="install" defaultValue={install} /></div>
          <button type="submit" className="btn btn-primary text-sm">Show the gap</button>
        </form>
      </Card>
      <section aria-labelledby="gap-heading">
        <SectionHeading id="gap-heading">Collection gap</SectionHeading>
        {pending
          ? <EmptyState message="No collection list yet: an item joins a list once 3 installs agree on it and its source." />
          : <Card><pre className="whitespace-pre-wrap text-sm text-fg">{answer}</pre></Card>}
      </section>
    </>
  );
}

async function completionOverview({ install, character, view, show }: { install: string; character: string; view: string; show: string }) {
  // With no install this is the agreed lists alone: no one's progress is read.
  const completion = await loadCompletion(install);
  if (!completion) {
    return <Card><p className="text-fg-2" role="status">Completion data is unavailable right now. It is unrecorded, not zero.</p></Card>;
  }
  const { facts } = completion;
  const age = <p className="text-meta text-muted">{dataAgeLabel(completion.dataAsOf)}</p>;
  const form = (
    <Card>
      <form method="get" className="flex flex-wrap items-end gap-3">
        {view && <input type="hidden" name="view" value={view} />}
        <div className="min-w-48 flex-1"><Field label="Install id" name="install" defaultValue={install} /></div>
        <div className="w-40"><Field label="Character key (optional)" name="character" defaultValue={character} maxLength={8} mono /></div>
        <button type="submit" className="btn btn-primary text-sm">Show progress</button>
      </form>
    </Card>
  );

  const progress = install.trim() ? completionProgress(install, character, facts) : null;
  if (progress && (completionEmptyState(progress) || facts.achievements.size + facts.factions.size + facts.titles.size + facts.chains.size === 0)) {
    // Not shared, an unknown character, or no list yet: say which, instead of drawing bars.
    return <>{age}{form}<CompletionView progress={progress} /></>;
  }

  // Owned progress is only in `facts` for this install, and only while its grant is live (loadCompletion).
  const chosen = progress?.characters[0] ?? null;
  const owned = chosen ? facts.owned.find((c) => c.characterKey === chosen.characterKey) ?? null : null;
  const overview = overviewOf(facts, owned);
  const q: ViewQuery = { install, character: chosen ? chosen.characterKey : character };
  const remember = <RememberCharacter install={install} character={chosen?.characterKey ?? ""} />;
  if (overview.total.total === 0) return <>{age}{form}{remember}<EmptyState message={NO_LIST} /></>;

  const dropped = progress && droppedCharactersNote(progress);
  const others = install.trim() ? facts.owned.slice().sort((a, b) => a.characterKey.localeCompare(b.characterKey)) : [];
  const detail = overview.categories.find((c) => c.id === view);

  return (
    <>
      {age}
      {form}
      {remember}
      {dropped && <p className="text-sm text-fg-2" role="status">{dropped}</p>}
      {others.length > 1 && (
        <LinkTabs
          label="Character"
          tabs={others.map((c) => ({
            href: viewHref({ ...q, character: c.characterKey, view: detail?.id, show: detail ? showOf(show) : undefined }),
            label: <>{className(c.class)} {c.level} <span className="ml-1 font-mono text-xs text-muted">{c.characterKey}</span></>,
            current: c.characterKey === chosen?.characterKey,
          }))}
        />
      )}
      {chosen && others.length <= 1 && (
        <p className="text-sm text-fg">{className(chosen.class)} level {chosen.level} <span className="font-mono text-xs text-muted">key {chosen.characterKey}</span></p>
      )}
      {!install.trim() && <p className="text-sm text-fg-2">Enter an install id to see a character&apos;s progress. Until then the bars show the agreed lists with nothing counted as done.</p>}
      {detail ? (
        <CategoryDetail facts={facts} character={owned} cat={detail} q={q} show={showOf(show)} categories={overview.categories} />
      ) : (
        <>
          <TotalBar overview={overview} measured={owned !== null} />
          <OverviewBars overview={overview} q={q} measured={owned !== null} />
          {chosen && (
            <Card as="section" aria-labelledby="closest-heading" className="space-y-4">
              <h2 id="closest-heading" className="text-lg font-semibold text-fg">Closest to done</h2>
              <CharacterClosest c={chosen} />
            </Card>
          )}
        </>
      )}
      {owned && <p className="text-xs text-muted">{ANOTHER_CHARACTER_NOTE}</p>}
    </>
  );
}

export default async function CollectionsPage(
  props: {
    searchParams: Promise<{ collection?: string | string[]; install?: string | string[]; character?: string | string[]; view?: string | string[]; show?: string | string[] }>;
  }
) {
  const searchParams = await props.searchParams;
  const collection = one(searchParams.collection);
  const install = one(searchParams.install);
  const character = one(searchParams.character);
  // A link that names a collection (the old form) opens the gap view.
  const view = one(searchParams.view) || (collection.trim() ? GAP_VIEW : "");
  const gap = view === GAP_VIEW;

  return (
    <Container width="data">
      <JsonLd data={webApplicationJsonLd({ name: HEADING, path: "/tools/collections", description: lede })} />
      <article>
        <DataTitle
          title={HEADING}
          meta={<span>{lede}</span>}
          trail={trailFor("/tools/collections")!}
          aside={<Link href="/upload" className="btn">Upload addon data</Link>}
        />
        <LinkTabs
          label="View"
          tabs={[
            { href: viewHref({ install, character }), label: "Completion", current: !gap },
            { href: viewHref({ view: GAP_VIEW, install, collection }), label: "Collection gap", current: gap },
          ]}
        />
        <div className="mt-4 space-y-6">
          {gap
            ? await gapView({ collection, install })
            : await completionOverview({ install, character, view, show: one(searchParams.show) })}
        </div>
        <div className="mt-8">
          <Disclosure summary="Where do done and missing come from?">
            <p>
              An entry joins a list when {COMPLETION_AGREEMENT} installs agree on it. Done and missing are what one
              install&apos;s character uploaded, read against those lists. This view uses uploaded records, not a
              Battle.net profile.
            </p>
            <p>
              Progress needs the addon&apos;s completion tracker (off until you turn it on) and an upload that shares
              your collection ownership. Remembering a character keeps its install id and key in this browser only.
            </p>
          </Disclosure>
        </div>
      </article>
    </Container>
  );
}
