/**
 * The guides' content model: one Markdown file per guide under kb/guides/, YAML front matter on top, the wiki's body
 * syntax. A guide is Everloot's own advice on one talent plan: who it is for, why it fits an activity, how to play it
 * and what is not known yet, reviewed before it is published. Pure, with no file access, so the guide check, the site
 * and any other reader of a reviewed version read a guide the same way.
 *
 * The rules a guide's fields keep with each other (a published guide has its review and its history, a published
 * order is one a player planned) are part of the schema, so a reader that only parses a guide still refuses one that
 * breaks them. What needs the talent trees, the wiki or the other guides is the check's (check.ts).
 */
import { TALENT_CLASSES } from "@everloot/protocol";
import { z } from "zod";
import { decodeBuild, decodeOrder } from "../../../web/src/lib/talents/share";
import { parsePage, type ParsedPage } from "../wiki/page.js";

export const GUIDE_ACTIVITIES = ["leveling", "dungeons", "raids"] as const;
export type GuideActivity = (typeof GUIDE_ACTIVITIES)[number];

/** The roles the raid planner uses; a guide lists the ones its plan is written for. */
export const GUIDE_ROLES = ["tank", "healer", "damage"] as const;
export type GuideRole = (typeof GUIDE_ROLES)[number];

/** The `##` sections of a guide, in order: who the plan is for, why it fits, how to play it, and what is not known. */
export const GUIDE_SECTIONS = ["Who it is for", "Why this plan", "How to play it", "What we do not know yet"] as const;

/** Each talent set's fields: its share code, and the spend order that rides with it. */
export const GUIDE_SETS = [["code", "order"], ["code2", "order2"]] as const;

/** Addresses under /guides that are pages of their own, so no guide may take them as its slug. */
export const RESERVED_GUIDE_SLUGS: Readonly<Record<string, string>> = {
  write: "/guides/write is the page where a player writes a community guide",
};

const id = z.number().int().positive();
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters and digits joined by single hyphens");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD");
const httpsUrl = z.url({ protocol: /^https$/ });
const gameBuild = z.string().regex(/^\d+(?:\.\d+)+$/, "a game build such as 1.60.1.70532");
const person = z.string().trim().min(1).max(80);
const level = z.number().int().min(1);

const Fields = z.strictObject({
  /** Stable and never reused. */
  id,
  /** The file name and the address, /guides/<slug>. A published guide keeps it. Never a reserved address. */
  slug: slug.superRefine((s, ctx) => {
    if (Object.hasOwn(RESERVED_GUIDE_SLUGS, s)) ctx.addIssue({ code: "custom", message: `slug "${s}" is reserved: ${RESERVED_GUIDE_SLUGS[s]}; pick another slug` });
  }),
  /** The version the file holds: the last published one, or while it is a draft, the next. */
  version: id,
  /** Set by people, through review. How current a published guide still is, readers work out from the data. */
  status: z.enum(["draft", "published"]),
  title: z.string().trim().min(1).max(90),
  /** Everloot's words: the line under the title, and the search snippet. */
  summary: z.string().trim().min(1).max(300),
  classSlug: z.enum(TALENT_CLASSES),
  activity: z.enum(GUIDE_ACTIVITIES),
  roles: z.array(z.enum(GUIDE_ROLES)).min(1),
  /** The levels the guide covers. */
  levels: z.strictObject({ from: level, to: level }),
  /** The first talent set's share code and spend order, then optionally the second set's. Without an order, a reader
   *  shows the order as unknown. */
  code: z.string(),
  order: z.string().optional(),
  code2: z.string().optional(),
  order2: z.string().optional(),
  /** Who wrote it, as the page names them. */
  author: person,
  /** The review of the version the file holds: who read it, on which day, against which game build. */
  reviewed: z.strictObject({ by: person, on: isoDate, build: gameBuild }).nullable(),
  /** Blizzard's posts, each cited in the body next to the claim it supports. */
  sources: z.array(z.strictObject({ title: z.string().trim().min(1), url: httpsUrl, checkedOn: isoDate })).default([]),
  /** Every published version, oldest first, with its review and what changed. Entries are never edited once there. */
  history: z.array(z.strictObject({ version: id, on: isoDate, by: person, build: gameBuild, note: z.string().trim().min(1).max(300) })).default([]),
});

