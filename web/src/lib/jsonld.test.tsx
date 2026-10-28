import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import JsonLd from "@/components/JsonLd";
import type { ChangeEntry } from "./changes";
import {
  aboutPageJsonLd, breadcrumbJsonLd, changesJsonLd, datasetJsonLd, loreCollectionJsonLd, organizationJsonLd,
  newsArticleJsonLd, serializeJsonLd, softwareApplicationJsonLd, webApplicationJsonLd, websiteJsonLd,
} from "./jsonld";

const everything = JSON.stringify;

test("news image is optional and site paths become absolute without changing author policy", () => {
  const post = { title: "Title", description: "Summary", path: "/news/example", published: "2026-10-25", modified: "2026-10-26", author: "Visible author" };
  expect(newsArticleJsonLd(post)).not.toHaveProperty("image");
  expect(newsArticleJsonLd({ ...post, image: "/news/heroes/example/share.png" })).toMatchObject({
    image: ["https://everloot.app/news/heroes/example/share.png"], author: { "@type": "Organization", name: "Everloot Team" },
  });
});

test("a less-than sign in a value cannot close the script tag", () => {
  const text = serializeJsonLd({ name: "</script><b>x" });
  expect(text).not.toContain("<");
  expect(JSON.parse(text).name).toBe("</script><b>x");
  const html = renderToStaticMarkup(<JsonLd data={{ "@context": "https://schema.org", name: "a </script> b" }} />);
  expect(html.match(/<\/script>/g)).toHaveLength(1);
});

test("JsonLd renders nothing for null", () => {
  expect(renderToStaticMarkup(<JsonLd data={null} />)).toBe("");
});

test("Organization carries the repository, the email and the site blurb, and WebSite describes its search as lore search", () => {
  const org = organizationJsonLd() as Record<string, unknown> & { description: string };
  expect(org.sameAs).toEqual(["https://github.com/Everloot/everloot", "https://discord.gg/9CKsbHTRu3", "https://x.com/WowEverloot", "https://www.facebook.com/WowEverloot", "https://www.instagram.com/woweverloot/", "https://www.pinterest.com/woweverloot/"]);
  expect(org.email).toBe("hello@everloot.app");
  expect(org.publishingPrinciples).toBe("https://everloot.app/methodology");
  expect(org.description).toBe("The WoW: Forever database, written by its players.");
  // The operator the footer and /about name, and the square logo the listings use.
  expect(org.parentOrganization).toEqual({ "@type": "Organization", name: "R21 Media Group, LLC" });
  expect(org.logo).toEqual({ "@type": "ImageObject", url: "https://everloot.app/icon-512.png", width: 512, height: 512 });
  const site = websiteJsonLd() as { potentialAction: { name: string; target: { urlTemplate: string } } };
  expect(site.potentialAction.name).toBe("Search the lore archive");
  expect(site.potentialAction.target.urlTemplate).toBe("https://everloot.app/search?q={search_term_string}");
});

test("BreadcrumbList lists the trail in order with absolute URLs", () => {
  const list = breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Talent calculator", path: "/tools/talents" }, { name: "Hunter", path: "/tools/talents/hunter" }]) as { itemListElement: { position: number; name: string; item: string }[] };
  expect(list.itemListElement.map((i) => [i.position, i.name, i.item])).toEqual([
    [1, "Home", "https://everloot.app"],
    [2, "Talent calculator", "https://everloot.app/tools/talents"],
    [3, "Hunter", "https://everloot.app/tools/talents/hunter"],
  ]);
});

test("WebApplication has only what the page gives it: no rating, no licence, no game build as a version", () => {
  const app = webApplicationJsonLd({ name: "WoW Forever Hunter Talent Calculator", path: "/tools/talents/hunter", description: "Plan Hunter talents.", hubPath: "/tools/talents" });
  expect(app).toMatchObject({
    "@type": "WebApplication", name: "WoW Forever Hunter Talent Calculator", url: "https://everloot.app/tools/talents/hunter",
    description: "Plan Hunter talents.", isPartOf: { "@id": "https://everloot.app/tools/talents#webapplication" },
  });
  const text = everything(app);
  for (const banned of ["aggregateRating", "ratingValue", "license", "softwareVersion", "Person", "FAQPage", "speakable"]) expect(text).not.toContain(banned);
});

