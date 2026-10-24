import { MetadataRoute } from "next";
import { LAUNCH } from "@/data/wow-forever";
import { FAMILIES } from "@/data/families";
import { tools, toolHref } from "@/data/tools";
import { allDocsPages } from "@/lib/docs/nav";
import { MAP_DATA_EXTRACTED_AT, TALENT_DATA_EXTRACTED_AT } from "@/lib/build-stamp";
import { loadTimeline, loadWriteups, postPath, writeupFor } from "@/lib/changes";
import { TALENT_CLASSES } from "@/lib/talents/catalogs";
import { CLIENT_LAYER, CLIENT_TAXONOMY, categoryNamedEnough, itemsHref } from "@/lib/items";
import { DATABASE_HUB_PATHS } from "@/lib/database-hubs";
import { instancePaths } from "@/lib/database-sitemap";
import { loadSightings } from "@/lib/instances";
import { loadShownNames } from "@/lib/shown-item-names";
import { achievementHref, chainHref, factionHref, loadCatalog, titleHref } from "@/lib/completion-lists";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { RANKINGS, hubIndexable, loadRankingWeeks, rankingIndexable, rankingPath, rankingView } from "@/lib/rankings";
import { hasContent, publicZones, zoneContents, zoneHref } from "@/lib/zones";
import { loadNews, newsSitemapPaths } from "@/lib/news";
import { wikiSitemapPaths } from "@/lib/wiki";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://everloot.app";

/**
 * A page gets a lastModified only when the site knows one: the newest change entry for /changes, the build's
 * extraction date for the pages drawn from the game files, the day the launch sentence was read for
 * /wow-forever. Every other page has none, because a made-up date teaches crawlers to ignore the field.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes = ["/", "/wow-forever", "/methodology", "/about", "/privacy", "/terms", "/security", "/accessibility", "/contact", "/upload", "/addon", "/lore", "/lore/coverage", "/changes", "/map", "/map/eastern-kingdoms", "/map/kalimdor", ...DATABASE_HUB_PATHS, "/tools/collections", "/tools/guild-board", "/tools/auctions", "/tools/gold-ledger", "/addons", "/addons/popular", "/census", "/addons/ecosystem", "/addons/polestar", "/addons/polestar/packs", "/addons/polestar/wanted"];

  const talentRoutes = TALENT_CLASSES.map((slug) => `/tools/talents/${slug}`);
  // Item categories from the client layer: each class and subclass that holds items, first page only, and only
  // once half that page has a name (the page itself says noindex until then).
  const { named } = await loadShownNames();
  const itemRoutes = CLIENT_TAXONOMY.classes.filter((c) => c.items > 0).flatMap((c) => [
    ...(categoryNamedEnough(c.id, undefined, named) ? [itemsHref(c.slug)] : []),
    ...CLIENT_TAXONOMY.subclasses.filter((s) => s.classId === c.id && s.items > 0 && categoryNamedEnough(c.id, s.id, named)).map((s) => itemsHref(c.slug, s.slug)),
  ]);
  // Zone pages with something on them, like the item categories: one with nothing yet says noindex itself. The page
  // counts the players' treasures and entrances too, so it is asked with the same sightings.
  const [world, seen] = await Promise.all([loadWorldFacts(), loadSightings()]);
  const zoneRoutes = world.unreachable ? [] : (() => {
    const contents = zoneContents(world, undefined, seen);
    return publicZones().filter((z) => hasContent(contents.get(z.mapId))).map((z) => zoneHref(z.mapId, z.name));
  })();
  // Each dungeon and raid page, under the rule its page states (lib/database-sitemap.ts).
  const instanceRoutes = instancePaths(seen);
  // Achievement, faction, title and quest chain pages exist only for entries three players reported, so each listed one has content.
  const catalog = await loadCatalog();
  const catalogRoutes = catalog ? [...catalog.achievements.map((a) => achievementHref(a.achievementId, a.name)), ...catalog.factions.map((f) => factionHref(f.factionId, f.name)), ...catalog.titles.map((t) => titleHref(t.titleId, t.name)), ...catalog.chains.map((c) => chainHref(c.questLineId, c.name))] : [];
  // The rankings hub and each unfiltered ranking, once it asks to be indexed (10 ranked rows).
  const rankings = await loadRankingWeeks();
  const rankingRoutes = rankings.unreachable ? [] : [
    ...(hubIndexable(rankings.weeks) ? ["/rankings"] : []),
    ...RANKINGS.filter((def) => rankingIndexable(rankingView(def, rankings.weeks))).map((def) => rankingPath(def.slug)),
  ];
  const paths = [...new Set([...staticRoutes, ...rankingRoutes, ...talentRoutes, ...itemRoutes, ...zoneRoutes, ...instanceRoutes, ...catalogRoutes, ...tools.filter((tool) => tool.status !== "coming-soon").map(toolHref), ...allDocsPages().map((page) => page.href)])];

  const timeline = await loadTimeline();
  const newestChange = timeline[0]?.at;
  // A blue post's page only once it carries our reviewed write-up (it says noindex until then), dated by the review.
  const writeups = loadWriteups();
  const postRoutes = timeline.flatMap((e) => {
    const w = writeupFor(e, writeups);
    const path = w && postPath(e);
    return path ? [{ url: `${baseUrl}${path}`, lastModified: new Date(w.reviewed.on) }] : [];
  });
  const modified = (path: string): Date | undefined => {
    if (path === "/changes") return newestChange ? new Date(newestChange) : undefined;
    if (path === "/map" || path.startsWith("/map/")) return MAP_DATA_EXTRACTED_AT;
    if (path.startsWith("/database/items")) return new Date(CLIENT_LAYER.build.extractedAt);
    if (path === "/tools/raid" || path === "/tools/talents" || path.startsWith("/tools/talents/")) return TALENT_DATA_EXTRACTED_AT;
    if (path === "/wow-forever") return new Date(LAUNCH.checkedOn);
    return undefined;
  };

  return [
    ...paths.map((path) => {
      const lastModified = modified(path);
      return { url: `${baseUrl}${path}`, ...(lastModified ? { lastModified } : {}) };
    }),
    ...postRoutes,
    ...FAMILIES.map((family) => ({ url: `${baseUrl}/guilds/${family.slug}` })),
    // The wiki hub and each indexable wiki page, dated by the day a maintainer reviewed it.
    ...wikiSitemapPaths().map(({ path, lastModified }) => ({ url: `${baseUrl}${path}`, ...(lastModified ? { lastModified } : {}) })),
    // The news hub and each published post, dated by the day the post last changed.
    ...newsSitemapPaths(loadNews()).map(({ path, lastModified }) => ({ url: `${baseUrl}${path}`, ...(lastModified ? { lastModified } : {}) })),
  ];
}
