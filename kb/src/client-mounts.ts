/**
 * The client mounts: every mount the game files list (`Mount`), with the spell that grants it and the riding
 * skill its mount type asks for (`MountType` → `MountTypeXCapability` → `MountCapability.ReqRidingSkill`, the
 * lowest among the type's capabilities). Blizzard's data, labelled "found in game files, unconfirmed", pages
 * only: the collections tool shows it beside what players report, player-first, and the API, MCP and bulk
 * exports stay clean (docs/DATA_POLICY.md). The build watch regenerates it with every new build.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { CLIENT_LABEL } from "./edges.js";

export const MOUNTS_SCHEMA = "everloot.client-mounts/1";

const ClientMount = z.object({
  name: z.string(),
  /** The spell that teaches the mount, the id a client's mount journal reports. */
  spellId: z.number().int(),
  /** The riding skill the mount type asks for; absent when the files ask for none. */
  ridingSkill: z.number().int().optional(),
});

export const ClientMounts = z.object({
  schema: z.literal(MOUNTS_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  /** Every mount keyed by its id, in id order in the file. */
  mounts: z.record(z.string(), ClientMount),
  note: z.literal("names and spell ids are the game files'; who owns what comes from player uploads"),
});
export type ClientMounts = z.infer<typeof ClientMounts>;
export type ClientMount = z.infer<typeof ClientMount>;

/** One mount per line, so a new build's file reads as a line diff in review. */
export function serializeClientMounts(table: ClientMounts): string {
  const { mounts, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  const ids = Object.keys(mounts).sort((a, b) => Number(a) - Number(b));
  const rows = ids.map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(mounts[id])}`);
  return `${top},\n "mounts": {\n${rows.join(",\n")}\n }\n}\n`;
}

/** The lowest riding skill among a mount type's capabilities, by type id; 0 when the files ask for none. */
export function ridingSkillByType(get: (table: string) => Map<number, Record<string, unknown>> | undefined): Map<number, number> {
  const capabilities = get("MountCapability");
  const links = get("MountTypeXCapability");
  const out = new Map<number, number>();
  if (!capabilities || !links) return out;
  for (const link of links.values()) {
    const cap = capabilities.get(Number(link.MountCapabilityID));
    if (!cap) continue;
    const typeId = Number(link.MountTypeID);
    const skill = Number(cap.ReqRidingSkill ?? 0);
    const seen = out.get(typeId);
    out.set(typeId, seen === undefined ? skill : Math.min(seen, skill));
  }
  return out;
}

export function buildClientMounts(snapshotPath: string): ClientMounts {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const get = (t: string) => (present.has(t) ? readClientRows(snapshotPath, t) : undefined);
  const skills = ridingSkillByType(get);
  const mounts: Record<string, ClientMount> = {};
  const rows = get("Mount");
  if (rows) {
    for (const [id, row] of [...rows].sort(([a], [b]) => a - b)) {
      const name = typeof row.Name_lang === "string" ? row.Name_lang.trim() : "";
      if (!name) continue;
      const ridingSkill = skills.get(Number(row.MountTypeID)) ?? 0;
      mounts[id] = ClientMount.parse({ name, spellId: Number(row.SourceSpellID ?? 0), ...(ridingSkill > 0 ? { ridingSkill } : {}) });
    }
  }
  return ClientMounts.parse({
    schema: MOUNTS_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    mounts,
    note: "names and spell ids are the game files'; who owns what comes from player uploads",
  });
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-mounts.json). */
export function writeClientMounts(snapshotPath: string, path: string): ClientMounts {
  const table = buildClientMounts(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientMounts(table));
  return table;
}
