import { postPath } from "../../../kb/src/blue-pages";
import type { ChangeEntry } from "./changes";
import { REPO_URL } from "./source";
import { SOCIAL_PROFILES } from "./social";
import { absoluteUrl, SITE_NAME, SITE_URL } from "./seo";

/**
 * Every structured-data block on the site is built here from the same values the page shows, so a
 * property cannot drift from the visible text. No ratings, no `license` on Blizzard's game data, no
 * game build as `softwareVersion`, no FAQPage, Person or speakable.
 */

export type JsonLd = Record<string, unknown>;

/** The text of a script tag: a `<` inside a value must not close it. */
export const serializeJsonLd = (data: JsonLd): string => JSON.stringify(data).replace(/</g, "\\u003c");

const CONTEXT = "https://schema.org";
export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

export const CONTACT_EMAIL = "hello@everloot.app";
/** The company that runs Everloot; LICENSE, TRADEMARKS.md, the terms and the privacy policy name it. */
export const OPERATOR = "R21 Media Group, LLC";
/** The Everloot Discord server; a permanent invite. */
export const DISCORD_INVITE = "https://discord.gg/9CKsbHTRu3";
/** The footer shows both sentences, and the Organization description repeats them. */
export const SITE_BLURB = "The WoW: Forever database, written by its players.";
/** Who runs Everloot, in the words /about uses; llms.txt and llms-full.txt say the same. */
export const OPERATOR_LINE = `Everloot is run by ${OPERATOR}.`;
/** The square logo the MCP listings use too (web/public/icon-512.png). */
export const LOGO = { path: "/icon-512.png", size: 512 } as const;
export const NON_AFFILIATION = "Not affiliated with or endorsed by Blizzard Entertainment.";
/** The trademark sentence the footer and the terms carry, in the form the other WoW fan sites use. */
export const TRADEMARK_LINE = "World of Warcraft, Warcraft and Blizzard Entertainment are trademarks or registered trademarks of Blizzard Entertainment, Inc. in the U.S. and/or other countries.";
export const CC_BY_SA = { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" } as const;
export const LORE_SEARCH_LABEL = "Search the lore archive";

const publisher = { "@id": ORG_ID };

export function organizationJsonLd(): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE_NAME,
    url: SITE_URL,
    logo: { "@type": "ImageObject", url: absoluteUrl(LOGO.path), width: LOGO.size, height: LOGO.size },
    email: CONTACT_EMAIL,
    description: `${SITE_BLURB} ${NON_AFFILIATION}`,
    // The company the footer's copyright line and /about name.
    parentOrganization: { "@type": "Organization", name: OPERATOR },
    sameAs: [REPO_URL, DISCORD_INVITE, ...SOCIAL_PROFILES.map((profile) => profile.href)],
    publishingPrinciples: `${SITE_URL}/methodology`,
  };
}

/** The search box on the home page reads the lore archive, and the action says so. */
export function websiteJsonLd(): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_BLURB,
    publisher,
    potentialAction: {
      "@type": "SearchAction",
      name: LORE_SEARCH_LABEL,
      target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/search?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

export interface Crumb { name: string; path: string }

/** The same trail the visible breadcrumb shows. The last crumb is the page itself. */
export function breadcrumbJsonLd(trail: Crumb[]): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, i) => ({ "@type": "ListItem", position: i + 1, name: crumb.name, item: absoluteUrl(crumb.path) })),
  };
}

export function webApplicationJsonLd(app: { name: string; path: string; description: string; hubPath?: string }): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "WebApplication",
    "@id": `${absoluteUrl(app.path)}#webapplication`,
    name: app.name,
    url: absoluteUrl(app.path),
    description: app.description,
    applicationCategory: "GameApplication",
    operatingSystem: "Web browser",
    publisher,
    ...(app.hubPath ? { isPartOf: { "@id": `${absoluteUrl(app.hubPath)}#webapplication` } } : {}),
  };
}

/**
 * One of Everloot's own programs (the addon, the Desktop App): its version and download as the page offers
 * them, the systems the page names, and free, as the page says. AGPL-3.0 is Everloot's own code, so its
 * licence may be stated; no rating.
 */
export function softwareApplicationJsonLd(app: { name: string; description: string; version: string; downloadPath: string; licenceUrl: string; path: string; operatingSystem?: string }): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "SoftwareApplication",
    name: app.name,
    url: absoluteUrl(app.path),
    description: app.description,
    applicationCategory: "GameApplication",
    ...(app.operatingSystem ? { operatingSystem: app.operatingSystem } : {}),
    softwareVersion: app.version,
    downloadUrl: absoluteUrl(app.downloadPath),
    license: app.licenceUrl,
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher,
  };
}

/**
 * The /wow-forever page and the game it is about, with only what the page states: the full name and the short
 * ones it explains, Blizzard as the company releasing it, and the Blizzard post it quotes.
 */
export function videoGamePageJsonLd(page: { name: string; description: string; path: string; source: { title: string; url: string } }): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "WebPage",
    name: page.name,
    description: page.description,
    url: absoluteUrl(page.path),
    isPartOf: { "@id": WEBSITE_ID },
    about: {
      "@type": "VideoGame",
      name: "World of Warcraft: Forever",
      alternateName: ["WoW: Forever", "WoW Forever"],
      publisher: { "@type": "Organization", name: "Blizzard Entertainment" },
      subjectOf: { "@type": "Article", headline: page.source.title, url: page.source.url },
    },
  };
}

