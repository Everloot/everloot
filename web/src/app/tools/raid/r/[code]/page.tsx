import type { Metadata } from "next";
import { notFound } from "next/navigation";
import RaidView from "../../RaidView";
import { decodeRaid, describeRaid } from "@/lib/raid";
import { pageMetadata } from "@/lib/seo";

// A raid link: /tools/raid/r/<ELR1 code>. The code sits in the path, not the #fragment, so the server
// can describe the roster in the link preview. The page is the planner opened on that raid; it then
// moves the address to /tools/raid#raid=. Rendered on first visit and kept for a day; not indexed,
// the planner is the canonical page.
export const revalidate = 86400;

type Params = { params: Promise<{ code: string }> };

async function resolve(params: Params["params"]) {
  const { code } = await params;
  const decoded = decodeRaid(decodeURIComponent(code));
  return decoded.ok ? { code: decodeURIComponent(code), raid: decoded.value } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const r = await resolve(params);
  if (!r) return {};
  const d = describeRaid(r.raid.size, r.raid.slots);
  const title = `${d.title}: ${d.roles} · WoW Forever raid plan`;
  const description = `A WoW: Forever ${d.title}, ${d.filled} of ${r.raid.size} slots filled: ${d.roles}. Open it in the raid buff planner to see which buffs each group gets.`;
  const base = pageMetadata({ title, description, path: `/tools/raid/r/${r.code}`, image: `/tools/raid/card?c=${r.code}` });
  return { ...base, alternates: { ...base.alternates, canonical: "/tools/raid" }, robots: { index: false, follow: true } };
}

export default async function RaidLinkPage({ params }: Params) {
  const r = await resolve(params);
  if (!r) notFound();
  return RaidView({ initialCode: r.code });
}
