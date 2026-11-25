import { cache } from "react";
import { agreedCollectionItems, collectionFactsFromRecords } from "@kb/collection-gap";
import type { ClientCurrency, ClientPet, ClientToy } from "@kb/client-collections";
import { CLIENT_COLLECTIONS } from "@/data/game-data/client-collections";
import { CLIENT_MOUNTS } from "@/data/game-data/client-mounts";
import { idSegment } from "./completion-lists";
import { uploadStore } from "./upload-store";

// The mounts, companion pets, currencies and toys the database lists. Each comes from the game files, labelled found
// in game files, unconfirmed. Mounts are the one kind players confirm today: 3 installs listing the mount's spell in
// their "Mounts" collection, as the collections tool reads it. No owned progress is read.

export interface MountEntry { id: number; name: string; spellId: number; ridingSkill?: number }

export const mountHref = (id: number, name: string) => `/database/mounts/${idSegment(id, name)}`;
export const petHref = (id: number, name: string) => `/database/pets/${idSegment(id, name)}`;
export const currencyHref = (id: number, name: string) => `/database/currencies/${idSegment(id, name)}`;

/** A game-file list, or none when its file could not be read. */
function read<T>(rows: () => T[]): T[] | null {
  try { return rows(); } catch { return null; }
}

/** Every mount the files list, in id order; null when the file could not be read. */
export const mountEntries = (): MountEntry[] | null =>
  read(() => Object.entries(CLIENT_MOUNTS.mounts).map(([id, m]) => ({ id: Number(id), ...m })).sort((a, b) => a.id - b.id));
export const petEntries = (): ClientPet[] | null => read(() => CLIENT_COLLECTIONS.pets);
export const currencyEntries = (): ClientCurrency[] | null => read(() => CLIENT_COLLECTIONS.currencies);
export const toyEntries = (): ClientToy[] | null => read(() => CLIENT_COLLECTIONS.toys);

/** The build the collections file came from, for a page's source line. */
export const collectionsBuild = (): string | null => read(() => [CLIENT_COLLECTIONS.build.version])?.[0] ?? null;
export const mountsBuild = (): string | null => read(() => [CLIENT_MOUNTS.build.version])?.[0] ?? null;

/**
 * The mount spells 3 installs list in their "Mounts" collection; null when storage could not be read (unrecorded,
 * not unconfirmed). Read once per request: a page and its metadata share it.
 */
export const loadAgreedMounts = cache(async (): Promise<Set<number> | null> => {
  const corpus = await uploadStore.loadCorpus();
  return corpus.unreachable ? null : agreedCollectionItems("Mounts", collectionFactsFromRecords(corpus.records));
});
