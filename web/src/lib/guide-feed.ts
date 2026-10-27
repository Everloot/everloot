import { ChangeEntry } from "../../../kb/src/build-watch/changes";
import { GuideFrontMatter } from "../../../kb/src/guides/guide";
import { escapeXml } from "./sitemap-xml";
import { decodeBuild } from "./talents/share";

// XML 1.0 forbids controls and lone surrogates even when entity-escaped.
const xml = (value: string) => escapeXml(Array.from(value).filter((char) => {
  const n = char.codePointAt(0)!;
  return n === 9 || n === 10 || n === 13 || (n >= 32 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || n >= 0x10000;
}).join(""));

export interface GuideFeedItem {
  id: string;
  guideId: number;
  version: number;
  slug: string;
  title: string;
  note: string;
  on: string;
}

/** Only readable, explicitly live records grant authority. Conflicts fail closed. Conservatively exclude a build
 *  containing any spoiler talent evidence: history has no old plan snapshot with which to narrow that evidence. */
function publicBuilds(records: readonly unknown[]): Set<string> {
  const allowed = new Set<string>();
  const refused = new Set<string>();
  for (const raw of records) {
    const result = ChangeEntry.safeParse(raw);
    const build = (raw as { build?: { version?: unknown } } | null)?.build?.version;
    if (typeof build !== "string") continue;
    if (!result.success || !result.data.live || result.data.spoiler ||
      (result.data.talents && Object.values(result.data.talents).some((items) => items.some((item) => item.spoiler)))) {
      refused.add(build);
    } else allowed.add(build);
  }
  for (const build of refused) allowed.delete(build);
  return allowed;
}

// The shared date schema checks the shape; also refuse impossible calendar dates rather than normalizing them.
function realDate(on: string): boolean {
  const date = new Date(`${on}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === on;
}

/** Pure public projection, shared by both feeds. No age/indexability filter, current bodies, private fields,
 *  hidden build identifiers/counts or request-time fallback. Class filtering happens before the newest-50 cap. */
export function projectGuideFeed(guides: readonly unknown[], records: readonly unknown[], classSlug?: string): GuideFeedItem[] {
  const allowed = publicBuilds(records);
  const items: GuideFeedItem[] = [];
  for (const raw of guides) {
    if (!raw || typeof raw !== "object") continue;
    // Server readers attach parsed body blocks; they are never part of the feed or front matter validation.
    const { blocks: _blocks, ...fields } = raw as Record<string, unknown>;
    const parsed = GuideFrontMatter.safeParse(fields);
    if (!parsed.success) continue;
    const guide = parsed.data;
    if (guide.status !== "published" || !guide.reviewed || (classSlug !== undefined && guide.classSlug !== classSlug)) continue;
    if (!allowed.has(guide.reviewed.build) || guide.history.some((entry) => !realDate(entry.on))) continue;
    if ([guide.code, guide.code2].some((code) => {
      if (code === undefined) return false;
      const decoded = decodeBuild(code);
      return !decoded.ok || !allowed.has(decoded.build.build);
    })) continue;
    for (const entry of guide.history) {
      if (!allowed.has(entry.build)) continue;
      items.push({ id: `guide:${guide.id}:v${entry.version}`, guideId: guide.id, version: entry.version,
        slug: guide.slug, title: guide.title, note: entry.note, on: entry.on });
    }
  }
  return items.sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0) || a.guideId - b.guideId || b.version - a.version).slice(0, 50);
}

/** History is a revision note, never a reconstructed historical guide body. Empty channels have no date. */
export function renderGuideFeed(items: readonly GuideFeedItem[], options: { baseUrl: string; classSlug?: string }): string {
  const base = options.baseUrl.replace(/\/+$/, "");
  const path = options.classSlug === undefined ? "/guides" : `/classes/${options.classSlug}`;
  const title = options.classSlug === undefined ? "Everloot guide revisions" : `Everloot ${options.classSlug} guide revisions`;
  const date = (on: string) => new Date(`${on}T00:00:00.000Z`).toUTCString();
  const newest = items.reduce<string | null>((latest, item) => latest === null || item.on > latest ? item.on : latest, null);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${xml(title)}</title>
<link>${xml(base + path)}</link>
<description>Reviewed guide revision notes from Everloot.</description>
${newest === null ? "" : `<lastBuildDate>${date(newest)}</lastBuildDate>\n`}${items.map((item) => `<item>
<title>${xml(`${item.title} — version ${item.version}`)}</title>
<link>${xml(`${base}/guides/${item.slug}#version-${item.version}`)}</link>
<guid isPermaLink="false">${xml(item.id)}</guid>
<pubDate>${date(item.on)}</pubDate>
<description>${xml(item.note)}</description>
</item>`).join("\n")}
</channel></rss>`;
}
