import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FAMILIES, figureLabel, getFamily, type FamilyFact } from "@/data/families";
import { Container, DataTable, Explainer, Facts, PageHeader, SectionHeading } from "@/components/ui";

const KIND_LABEL: Record<FamilyFact["kind"], string> = {
  "guild-site": "Their page",
  claim: "Published claim",
  sighting: "Name sighted",
};

const link = "text-accent hover:underline underline-offset-4";

export function generateStaticParams() {
  return FAMILIES.map((family) => ({ slug: family.slug }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await props.params;
  const family = getFamily(params.slug);
  if (!family) return { title: "Guild family" };
  return pageMetadata({ title: `${family.name} – WoW Forever Guild`, description: familyDescription(family.summary, family.facts), path: `/guilds/${family.slug}` });
}

/** The summary, then how many rows each of the page's three tables holds. */
function familyDescription(summary: string, facts: readonly FamilyFact[]): string {
  const n = (kind: FamilyFact["kind"], one: string, many: string) => {
    const count = facts.filter((fact) => fact.kind === kind).length;
    return `${count} ${count === 1 ? one : many}`;
  };
  return `${summary} ${n("guild-site", "guild hall", "guild halls")}, ${n("claim", "claim", "claims")} and ${n("sighting", "sighted name", "sighted names")}.`;
}

export default async function GuildFamilyPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const family = getFamily(params.slug);
  if (!family) notFound();

  const halls = family.facts.filter((fact) => fact.kind === "guild-site");
  const claims = family.facts.filter((fact) => fact.kind === "claim");
  const sightings = family.facts.filter((fact) => fact.kind === "sighting");
  const api = family.blizzard;
  const answer = (value: "answers" | "refused") => (value === "answers" ? "Answers" : "Refused");

  return (
    <Container width="data">
      <article>
        <PageHeader
          trail={[{ name: "Home", path: "/" }, { name: `${family.name} family`, path: `/guilds/${family.slug}` }]}
          title={family.name}
          lede={family.summary}
        />

        <div className="space-y-12">
          <FactTable id="halls" title="Guild halls" caption="A guild's own site. The count is theirs." rows={halls} />
          <FactTable id="claims" title="What has been published about the family" caption="Claims, in the order they were said. They do not add up to one census." rows={claims} />
          <FactTable id="sightings" title="Names sighted" caption="A public page named a guild. That is not a member list." rows={sightings} />

          <section aria-labelledby="battle-net" className="space-y-4">
            <SectionHeading id="battle-net" note="The same columns, filled by Blizzard's guild API the day Forever has a namespace.">
              Battle.net guild profile
            </SectionHeading>
            <Facts
              label="Blizzard guild API, as checked"
              items={[
                { label: "Retail guild profile", value: answer(api.retailProfile) },
                { label: "Classic Era", value: answer(api.classicEraStatic) },
                { label: "Forever, guessed names", value: answer(api.foreverGuessed) },
              ]}
            />
            <p className="max-w-[65ch] text-sm text-fg-2">
              Checked {api.checked}: the retail guild profile and Classic Era both answered our
              requests. Guessed Forever namespaces were refused. The open question is
              on <a href={api.forumUrl} className={link}>Blizzard&apos;s API forum</a>. Once Blizzard publishes one,
              Everloot can read it. Those responses stay off this page, because Blizzard&apos;s terms keep API data in a
              local cache.
            </p>
          </section>
        </div>

        <Explainer summary="How this record is built">
          <p>
            A guild hall can list its own members and say how it knows. This page does that
            for the whole family. Each row is someone else&apos;s published sentence, with the
            page and the date beside it.
          </p>
          <p>A guild the public web has not mentioned is left off this page.</p>
        </Explainer>
        <p className="mt-6 text-sm text-muted">
          Progression, roster, and loot from officer uploads are on the{" "}
          <Link href="/tools/guild-board" className={link}>guild board</Link>.
        </p>
      </article>
    </Container>
  );
}

function FactTable({ id, title, caption, rows }: { id: string; title: string; caption: string; rows: FamilyFact[] }) {
  // A kind nobody has published yet is left out rather than drawn as an empty table.
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <SectionHeading id={id} note={caption}>{title}</SectionHeading>
      <DataTable<FamilyFact>
        caption={title}
        rowKey={(fact) => fact.id}
        rows={rows}
        columns={[
          {
            key: "statement",
            header: "What was published",
            cell: (fact) => (
              <div className="min-w-60 max-w-md py-1">
                <span className="font-mono text-xs text-muted">
                  {KIND_LABEL[fact.kind]}
                  {fact.guild ? ` · ${fact.guild}` : ""}
                </span>
                <p className="mt-1">{fact.statement}</p>
              </div>
            ),
          },
          { key: "figure", header: "Figure", nowrap: true, cell: (fact) => <span className="tabular-nums text-accent">{figureLabel(fact)}</span> },
          { key: "source", header: "Source", cell: (fact) => <a href={fact.url} className={link}>{fact.sourceName}</a> },
          { key: "asOf", header: "As of", numeric: true, cell: (fact) => fact.asOf },
        ]}
      />
    </section>
  );
}
