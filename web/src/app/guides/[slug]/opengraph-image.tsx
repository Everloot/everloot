import { notFound } from "next/navigation";
import { classLabel } from "@/lib/class-context";
import { ACTIVITY_LABEL, loadGuides, publishedGuide, publishedGuides } from "@/lib/guides";
import { CARD_SIZE, renderCard } from "@/lib/og-card";

export const alt = "A WoW Forever guide on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";

// Drawn while the site builds, for the published guides only: any other slug, a draft's included, is a 404.
export const dynamicParams = false;
export function generateStaticParams() {
  return publishedGuides(loadGuides()).map((g) => ({ slug: g.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = publishedGuide(loadGuides(), slug);
  if (!guide) notFound();
  return renderCard({
    label: "Everloot guide",
    title: guide.title,
    subtitle: `${classLabel(guide.classSlug)} · ${ACTIVITY_LABEL[guide.activity]} · Levels ${guide.levels.from}–${guide.levels.to}`,
  });
}
