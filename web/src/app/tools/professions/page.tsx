import type { Metadata } from "next";
import AdSlot from "@/components/AdSlot";
import JsonLd from "@/components/JsonLd";
import { webApplicationJsonLd } from "@/lib/jsonld";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import EmailCapture from "@/components/EmailCapture";
import { handleProfessionPath } from "../../../../../kb/src/profession-path";
import { handleRecipeThresholds, pathFactsFromRecords } from "../../../../../kb/src/recipe-thresholds";
import { STORAGE_UNREACHABLE, uploadStore } from "@/lib/upload-store";
import { dataAgeLabel } from "@/lib/data-age";
import { classAndProfessionIcons, loadSiteAssets } from "@/lib/game-assets";
import GameIcon from "@/components/game/GameIcon";
import { trailFor } from "@/lib/breadcrumbs";
import { Card, Container, Contribute, Disclosure, EmptyState, Field, PageHeader, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";

const TITLE = "WoW Forever Profession Hubs";
const lede = "Profession paths and recipe skill ranges, estimated from the recipes and prices players uploaded.";

export const metadata: Metadata = {
  ...pageMetadata({ title: TITLE, description: "Leveling routes and material lists for WoW: Forever professions, built from player-collected recipes and prices. The numbers open as reports arrive.", path: "/tools/professions" }),
  keywords: ["wow forever professions", "wow forever profession leveling", "forever profession perks"],
};

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function skill(value: string, fallback: number): number {
  if (!/^\d+$/.test(value)) return fallback;
  const n = Number(value);
  return n >= 1 && n <= 500 ? n : fallback;
}

export default async function ProfessionsPage(
  props: {
    searchParams: Promise<{ profession?: string | string[]; from?: string | string[]; to?: string | string[] }>;
  }
) {
  const searchParams = await props.searchParams;
  const profession = one(searchParams.profession).trim() || "Alchemy";
  const fromSkill = skill(one(searchParams.from), 1);
  const toSkill = skill(one(searchParams.to), 75);
  const corpus = await uploadStore.loadCorpus();
  const facts = corpus.unreachable
    ? { sightings: [], prices: [], observations: [], derived: [] }
    : pathFactsFromRecords(corpus.records);
  const answer = corpus.unreachable
    ? STORAGE_UNREACHABLE
    : handleProfessionPath({ profession, fromSkill, toSkill }, facts.sightings, facts.prices, facts.derived);
  const ranges = corpus.unreachable
    ? STORAGE_UNREACHABLE
    : handleRecipeThresholds({ profession }, facts.observations, facts.prices);
  const reports = facts.sightings.length + facts.observations.length;
  // Profession icons as a picker, only when the asset URL is set and the upload has them.
  const assets = await loadSiteAssets();
  const icons = classAndProfessionIcons(assets).professions;
  const pending = !corpus.unreachable && reports === 0;
  return (
    <Container>
      <JsonLd data={webApplicationJsonLd({ name: TITLE, path: "/tools/professions", description: lede })} />
      <PageHeader
        trail={trailFor("/tools/professions")!}
        title={TITLE}
        lede={lede}
        meta={corpus.unreachable
          ? <span>Storage unreachable</span>
          : <>
            {reports > 0 && <span className="font-mono tabular-nums">{reports} recipe {reports === 1 ? "report" : "reports"}</span>}
            <span>{dataAgeLabel(corpus.dataAsOf)}</span>
          </>}
      />

      <div className="space-y-8">
        <section aria-labelledby="prof-path" className="space-y-4">
          <SectionHeading id="prof-path">The path</SectionHeading>
          {icons.length > 0 && (
            <nav aria-label="Professions" className="flex flex-wrap gap-2">
              {icons.map((p) => {
                const current = p.key.toLowerCase() === profession.toLowerCase();
                return (
                  <Link
                    key={p.key}
                    href={`/tools/professions?profession=${encodeURIComponent(p.key)}&from=${fromSkill}&to=${toSkill}`}
                    aria-current={current ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-control border px-3 text-sm ${current ? "border-accent text-fg" : "border-line text-fg-2 hover:border-accent hover:text-fg"}`}
                  >
                    <GameIcon src={p.icon} size={24} />
                    {p.name}
                  </Link>
                );
              })}
            </nav>
          )}
          <Card>
            <form method="get" className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Profession" name="profession" defaultValue={profession} />
                <Field label="From skill" name="from" defaultValue={fromSkill} inputMode="numeric" mono />
                <Field label="To skill" name="to" defaultValue={toSkill} inputMode="numeric" mono />
              </div>
              <button type="submit" className="btn btn-primary">
                Show the path
              </button>
            </form>
          </Card>
          {pending
            ? <EmptyState message={`No recipe ranges for ${profession} yet: paths and ranges appear once 3 installs report the same recipes.`} />
            : <Card><pre className="whitespace-pre-wrap text-sm text-fg">{answer}</pre></Card>}
        </section>

        {!pending && (
          <section aria-labelledby="prof-ranges">
            <SectionHeading id="prof-ranges">Recipe skill ranges</SectionHeading>
            <Card><pre className="whitespace-pre-wrap text-sm text-fg">{ranges}</pre></Card>
          </section>
        )}

        <Contribute
          id="prof-contribute"
          title="Add your recipes"
          note="Open your profession windows and trainers with the addon on, and scan the auction house for reagent prices. The Desktop App uploads both when you log out; a range shows once 3 installs agree."
        />

        <section aria-labelledby="prof-help">
          <SectionHeading id="prof-help">Questions</SectionHeading>
          <Disclosure summary="How is the path estimated?">
            <p>
              Choose a profession and skill range to see a path from available recipe uploads. Routes compare
              estimated reagent costs from reported recipes. Missing recipes remain gaps, and missing prices remain unknown.
            </p>
            <p>
              Prices are not scoped to a realm, build or time; three install reports per reagent do not guarantee
              today&apos;s cheapest route. Reported install IDs do not establish independent contributors.
            </p>
          </Disclosure>
          <Disclosure summary="What are recipe skill ranges?">
            <p>
              Where {profession} recipes turn yellow, green and grey, from the colours players&apos; profession windows
              showed (addon 0.2.3+). Shown as ranges once 3 installs agree, with the reagents 3 installs saw and an
              estimated cost per craft when every reagent has an agreed price.
            </p>
          </Disclosure>
          <Disclosure summary="How do I feed the hub?">
            <p>
              With auction capture on, the addon&apos;s auction scans price reagents here. Opening profession
              windows and trainers (addon 0.2.5) builds route steps: only the ranks where a recipe is known
              orange, once 3 installs agree. Ranks past that stay gaps. Material drops it records already
              reach the drop pages. Upload on the{" "}
              <Link href="/upload" className="text-accent hover:underline underline-offset-4">upload page</Link>.
            </p>
          </Disclosure>
          <Disclosure summary="Does the hub plan farming routes?">
            <p>
              Farming routes are planned, not built. When they exist, a route will say where to farm and the hub
              what the materials cost.
            </p>
          </Disclosure>
        </section>

        <Card className="max-w-xl">
          <EmailCapture toolSlug="professions" />
        </Card>
        <AdSlot slot="belowTool" />
      </div>
    </Container>
  );
}
