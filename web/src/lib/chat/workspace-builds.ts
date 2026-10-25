import { parseBuildInput, type BuildInput, type SavedBuild } from "@/lib/saved-builds";
import { listOwn, saveBuild, type BuildRefusal } from "@/lib/saved-builds-store";

// Saved builds made or edited from a Chat project (the integration ruling at the end of
// docs/superpowers/plans/2026-10-25-chat-workspace.md). The same rows and save_build as the calculator, but a
// build made here is private, and an edit never changes whether a build is shared, shows its owner or is marked.

type Parsed = { ok: true; value: Omit<BuildInput, "shared" | "active" | "showName"> & { characterGiven: boolean } } | { ok: false; error: string };

/** `build` from a POST body. Only the build's own fields are read: a posted shared, showName or active is ignored. */
export function parseWorkspaceBuild(body: unknown): Parsed {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>).build : null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Send the build to save." };
  const b = raw as Record<string, unknown>;
  const input = parseBuildInput({ id: b.id, name: b.name, notes: b.notes, code: b.code, code2: b.code2, characterId: b.characterId });
  if (!input.ok) return input;
  const { id, name, notes, characterId, code, code2 } = input.value;
  return { ok: true, value: { id, name, notes, characterId, code, code2, characterGiven: "characterId" in b } };
}

/** save_build failed or its row could not be read back: the build may or may not have been saved. */
export class SaveUnconfirmed extends Error {
  constructor() { super("Build save unconfirmed"); this.name = "SaveUnconfirmed"; }
}

async function attempt(userId: string, input: BuildInput) {
  try { return await saveBuild(userId, input); } catch { throw new SaveUnconfirmed(); }
}

export type WorkspaceBuildSaved = { build: SavedBuild; created: boolean } | { refused: BuildRefusal };

export async function saveWorkspaceBuild(userId: string, input: Extract<Parsed, { ok: true }>["value"]): Promise<WorkspaceBuildSaved> {
  const { characterGiven, ...build } = input;
  if (!build.id) return attempt(userId, { ...build, shared: false, showName: false, active: false });
  const owned = (await listOwn(userId)).builds.find((b) => b.id === build.id);
  if (!owned) return { refused: "not_found" };
  // Null keeps the stored value, read by save_build as it writes, so a change from another device is not undone.
  return attempt(userId, { ...build, characterId: characterGiven ? build.characterId : owned.characterId, shared: null, showName: null, active: null });
}
