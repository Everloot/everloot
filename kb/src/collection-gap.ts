/**
 * Owned versus missing for one collection.
 * A list row is public after 3 installs agree on the collection, the source,
 * and the item id. Owned is what one install uploaded. Missing is the public
 * list minus that install. No Blizzard profile, no copied catalog.
 */

export const COLLECTION_AGREEMENT = 3;

export type CatalogSighting = {
  installId: string;
  collection: string;
  source: string;
  itemId: number;
};

export type OwnedSighting = {
  installId: string;
  collection: string;
  itemId: number;
};

export type CollectionFacts = {
  catalog: CatalogSighting[];
  owned: OwnedSighting[];
};

export type CollectionGroup = {
  source: string;
  owned: number[];
  missing: number[];
};

export type CollectionGap = {
  collection: string;
  ownerInstallId: string;
  groups: CollectionGroup[];
  queued: number[];
  /** False when this install never uploaded this collection: owned is unknown, not empty. */
  ownedRecorded: boolean;
};

const EMPTY_FACTS: CollectionFacts = { catalog: [], owned: [] };

function clean(value: string): string {
  return value.trim().toLowerCase();
}

function positiveId(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export function collectionGap(collection: string, ownerInstallId: string, facts: CollectionFacts): CollectionGap {
  const wanted = clean(collection);
  const owner = ownerInstallId.trim();
  const catalog = new Map<string, { source: string; itemId: number; installs: Set<string> }>();
  for (const row of facts.catalog) {
    if (!row.installId.trim() || clean(row.collection) !== wanted || !row.source.trim() || !positiveId(row.itemId)) continue;
    const key = `${clean(row.source)}|${row.itemId}`;
    const group = catalog.get(key) ?? { source: row.source.trim(), itemId: row.itemId, installs: new Set<string>() };
    group.installs.add(row.installId.trim());
    catalog.set(key, group);
  }

  const owned = new Set<number>();
  const ownedRecorded = facts.owned.some((row) => row.installId.trim() === owner && clean(row.collection) === wanted);
  for (const row of facts.owned) {
    if (row.installId.trim() !== owner || clean(row.collection) !== wanted || !positiveId(row.itemId)) continue;
    owned.add(row.itemId);
  }

  const bySource = new Map<string, CollectionGroup>();
  const listed = new Set<number>();
  for (const row of catalog.values()) {
    if (row.installs.size < COLLECTION_AGREEMENT) continue;
    listed.add(row.itemId);
    const key = clean(row.source);
    const group = bySource.get(key) ?? { source: row.source, owned: [], missing: [] };
    (owned.has(row.itemId) ? group.owned : group.missing).push(row.itemId);
    bySource.set(key, group);
  }

  const groups = [...bySource.values()]
    .map((group) => ({
      source: group.source,
      owned: [...group.owned].sort((a, b) => a - b),
      missing: [...group.missing].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.source.localeCompare(b.source));

  return {
    collection: collection.trim(),
    ownerInstallId: owner,
    groups,
    queued: [...owned].filter((itemId) => !listed.has(itemId)).sort((a, b) => a - b),
    ownedRecorded,
  };
}

/** The item ids 3 installs list for a collection, whatever the source: the set a files list is checked against. */
export function agreedCollectionItems(collection: string, facts: CollectionFacts): Set<number> {
  const wanted = clean(collection);
  const installs = new Map<number, Set<string>>();
  for (const row of facts.catalog) {
    if (!row.installId.trim() || clean(row.collection) !== wanted || !positiveId(row.itemId)) continue;
    const set = installs.get(row.itemId) ?? new Set<string>();
    set.add(row.installId.trim());
    installs.set(row.itemId, set);
  }
  return new Set([...installs].filter(([, set]) => set.size >= COLLECTION_AGREEMENT).map(([id]) => id));
}

export function formatCollectionGap(gap: CollectionGap): string {
  const lines = [
    `Collection ${gap.collection} for install ${gap.ownerInstallId}`,
    "An item joins the list when 3 installs agree on the collection, the source, and the item. Owned is what this install uploaded. Missing is the rest of that list.",
  ];
  if (gap.groups.length === 0) {
    lines.push("List unrecorded. An item joins when 3 installs agree on it and its source.");
  }
  for (const group of gap.groups) {
    lines.push(`${group.source}`);
    if (!gap.ownedRecorded) {
      lines.push(`Listed: ${[...group.owned, ...group.missing].sort((a, b) => a - b).join(", ")}`);
      lines.push("Owned: unrecorded. This install has not uploaded this collection.");
      continue;
    }
    lines.push(`Owned: ${group.owned.length ? group.owned.join(", ") : "none"}`);
    lines.push(`Missing: ${group.missing.length ? group.missing.join(", ") : "none"}`);
  }
  if (gap.queued.length > 0) {
    lines.push(`Reported by this install and still short of 3: ${gap.queued.join(", ")}`);
  }
  return lines.join("\n");
}

export function handleCollectionGap(
  args: { collection: string; ownerInstallId: string },
  facts: CollectionFacts = EMPTY_FACTS,
): string {
  if (!args.collection.trim()) return "Name a collection.";
  if (!args.ownerInstallId.trim()) return "Name the install.";
  return formatCollectionGap(collectionGap(args.collection, args.ownerInstallId, facts));
}

export function collectionFactsFromRecords(records: unknown[]): CollectionFacts {
  const catalog: CatalogSighting[] = [];
  const owned: OwnedSighting[] = [];
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.installId !== "string" || typeof row.collection !== "string" || typeof row.itemId !== "number") continue;
    if (row.kind === "collection_catalog" && typeof row.source === "string") {
      catalog.push({ installId: row.installId, collection: row.collection, source: row.source, itemId: row.itemId });
    }
    if (row.kind === "collection_owned") {
      owned.push({ installId: row.installId, collection: row.collection, itemId: row.itemId });
    }
  }
  return { catalog, owned };
}
