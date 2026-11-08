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

export const dynamic = "force-dynamic";

const TITLE = "WoW Forever Profession Hubs";
const lede = "Every profession's recipes from the game files, with the paths and skill ranges players upload.";

export const metadata: Metadata = {
  ...pageMetadata({ title: TITLE, description: "Every WoW: Forever profession's recipes from the game files, with reagents and skill ranks, and the leveling paths and recipe ranges players upload.", path: "/tools/professions" }),
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
                <Link
                  href={withClassContext(professionHref(p.slug), context)}
                  className="flex min-h-16 items-center gap-3 rounded-card border border-line bg-panel px-4 py-3 hover:border-accent"
                >
                  {icon(p.name)
                    ? <GameIcon src={icon(p.name)!} size={36} />
                    : <span aria-hidden="true" className="h-9 w-9 shrink-0 rounded-sm border border-line" />}
                  <span className="min-w-0">
                    <span className="block font-medium text-fg">{p.name}</span>
                    <span className="block text-meta text-fg-2">
                      <span className="font-mono tabular-nums">{p.recipes.length}</span> {p.recipes.length === 1 ? "recipe" : "recipes"} in the files
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="flex items-center gap-2 text-meta text-fg-2">
            <Badge tone="files" />
            Recipe lists are found in game files, unconfirmed, build {RECIPES_BUILD}. Paths, ranges and costs come from player uploads once 3 installs agree.
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
              Every recipe the game files list for the profession, grouped by the skill where it turns yellow, with the
              item it makes, its reagents and the ranks the files give. Under it, what players upload: a leveling path,
              the colour ranges their profession windows showed, and a cost per craft from agreed prices.
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
