import { notFound } from "next/navigation";
import { questPage } from "../../../../../../kb/src/world-pages";
import { AGREEMENT_NEEDED } from "@/components/ui/AgreementMeter";
import { loadQuestNames } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@/lib/items";
import { CARD_SIZE, renderEntityCard } from "@/lib/og-card";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { unknownQuest } from "../../unknown";

export const alt = "A WoW Forever quest on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The quest page's card: the title players agree on, else the Warcraft Wiki's for a quest the game files list (as
// the page shows it, with no install behind it), its level when 3 installs agree, and the same 404 as the page.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) notFound();
  const [facts, wiki] = await Promise.all([loadWorldFacts(), loadQuestNames(CLIENT_LAYER.build.version)]);
  const page = questPage(Number(id), facts);
  if (unknownQuest(page.questId, facts, wiki)) notFound();
  const reported = !facts.unreachable && page.title ? page.title : null;
  return renderEntityCard({
    title: reported ?? wiki?.names.get(page.questId)?.name ?? `Quest ${page.questId}`,
    type: !facts.unreachable && page.level !== null ? `Quest · Level ${page.level}` : "Quest",
    installs: facts.unreachable ? null : reported ? AGREEMENT_NEEDED : 0,
  });
}
