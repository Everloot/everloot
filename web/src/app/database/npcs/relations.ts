import { isPinPosition, questPage, type QuestSighting, type VendorOffer, type WorldFacts } from "../../../../../kb/src/world-pages";
import { recheckRows, tallyVotes } from "../../../../../kb/src/fact-states";
import { npcZones, scopeSince } from "../../../../../kb/src/recheck-scopes";

function reported(rows: readonly { installId: string; capturedAt?: string }[]): string {
  const installs = new Set(rows.map((r) => r.installId.trim()).filter(Boolean)).size;
  const dates = rows.flatMap((r) => r.capturedAt && Number.isFinite(Date.parse(r.capturedAt)) ? [r.capturedAt] : []).sort((a, b) => Date.parse(b) - Date.parse(a));
  return `${installs} installs agree · ${dates[0] ? `last reported ${dates[0]}` : "date not reported yet"}`;
}

/** Uses only the stored world facts already loaded for the page. */
export function npcRelations(npcId: number, facts: WorldFacts) {
  const zones = npcZones(facts.npcs.map((r) => ({ ...r, pin: isPinPosition(r.positionKind) })));
  const candidates = new Set(facts.quests.filter((r) => r.giverNpcId === npcId || r.turnInNpcId === npcId).map((r) => r.questId));
  const grouped = new Map<number, QuestSighting[]>();
  for (const r of facts.quests) if (candidates.has(r.questId) && r.installId.trim()) {
    const rows = grouped.get(r.questId) ?? [];
    rows.push(r);
    grouped.set(r.questId, rows);
  }
  const quests = [...grouped].sort(([a], [b]) => a - b).flatMap(([questId, rows]) => {
    const page = questPage(questId, { ...facts, quests: rows });
    // Match questPage's placement and recheck scope, including reward-item scopes.
    const lead = (key: "giverNpcId" | "turnInNpcId") => {
      const id = tallyVotes(rows.flatMap((r) => r[key] === undefined ? [] : [{ installId: r.installId, value: r[key]! }])).groups.sort((a, b) => b.voters.size - a.voters.size)[0]?.value;
      return typeof id === "number" ? zones.get(id) ?? null : null;
    };
    const since = scopeSince(facts.recheck ?? [], { types: ["quests"], zones: [lead("giverNpcId") ?? lead("turnInNpcId")], ids: [questId, ...rows.flatMap((r) => r.rewardItemIds.filter((id) => Number.isInteger(id) && id > 0))] });
    return (["giverNpcId", "turnInNpcId"] as const).flatMap((key) => {
      if (page[key] !== npcId) return [];
      const effective = recheckRows(rows.filter((r) => r[key] !== undefined), since, { value: (r) => r[key]! }).rows;
      return [{ questId, title: page.title, role: key === "giverNpcId" ? "Giver" : "Turn-in", reported: reported(effective.filter((r) => r[key] === npcId)) }];
    });
  });
  const vendorRows = facts.vendors.filter((r) => r.vendorNpcId === npcId && r.installId.trim());
  const goodsEvidence = (offer: VendorOffer) => {
    const since = scopeSince(facts.recheck ?? [], { types: ["vendors"], zones: [zones.get(npcId) ?? null], ids: [npcId, offer.itemId] });
    const rows = recheckRows(vendorRows.filter((r) => r.itemId === offer.itemId && Number.isInteger(r.priceCopper) && r.priceCopper >= 0), since, { value: (r) => r.priceCopper }).rows;
    return reported(rows.filter((r) => r.priceCopper === offer.priceCopper));
  };
  return { quests, goodsEvidence };
}
