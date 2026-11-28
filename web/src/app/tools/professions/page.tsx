import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AdSlot from "@/components/AdSlot";
import JsonLd from "@/components/JsonLd";
import EmailCapture from "@/components/EmailCapture";
import GameIcon from "@/components/game/GameIcon";
import ClassContextChip from "@/components/classes/ClassContextChip";
import { Badge, Card, Container, Contribute, Disclosure, PageHeader, SectionHeading } from "@/components/ui";
import { webApplicationJsonLd } from "@/lib/jsonld";
import { pageMetadata } from "@/lib/seo";
import { loadSiteAssets } from "@/lib/game-assets";
import { trailFor } from "@/lib/breadcrumbs";
import { parseClassContext, withClassContext, withoutClassContext } from "@/lib/class-context";
import { CLIENT_PROFESSIONS, professionByName, professionHref, RECIPES_BUILD } from "@/lib/professions";
import { GATHERING_GUIDE_SLUGS } from "@/lib/gathering-guide";

export const dynamic = "force-dynamic";

const TITLE = "WoW Forever Profession Guides";
const lede = "Plan crafts and build a shopping list, or find gathering zones and trainers for your skill.";

export const metadata: Metadata = {
  ...pageMetadata({ title: TITLE, description: "Plan your WoW: Forever profession leveling route with crafting recipes, material prices and a shopping list, or find gathering zones and trainers.", path: "/tools/professions" }),
  keywords: ["wow forever professions", "wow forever profession leveling", "wow forever recipes"],
};

type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] ?? "" : value ?? "");

/**
 * The profession hub: one card per profession the game files list, each leading to its page. The old form's
 * links (`?profession=Alchemy&from=1&to=75`) go to that page with the same skill range and class context.
 */
export default async function ProfessionsPage(props: { searchParams: Promise<Search> }) {
  const searchParams = await props.searchParams;
  const read = parseClassContext(searchParams);
  const context = read.ok ? read.context : null;
  const asked = professionByName(one(searchParams.profession));
  if (asked) {
    const range = new URLSearchParams([["from", one(searchParams.from)], ["to", one(searchParams.to)]].filter(([, v]) => v));
    const query = range.toString();
    const href = `${professionHref(asked.slug)}${query ? `?${query}` : ""}`;
    redirect(withClassContext(href, context));
  }
  // Profession icons when the asset URL is set and the upload has them; the cards stand without them.
  const assets = await loadSiteAssets();
  const icon = (name: string) => assets?.professions.get(name.toLowerCase())?.icon;
  const total = CLIENT_PROFESSIONS.reduce((n, p) => n + p.recipes.length, 0);
  return (
    <Container>
      <JsonLd data={webApplicationJsonLd({ name: TITLE, path: "/tools/professions", description: lede })} />
      <PageHeader
        trail={trailFor("/tools/professions")!}
        title={TITLE}
        lede={lede}
        meta={<>
          <span className="font-mono tabular-nums">{total.toLocaleString("en-US")} recipes</span>
          <span>Game files, build {RECIPES_BUILD}</span>
        </>}
      />
      <ClassContextChip read={read} here={withoutClassContext("/tools/professions", searchParams)} className="-mt-2 mb-6" />

      <div className="space-y-8">
        <section aria-labelledby="prof-list" className="space-y-4">
          <SectionHeading id="prof-list">Professions</SectionHeading>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-professions>
            {CLIENT_PROFESSIONS.map((p) => (
              <li key={p.slug}>
                <Card
                  href={withClassContext(professionHref(p.slug), context)}
                  padding="custom"
                  className="flex min-h-16 items-center gap-3 px-4 py-3"
                >
                  {icon(p.name)
                    ? <GameIcon src={icon(p.name)!} size={36} />
                    : <span aria-hidden="true" className="h-9 w-9 shrink-0 rounded-sm border border-line" />}
                  <span className="min-w-0">
                    <span className="block font-medium text-fg">{p.name}</span>
                    <span className="block text-meta text-fg-2">{GATHERING_GUIDE_SLUGS.has(p.slug)
                      ? "Gathering zones and trainers"
                      : "Leveling route and shopping list"}</span>
                  </span>
                </Card>
              </li>
            ))}
          </ul>
          <p className="flex items-center gap-2 text-meta text-fg-2">
            <Badge tone="files" />
            Reference recipes from game files, build {RECIPES_BUILD}. Each guide shows the evidence behind its recommendations.
          </p>
        </section>

        <Contribute
          id="prof-contribute"
          title="Add your recipes"
          note="Open your profession windows and trainers with the addon on, and scan the auction house for reagent prices. The Desktop App uploads both when you log out; a range shows once 3 installs agree."
        />

        <section aria-labelledby="prof-help">
          <SectionHeading id="prof-help">Questions</SectionHeading>
          <Disclosure summary="What is on a profession page?">
            <p>
              Crafting guides lead with a skill range, leveling route and shopping list. Gathering guides show zones,
              materials and trainers. The recipe references include the ranks and ingredients from the game files.
            </p>
          </Disclosure>
          <Disclosure summary="Where do I gather materials?">
            <p>
              On the profession&apos;s page: Herbalism and Mining list the zones where players gathered herbs and ore,
              Skinning the zones whose mobs dropped leather, and Tailoring and First Aid the zones whose mobs dropped cloth.
              Each zone shows once 3 installs agree. Gold and reputation farming are on the{" "}
              <Link href="/tools/farming-routes" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">farming page</Link>.
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