export const GuideFrontMatter = Fields.superRefine((fm, ctx) => lifecycle(fm, (message, path) => ctx.addIssue({ code: "custom", message, path })));
export type GuideFrontMatter = z.infer<typeof GuideFrontMatter>;

function lifecycle(fm: z.output<typeof Fields>, issue: (message: string, path: PropertyKey[]) => void): void {
  const published = fm.status === "published";

  if (fm.levels.from > fm.levels.to) issue(`levels.from (${fm.levels.from}) is above levels.to (${fm.levels.to})`, ["levels"]);
  fm.roles.forEach((role, i) => {
    if (fm.roles.indexOf(role) !== i) issue(`roles lists "${role}" twice`, ["roles", i]);
  });

  // The plan reads as the calculator reads it. Whether it fits the class's tree is for the check, which has the trees.
  for (const [codeKey, orderKey] of GUIDE_SETS) {
    const code = fm[codeKey];
    const token = fm[orderKey];
    if (code === undefined) {
      if (token !== undefined) issue(`${orderKey} has no ${codeKey} to order`, [orderKey]);
      continue;
    }
    const decoded = decodeBuild(code);
    if (!decoded.ok) {
      issue(`${codeKey} is not a share code the calculator reads (${decoded.error})`, [codeKey]);
      continue;
    }
    if (decoded.build.classSlug !== fm.classSlug) {
      issue(`${codeKey} is a ${decoded.build.classSlug} plan; this guide is for ${fm.classSlug}`, [codeKey]);
      continue;
    }
    if (token === undefined) continue;
    const order = decodeOrder(token, decoded.build.ranks);
    if (!order.ok) issue(`${orderKey} cannot be read with its code (${order.error})`, [orderKey]);
    else if (published && order.origin !== "planned") {
      issue(`${orderKey} is provisional (O1g), made by a tool; a published guide carries an order a player planned (O1p)`, [orderKey]);
    }
  }

  // History: one entry per published version, counting up from 1, never dated before the one above it.
  fm.history.forEach((entry, i) => {
    if (entry.version !== i + 1) issue(`history.${i} is version ${entry.version}; versions count up from 1, so it is version ${i + 1}`, ["history", i]);
    const above = fm.history[i - 1];
    if (above && entry.on < above.on) issue(`history.${i} is dated ${entry.on}, before version ${above.version} (${above.on})`, ["history", i]);
  });

  const last = fm.history.at(-1);
  const n = fm.history.length;
  if (published) {
    if (!fm.reviewed) issue("a published guide needs reviewed: { by, on, build } from the person who reviewed this version", ["reviewed"]);
    if (last?.version !== fm.version) {
      issue(`a published guide records version ${fm.version} in history (version, on, by, build, note); history ${last ? `ends at version ${last.version}` : "is empty"}`, ["history"]);
    } else if (fm.reviewed && (last.by !== fm.reviewed.by || last.on !== fm.reviewed.on || last.build !== fm.reviewed.build)) {
      issue(`history.${n - 1} records a different review from reviewed; the last version's entry is its review`, ["history", n - 1]);
    }
  } else if (fm.version !== n && fm.version !== n + 1) {
    issue(`version ${fm.version} does not follow history, which ${n ? `ends at version ${n}` : "is empty"}; a draft holds ${n ? `version ${n} or ${n + 1}` : "version 1"}`, ["version"]);
  }
}

/** A guide file split into its front matter (parsed YAML, unchecked) and body blocks. Throws when the front matter is missing. */
export const parseGuide = (source: string): ParsedPage => parsePage(source);

/** The site's own origins, as URL gives them: the host in lower case and the default port left out. */
const SITE_ORIGINS: ReadonlySet<string> = new Set(["https://everloot.app", "https://www.everloot.app"]);

/** The path a link's address opens on the site, read as a browser reads it there; null for another site. */
export function sitePath(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href, "https://everloot.app");
  } catch {
    return null;
  }
  return SITE_ORIGINS.has(url.origin) ? url.pathname : null;
}

/** The guide a link's address points at: "frost-leveling" for `/guides/frost-leveling`, also with a trailing slash, a
 *  query or a fragment, or written out in full on the site. Null for any other address, the guides hub included. */
export function guideLinkTarget(href: string): string | null {
  const path = sitePath(href);
  return path?.startsWith("/guides/") ? path.slice("/guides/".length).replace(/\/+$/, "") || null : null;
}
