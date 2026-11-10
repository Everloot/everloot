import { questPage, questScope, zonesFor, type QuestSighting, type VendorOffer, type WorldFacts } from "../../../../../kb/src/world-pages";
import { recheckRows } from "../../../../../kb/src/fact-states";
import { scopeSince } from "../../../../../kb/src/recheck-scopes";

import { agreementLabel } from "@/components/ui/AgreementMeter";
import { timeAgo } from "@/lib/time";

const installsFor = (rows: readonly { installId: string }[]) => new Set(rows.map((r) => r.installId.trim()).filter(Boolean)).size;

function reported(rows: readonly { installId: string; capturedAt?: string }[], now: number): string {
  const installs = installsFor(rows);
  const dates = rows.flatMap((r) => r.capturedAt && Number.isFinite(Date.parse(r.capturedAt)) ? [r.capturedAt] : []).sort((a, b) => Date.parse(b) - Date.parse(a));
  return `${agreementLabel(installs)} · ${dates[0] ? `last seen ${timeAgo(Date.parse(dates[0]), now)}` : "date not reported yet"}`;
}

/** Uses only the stored world facts already loaded for the page. */
export function npcRelations(npcId: number, facts: WorldFacts, now: number) {
  const zones = facts.recheck?.length ? zonesFor(facts.npcs) : new Map<number, number | null>();
  let questsReported = 0;
  const candidates = new Set(facts.quests.filter((r) => r.giverNpcId === npcId || r.turnInNpcId === npcId).map((r) => r.questId));
  const grouped = new Map<number, QuestSighting[]>();
  for (const r of facts.quests) if (candidates.has(r.questId) && r.installId.trim()) {
    const rows = grouped.get(r.questId) ?? [];
    rows.push(r);
    grouped.set(r.questId, rows);
  }
  const quests = [...grouped].sort(([a], [b]) => a - b).flatMap(([questId, rows]) => {
    const page = questPage(questId, { ...facts, quests: rows });
    const since = scopeSince(facts.recheck ?? [], questScope(questId, rows, zones));
    return (["giverNpcId", "turnInNpcId"] as const).flatMap((key) => {
      const effective = recheckRows(rows.filter((r) => r[key] !== undefined), since, { value: (r) => r[key]! }).rows;
      const matching = effective.filter((r) => r[key] === npcId);
      questsReported = Math.max(questsReported, installsFor(matching));
      if (page[key] !== npcId) return [];
      return [{ questId, title: page.title, role: key === "giverNpcId" ? "Giver" : "Turn-in", reported: reported(matching, now) }];
    });
  });
  const vendorRows = facts.vendors.filter((r) => r.vendorNpcId === npcId && r.installId.trim() && Number.isInteger(r.itemId) && r.itemId > 0);
  const effectiveGoods = (itemId: number) => {
    const since = scopeSince(facts.recheck ?? [], { types: ["vendors"], zones: [zones.get(npcId) ?? null], ids: [npcId, itemId] });
    const rows = recheckRows(vendorRows.filter((r) => r.itemId === itemId && Number.isInteger(r.priceCopper) && r.priceCopper >= 0), since, { value: (r) => r.priceCopper }).rows;
    return rows;
  };
  const goodsByItem = new Map([...new Set(vendorRows.map((r) => r.itemId))].map((id) => [id, effectiveGoods(id)]));
  const goodsEvidence = (offer: VendorOffer) => reported((goodsByItem.get(offer.itemId) ?? []).filter((r) => r.priceCopper === offer.priceCopper), now);
  let goodsReported = 0;
  for (const rows of goodsByItem.values()) {
    for (const price of new Set(rows.map((r) => r.priceCopper))) {
      goodsReported = Math.max(goodsReported, installsFor(rows.filter((r) => r.priceCopper === price)));
    }
  }
  return { quests, goodsEvidence, goodsReported, questsReported };
}
