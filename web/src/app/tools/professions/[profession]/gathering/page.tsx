import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GATHERING_GUIDE_SLUGS, type GatheringSearch } from "@/lib/gathering-guide";
import { professionBySegment, professionHref } from "@/lib/professions";
import { pageMetadata } from "@/lib/seo";
import GatheringGuide from "./guide";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ profession: string }>; searchParams?: Promise<GatheringSearch> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const p = professionBySegment((await props.params).profession);
  if (!p || !GATHERING_GUIDE_SLUGS.has(p.slug)) notFound();
  return pageMetadata({
    title: `WoW Forever ${p.name} Gathering Guide`,
    description: `Where to go for ${p.name} in WoW: Forever, with gathering zones, materials and trainers from player uploads.`,
    path: `${professionHref(p.slug)}/gathering`,
  });
}

export default async function GatheringPage(props: Props) {
  const segment = (await props.params).profession;
  const p = professionBySegment(segment);
  if (!p || !GATHERING_GUIDE_SLUGS.has(p.slug) || segment !== p.slug) notFound();
  return GatheringGuide({ profession: p, searchParams: await props.searchParams });
}
