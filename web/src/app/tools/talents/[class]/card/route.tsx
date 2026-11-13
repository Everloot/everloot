import { tokens } from "@/design/tokens";
import { renderBuildCard, renderCard } from "@/lib/og-card";
import { savedBuildsOn } from "@/lib/saved-builds";
import { sharedBuild } from "@/lib/saved-builds-store";
import { isTalentClass, loadCatalog } from "@/lib/talents/catalogs";
import { buildTitle, readPathCodes, summarizeBuild } from "@/lib/talents/summary";

// The link preview for a build link (/tools/talents/<class>/b/...): ?a=<first set>&b=<second set>.
// The same codes give the same picture, so it is cached like a file.
// A saved build's short link (/b/<slug>) asks for ?s=<slug>: the codes and the build's name come from the
// database, never from the address, so nobody can print their own text on an Everloot card. Its name and
// sharing can change, so that picture is never cached: turning sharing off or deleting the build ends it at once.
export async function GET(req: Request, { params }: { params: Promise<{ class: string }> }) {
  const { class: slug } = await params;
  if (!isTalentClass(slug)) return new Response("Not found", { status: 404 });
  const catalog = await loadCatalog(slug);
  const q = new URL(req.url).searchParams;
  const saved = q.has("s") && savedBuildsOn() ? await sharedBuild(q.get("s") ?? "").catch(() => null) : null;
  const named = saved?.classSlug === slug ? saved : null;
  const read = named ? readPathCodes(catalog, [named.code, named.code2 ?? "-"]) : readPathCodes(catalog, [q.get("a") ?? "-", q.get("b") ?? "-"]);
  const color = tokens.dark[`class-${slug}`];
  const image = read
    ? await (async () => {
      const sets = read.sets.map((s) => summarizeBuild(catalog, s));
      const shown = sets.map((s, i) => ({ s, heading: i === 0 ? "First set" : "Second set" })).filter((x) => x.s.spent > 0);
      const main = shown[0].s;
      const second = shown.length === 2 ? `Second set: ${buildTitle(catalog, shown[1].s)}` : null;
      return renderBuildCard({
        label: "Everloot · WoW Forever talents",
        title: named ? named.name : buildTitle(catalog, main),
        color,
        subtitle: named ? second ?? `${buildTitle(catalog, main)} · game build ${named.gameBuild}` : second ?? `${main.spent} points · game build ${catalog.build}`,
        groups: shown.map(({ s, heading }) => ({ heading, bars: s.trees.map((t) => ({ name: t.name, value: String(t.points), fraction: s.spent ? t.points / s.spent : 0 })) })),
      });
    })()
    : await renderCard({ label: "Everloot", title: `WoW Forever ${catalog.className} Talent Calculator`, subtitle: "Plan a build and share it with its game build attached" });
  image.headers.set("Cache-Control", q.has("s") ? "private, no-store" : "public, max-age=86400, s-maxage=604800, immutable");
  if (!q.has("s")) image.headers.set("CDN-Cache-Control", "public, max-age=86400");
  return image;
}
