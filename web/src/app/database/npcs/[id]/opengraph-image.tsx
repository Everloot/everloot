import { loadWikiEntityNames, shownEntityName } from "@/lib/wiki-entity-names";
import { notFound } from "next/navigation";
import { npcNameReporters, npcPage } from "../../../../../../kb/src/world-pages";
import { AGREEMENT_NEEDED } from "@/components/ui/AgreementMeter";
import { CARD_SIZE, renderEntityCard } from "@/lib/og-card";
import { computeRollups, loadWorldFacts } from "@/lib/rollup-compute";
import { unknownNpc } from "../../unknown";

export const alt = "A WoW Forever NPC on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The NPC page's card: the name players agree on (else "NPC N"), and how many installs agree on it. The same 404 as the page.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) notFound();
  const npcId = Number(id);
  const [facts, rollup] = await Promise.all([loadWorldFacts(), computeRollups()]);
  const wiki = await loadWikiEntityNames("npc");
  if (unknownNpc(npcId, facts, rollup) && !wiki?.names.has(npcId)) notFound();
  const page = npcPage(npcId, facts);
  return renderEntityCard({
    title: shownEntityName(npcId, facts.unreachable ? null : page.name, wiki).name ?? `NPC ${npcId}`,
    type: "NPC",
    omitZero: true,
    installs: facts.unreachable ? null : page.name ? AGREEMENT_NEEDED : npcNameReporters(npcId, facts),
  });
}