test("SoftwareApplication takes its version and download from the release it is given", () => {
  const app = softwareApplicationJsonLd({ name: "Everloot addon", description: "d", version: "9.8.7", downloadPath: "/downloads/Everloot-9.8.7.zip", licenceUrl: "https://www.gnu.org/licenses/agpl-3.0.html", path: "/upload" });
  expect(app).toMatchObject({ softwareVersion: "9.8.7", downloadUrl: "https://everloot.app/downloads/Everloot-9.8.7.zip", license: "https://www.gnu.org/licenses/agpl-3.0.html" });
  // Free, as the page says; no rating, and an operating system only when the page names one.
  expect(app).toMatchObject({ isAccessibleForFree: true, offers: { "@type": "Offer", price: "0" } });
  expect(app).not.toHaveProperty("operatingSystem");
  expect(JSON.stringify(app)).not.toMatch(/aggregateRating|ratingValue/);
  const desktop = softwareApplicationJsonLd({ name: "Everloot Desktop App", description: "d", version: "0.1.0", downloadPath: "https://github.com/Everloot/everloot/releases/tag/desktop-v0.1.0", licenceUrl: "l", path: "/addon", operatingSystem: "Windows, macOS, Linux" });
  expect(desktop).toMatchObject({ operatingSystem: "Windows, macOS, Linux", downloadUrl: "https://github.com/Everloot/everloot/releases/tag/desktop-v0.1.0" });
});

test("Dataset is emitted only when something was uploaded", () => {
  const base = { name: "n", description: "d", path: "/database", corpusPath: "/api/corpus/public", dataAsOf: "2026-10-17T18:20:27.999Z" };
  expect(datasetJsonLd({ ...base, uploads: 0 })).toBeNull();
  expect(datasetJsonLd({ ...base, uploads: -1 })).toBeNull();
  expect(datasetJsonLd({ ...base, uploads: Number.NaN })).toBeNull();
  expect(datasetJsonLd({ ...base, uploads: 3 })).toMatchObject({
    "@type": "Dataset", license: "https://creativecommons.org/licenses/by-sa/4.0/", dateModified: base.dataAsOf,
    distribution: [{ "@type": "DataDownload", contentUrl: "https://everloot.app/api/corpus/public" }],
  });
});

const post: ChangeEntry = { id: "p1", type: "post", game: "forever", at: "2026-10-08T23:05:00.000Z", title: "Mac fixes", url: "https://us.forums.blizzard.com/x", author: "Someone", role: "Community Manager", category: "General" };
const noUrl: ChangeEntry = { id: "p2", type: "post", game: "forever", at: "2026-10-07T10:00:00.000Z", title: "No link", url: null };
const build: ChangeEntry = { id: "build:1", type: "build", game: "forever", at: "2026-10-17T09:14:00.000Z", title: "WoW: Forever build 1.60.1.70450", url: null, version: "1.60.1.70450" };

test("changes ItemList mirrors the entries shown: posts with their own time and author, builds as first seen", () => {
  const page = changesJsonLd({ name: "n", description: "d", path: "/changes", entries: [build, post, noUrl] }) as {
    "@type": string; mainEntity: { numberOfItems: number; itemListElement: { position: number; item: Record<string, unknown> }[] };
  };
  expect(page["@type"]).toBe("CollectionPage");
  expect(page.mainEntity.numberOfItems).toBe(3);
  const [b, p, n] = page.mainEntity.itemListElement.map((e) => e.item);
  expect(b).toEqual({ "@type": "CreativeWork", name: build.title, description: "First seen by Everloot on 2026-10-17. Blizzard's own release time is not recorded." });
  expect(p).toEqual({ "@type": "CreativeWork", name: "Mac fixes", datePublished: post.at, author: "Someone", url: post.url });
  expect(n).toEqual({ "@type": "CreativeWork", name: "No link", datePublished: noUrl.at });
  const text = everything(page);
  for (const banned of ["Article", "Person", "dateCreated"]) expect(text).not.toContain(banned);
});

test("an empty change list is an empty ItemList, not an invented one", () => {
  const page = changesJsonLd({ name: "n", description: "d", path: "/changes", entries: [] }) as { mainEntity: { numberOfItems: number; itemListElement: unknown[] } };
  expect(page.mainEntity.numberOfItems).toBe(0);
  expect(page.mainEntity.itemListElement).toEqual([]);
});

test("lore CollectionPage carries the licence and credit text, AboutPage points at the organization", () => {
  expect(loreCollectionJsonLd({ name: "Lore archive", description: "d", path: "/lore", creditText: "Warcraft Wiki contributors, CC BY-SA 4.0" })).toMatchObject({
    "@type": "CollectionPage", license: "https://creativecommons.org/licenses/by-sa/4.0/", creditText: "Warcraft Wiki contributors, CC BY-SA 4.0",
  });
  expect(aboutPageJsonLd({ name: "About Everloot", description: "d", path: "/about" })).toMatchObject({ "@type": "AboutPage", about: { "@id": "https://everloot.app/#organization" } });
});