/** The public observation corpus. Null while nothing has been uploaded, so an empty dataset is never advertised. */
export function datasetJsonLd(data: { uploads: number; name: string; description: string; path: string; corpusPath: string; dataAsOf?: string | null }): JsonLd | null {
  if (!(data.uploads > 0)) return null;
  return {
    "@context": CONTEXT,
    "@type": "Dataset",
    name: data.name,
    description: data.description,
    url: absoluteUrl(data.path),
    license: CC_BY_SA.url,
    creator: publisher,
    isAccessibleForFree: true,
    ...(data.dataAsOf ? { dateModified: data.dataAsOf } : {}),
    distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: absoluteUrl(data.corpusPath) }],
  };
}

/**
 * An Auction House price page: a Dataset of the public days it shows. Not a Product with an Offer: nobody
 * here sells the item, and gold is not a currency a search engine knows.
 */
export function marketDatasetJsonLd(page: { name: string; description: string; path: string; apiPath: string; from: string; to: string; dataAsOf: string | null }): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "Dataset",
    name: page.name,
    description: page.description,
    url: absoluteUrl(page.path),
    license: CC_BY_SA.url,
    creator: publisher,
    isAccessibleForFree: true,
    temporalCoverage: `${page.from}/${page.to}`,
    variableMeasured: ["Market value", "Minimum buyout", "Historical value", "Units listed"],
    ...(page.dataAsOf ? { dateModified: page.dataAsOf } : {}),
    distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: absoluteUrl(page.apiPath) }],
  };
}

/** One timeline entry as the page shows it. A build carries no date property: its time is when Everloot first saw it. */
function changeItem(entry: ChangeEntry): JsonLd {
  if (entry.type === "build") {
    return {
      "@type": "CreativeWork",
      name: entry.title,
      description: `First seen by Everloot on ${entry.at.slice(0, 10)}. Blizzard's own release time is not recorded.`,
    };
  }
  // The row links the post's page on Everloot, which links the original.
  const page = postPath(entry);
  const url = page ? absoluteUrl(page) : entry.url;
  return {
    "@type": "CreativeWork",
    name: entry.title,
    datePublished: entry.at,
    ...(entry.author ? { author: entry.author } : {}),
    ...(url ? { url } : {}),
  };
}

/**
 * A blue post's page once it carries our reviewed write-up: an Article by Everloot, dated the day the write-up
 * was reviewed, based on Blizzard's post (its title, time and link, as the page shows them). No Person.
 */
export function blueWriteupJsonLd(page: { title: string; description: string; path: string; reviewedOn: string; original: { url: string | null; at: string } }): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "Article",
    headline: page.title,
    description: page.description,
    url: absoluteUrl(page.path),
    mainEntityOfPage: absoluteUrl(page.path),
    datePublished: page.reviewedOn,
    dateModified: page.reviewedOn,
    author: publisher,
    publisher,
    isPartOf: { "@id": WEBSITE_ID },
    isBasedOn: {
      "@type": "CreativeWork",
      name: page.title,
      datePublished: page.original.at,
      ...(page.original.url ? { url: page.original.url } : {}),
    },
  };
}

export function changesJsonLd(page: { name: string; description: string; path: string; entries: ChangeEntry[] }): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "CollectionPage",
    name: page.name,
    description: page.description,
    url: absoluteUrl(page.path),
    isPartOf: { "@id": WEBSITE_ID },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: page.entries.length,
      itemListElement: page.entries.map((entry, i) => ({ "@type": "ListItem", position: i + 1, item: changeItem(entry) })),
    },
  };
}

export function loreCollectionJsonLd(page: { name: string; description: string; path: string; creditText: string }): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "CollectionPage",
    name: page.name,
    description: page.description,
    url: absoluteUrl(page.path),
    license: CC_BY_SA.url,
    creditText: page.creditText,
    isPartOf: { "@id": WEBSITE_ID },
  };
}

/**
 * A wiki page: Everloot's own text, so its CC BY-SA licence may be stated. `about` names the bound entity when
 * the page can name it; `dateModified` is the day a maintainer reviewed the page.
 */
export function wikiArticleJsonLd(page: { title: string; summary: string; path: string; reviewedOn: string | null; about: { name: string; path: string | null } | null }): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "Article",
    headline: page.title,
    description: page.summary,
    url: absoluteUrl(page.path),
    mainEntityOfPage: absoluteUrl(page.path),
    isPartOf: { "@id": WEBSITE_ID },
    author: publisher,
    publisher,
    license: CC_BY_SA.url,
    ...(page.reviewedOn ? { dateModified: page.reviewedOn } : {}),
    ...(page.about ? { about: { "@type": "Thing", name: page.about.name, ...(page.about.path ? { url: absoluteUrl(page.about.path) } : {}) } } : {}),
  };
}

/**
 * A news post: Everloot's own text, so its CC BY-SA licence may be stated. The author is named in the visible
 * byline only; here the organization stands as author and publisher, as on every other page (no Person).
 */
export function newsArticleJsonLd(page: { title: string; description: string; path: string; published: string; modified: string; author: string; image?: string }): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "NewsArticle",
    headline: page.title,
    description: page.description,
    ...(page.image ? { image: [page.image.startsWith("/") ? absoluteUrl(page.image) : page.image] } : {}),
    url: absoluteUrl(page.path),
    mainEntityOfPage: absoluteUrl(page.path),
    isPartOf: { "@id": WEBSITE_ID },
    datePublished: page.published,
    dateModified: page.modified,
    author: { "@type": "Organization", name: "Everloot Team" },
    publisher,
    license: CC_BY_SA.url,
  };
}

export function aboutPageJsonLd(page: { name: string; description: string; path: string }): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "AboutPage",
    name: page.name,
    description: page.description,
    url: absoluteUrl(page.path),
    about: { "@id": ORG_ID },
    isPartOf: { "@id": WEBSITE_ID },
  };
}
