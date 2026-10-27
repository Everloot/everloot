import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import TalentCompare from "@/components/talents/TalentCompare";
import { CLASS_TEXT } from "@/components/talents/TalentTreeView";
import { Container, PageHeader } from "@/components/ui";
import { pageMetadata } from "@/lib/seo";
import { TALENT_CLASSES, loadCatalog, type TalentClassSlug } from "@/lib/talents/catalogs";
import { PUBLISHED_CHANGES, classTalentChanges } from "@/lib/talents/freshness";

// Two plans of one class side by side: /tools/talents/<class>/compare#a=<code>&ao=<order>&b=<code>&bo=<order>. The plans
// ride in the fragment, which only the browser reads, so the page is built once per class and cached, like the class
// page. Not indexed and not in the sitemap: without plans it holds nothing of its own, and the class page is the
// canonical one. The change records are read here, on the server; only this class's go to the browser.
export const dynamicParams = false;

export function generateStaticParams() {
  return TALENT_CLASSES.map((slug) => ({ class: slug }));
}

type Params = { params: Promise<{ class: string }> };

/** One of the nine classes, or null: a name every object answers to, such as "constructor", is not a class. */
const classOf = (slug: string) => ((TALENT_CLASSES as readonly string[]).includes(slug) ? (slug as TalentClassSlug) : null);

const title = (className: string) => `Compare WoW Forever ${className} Talent Plans`;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const slug = classOf((await params).class);
  if (!slug) return {};
  const { className } = await loadCatalog(slug);
  const base = pageMetadata({
    title: title(className),
    description: `Compare two WoW: Forever ${className} talent plans side by side: the talents that differ, the points in each tree and, with spend orders, each plan by level.`,
    path: `/tools/talents/${slug}/compare`,
    image: `/tools/talents/${slug}/opengraph-image`,
  });
  return { ...base, alternates: { ...base.alternates, canonical: `/tools/talents/${slug}` }, robots: { index: false, follow: true } };
}

export default async function TalentComparePage({ params }: Params) {
  const slug = classOf((await params).class);
  if (!slug) notFound();
  const catalog = await loadCatalog(slug);
  return (
    <Container>
      <PageHeader
        title={<span className={CLASS_TEXT[slug]}>{title(catalog.className)}</span>}
        lede="Two plans side by side: the talents that differ, the points in each tree and, when both carry a spend order, each plan level by level. It compares choices, not damage."
        actions={<Link href={`/tools/talents/${slug}`} className="btn text-sm">{catalog.className} calculator</Link>}
      />
      <TalentCompare catalog={catalog} changes={classTalentChanges(PUBLISHED_CHANGES, catalog.classId)} />
    </Container>
  );
}
