/**
 * The current build, measured against every table WoWDBDefs knows: which exist in the build's root
 * listing, which the knowledge base already reads (CLIENT_TABLES) and which site domain each
 * remaining candidate belongs to. Key-material tables are counted but never candidates.
 * Reads the manifest and the root listing only: no file content, no keys. The report feeds the
 * coverage backlog in docs/2026-10-18-database-taxonomy-research.md.
 */
import { readFileSync } from "node:fs";
import { DEFS_RAW, type FileStatus } from "./client-extract.js";
import { CLIENT_TABLES } from "./client-snapshot.js";

export interface ManifestEntry {
  tableName: string;
  db2FileDataID?: number;
  dbcFileDataID?: number;
}

export function parseManifest(text: string): ManifestEntry[] {
  const raw = JSON.parse(text) as unknown;
  if (!Array.isArray(raw)) throw new Error("the WoWDBDefs manifest is not an array");
  return raw.map((item) => {
    const t = item as Record<string, unknown>;
    if (typeof t.tableName !== "string" || t.tableName === "") throw new Error("a WoWDBDefs manifest entry has no tableName");
    const entry: ManifestEntry = { tableName: t.tableName };
    if (typeof t.db2FileDataID === "number") entry.db2FileDataID = t.db2FileDataID;
    if (typeof t.dbcFileDataID === "number") entry.dbcFileDataID = t.dbcFileDataID;
    return entry;
  });
}

/** The manifest from a local path or URL; the default URL goes through the pinned WoWDBDefs fetch. */
export async function loadManifest(
  manifest: string | undefined,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ entries: ManifestEntry[]; source: string }> {
  if (manifest && !/^https?:/i.test(manifest)) {
    return { entries: parseManifest(readFileSync(manifest, "utf8")), source: manifest };
  }
  const source = manifest ?? `${DEFS_RAW}manifest.json`;
  const res = await fetchImpl(source);
  if (!res.ok) throw new Error(`the manifest at ${source} answered ${res.status}`);
  return { entries: parseManifest(await res.text()), source };
}

export type Domain =
  | "items" | "spells" | "talents" | "characters" | "creatures" | "models" | "objects" | "quests"
  | "world" | "lore" | "factions" | "collections" | "professions" | "achievements" | "currencies"
  | "holidays" | "pvp" | "group content" | "travel" | "interface" | "audio" | "other";

export const DOMAINS: Domain[] = [
  "items", "spells", "talents", "characters", "creatures", "models", "objects", "quests", "world",
  "lore", "factions", "collections", "professions", "achievements", "currencies", "holidays", "pvp",
  "group content", "travel", "interface", "audio", "other",
];

/** Ordered: the first match wins, so a specific prefix (ZoneMusic) beats a broad one (Zone). */
const DOMAIN_RULES: [Domain, RegExp][] = [
  ["audio", /^(Sound|Music|Audio|ZoneMusic)/],
  ["talents", /^(Trait|Talent|NumTalentsAtLevel|SpecSetMember|SpecializationSpells|MinorTalent)/],
  ["models", /^(CreatureModel|CreatureDisplay|CreatureAnim|Anim|Model|M2|Bone|Helmet|Camera|Liquid)/],
  ["items", /^(Item|Transmog)/],
  ["spells", /^Spell/],
  ["creatures", /^Creature/],
  ["objects", /^GameObject/],
  ["quests", /^Quest/],
  ["lore", /^(Lore|ZoneStory)/],
  ["world", /^(Map|UiMap|Area|WorldMap|WMOArea|Zone|Phase)/],
  ["factions", /^(Faction|Reputation)/],
  ["collections", /^(Toy|BattlePet|Companion|Mount|Heirloom|Pet)/],
  ["professions", /^(SkillLine|Crafting|Recipe|TradeSkill|Profession)/],
  ["achievements", /^(Achievement|Criteria|ModifierTree)/],
  ["currencies", /^Currency/],
  ["holidays", /^Holiday/],
  ["pvp", /^(PvP|Arena|Battleground|Brawl|Rated)/],
  ["group content", /^(LFG|Dungeon|Journal|Encounter|Instance|ChallengeMode|Keystone|Scenario|Difficulty)/],
  ["travel", /^(Taxi|FlightPath)/],
  ["characters", /^(Chr|CharTitles|Character|PowerType|PowerDisplay)/],
  ["interface", /^(Ui|Chat|Font)/],
  ["other", /./],
];

export function classifyDomain(table: string): Domain {
  for (const [domain, re] of DOMAIN_RULES) if (re.test(table)) return domain;
  return "other";
}

export interface ScanBuild { product: string; version: string; buildId: number; buildConfig: string }
export interface ScanCandidate { table: string; fileDataID: number; via: "db2" | "dbc"; domain: Domain }
export interface ScanNote { table: string; note: string }
export interface ScanNeverListed { table: string; reason: string }
export interface DomainSummary { domain: Domain; present: number; read: number; unread: number }

/** Tables that hold CASC encryption key material: counted and named, never candidates, never read. */
export const KEY_TABLES: ReadonlySet<string> = new Set(["TactKey", "TactKeyLookup"]);

/**
 * Tables present in the build but decided never to read: retail-only systems the Forever realm does
 * not run (first triage pass of the "other" bucket, 2026-10-18) and client plumbing that is not game
 * data. Counted and named in the report, never candidates. The check runs only for tables the
 * knowledge base does not read, so a table that ever enters CLIENT_TABLES flows through the read
 * path first and can never be shadowed by this list.
 */
export const NEVER_TABLE_RULES: [string, RegExp][] = [
  [
    "retail-only system, not live in Forever",
    /^(Garr|Artifact|Azerite|Soulbind|MawPower|Runeforge|CorruptionEffects|Covenant|Perks|Warband|House|Decor|Room|ExteriorComponent|AvailableSuperDistrict|SuperDistrict|Neighborhood|RetroactiveDecor|DataTagXHouseDecor|MythicPlus|Delves|AssistedCombat|FlightCapability|GlideEvent|DriveCapability|WeeklyRewardChest|Commentator|PVPScoreboard|AdventureJournal|Bounty|Initiative|PvpTalent|PvpBrawl|PvpSeason|PrestigeLevelInfo|PvpTier|PvpRating|PvpScalingEffect|Relic)/,
  ],
  [
    "client plumbing, not game data",
    /^(GlobalStrings|Cfg_|Locale|Hotfixes|StartupFiles|SharedString|SpamMessages|ServerMessages|BannedAddons|GameClockDebug)/,
  ],
];

export function neverReason(table: string): string | null {
  for (const [reason, re] of NEVER_TABLE_RULES) if (re.test(table)) return reason;
  return null;
}

export interface ScanReport {
  build: ScanBuild;
  definitions: string | null;
  manifest: string;
  scannedAt: string;
  totals: {
    known: number; present: number; absent: number; encrypted: number; noFileDataID: number;
    read: number; readPresent: number; excluded: number; neverListed: number;
  };
  domains: DomainSummary[];
  candidates: ScanCandidate[];
  neverList: ScanNeverListed[];
  notes: ScanNote[];
}

export function scanBuild(
  meta: { build: ScanBuild; definitions: string | null; manifest: string },
  entries: ManifestEntry[],
  statusOf: (fileDataID: number) => FileStatus,
  read: Record<string, number> = CLIENT_TABLES,
): ScanReport {
  const totals = { known: entries.length, present: 0, absent: 0, encrypted: 0, noFileDataID: 0, read: Object.keys(read).length, readPresent: 0, excluded: 0, neverListed: 0 };
  const candidates: ScanCandidate[] = [];
  const neverList: ScanNeverListed[] = [];
  const notes: ScanNote[] = [];
  const byName = new Map(entries.map((e) => [e.tableName, e]));
  const perDomain = new Map<Domain, DomainSummary>();
  const domainOf = (name: string): DomainSummary => {
    const d = classifyDomain(name);
    let s = perDomain.get(d);
    if (!s) {
      s = { domain: d, present: 0, read: 0, unread: 0 };
      perDomain.set(d, s);
    }
    return s;
  };

  for (const entry of entries) {
    const id = entry.db2FileDataID ?? entry.dbcFileDataID;
    if (!id) {
      totals.noFileDataID++;
      continue;
    }
    const status = statusOf(id);
    if (status === "absent") {
      totals.absent++;
      continue;
    }
    if (status === "encrypted") {
      totals.encrypted++;
      continue;
    }
    if (KEY_TABLES.has(entry.tableName)) {
      totals.excluded++;
      continue;
    }
    totals.present++;
    const domain = domainOf(entry.tableName);
    domain.present++;
    if (entry.tableName in read) continue;
    const reason = neverReason(entry.tableName);
    if (reason) {
      totals.neverListed++;
      neverList.push({ table: entry.tableName, reason });
      continue;
    }
    domain.unread++;
    candidates.push({ table: entry.tableName, fileDataID: id, via: entry.db2FileDataID ? "db2" : "dbc", domain: classifyDomain(entry.tableName) });
  }

  for (const [table, fileDataID] of Object.entries(read)) {
    const entry = byName.get(table);
    if (!entry) {
      notes.push({ table, note: "not in the WoWDBDefs manifest" });
      continue;
    }
    const id = entry.db2FileDataID ?? entry.dbcFileDataID;
    if (!id) {
      notes.push({ table, note: "the manifest lists no file data id" });
      continue;
    }
    if (id !== fileDataID) notes.push({ table, note: `read from file data id ${fileDataID}; the manifest lists ${id}` });
    const status = statusOf(id);
    if (status === "present") {
      totals.readPresent++;
      domainOf(table).read++;
    } else {
      notes.push({ table, note: status === "encrypted" ? "the build's file is encrypted" : "not in the build" });
    }
  }

  candidates.sort((a, b) => DOMAINS.indexOf(a.domain) - DOMAINS.indexOf(b.domain) || a.table.localeCompare(b.table));
  const domains = [...perDomain.values()]
    .filter((d) => d.present > 0)
    .sort((a, b) => DOMAINS.indexOf(a.domain) - DOMAINS.indexOf(b.domain));

  return { ...meta, scannedAt: new Date().toISOString(), totals, domains, candidates, neverList, notes };
}

export function formatScanReport(report: ScanReport): string {
  const b = report.build;
  const t = report.totals;
  const lines = [
    `# Client table scan — ${b.product} ${b.version} (build ${b.buildId}, config ${b.buildConfig.slice(0, 8)})`,
    "",
    `WoWDBDefs manifest: ${report.definitions ?? "unknown"} (${report.manifest}), scanned ${report.scannedAt}.`,
    "Root-listing lookup only: no file content was read and no keys were loaded.",
    "",
    "| | tables |",
    "|---|---|",
    `| known to WoWDBDefs | ${t.known} |`,
    `| in this build | ${t.present} |`,
    `| encrypted (counted, not read) | ${t.encrypted} |`,
    `| excluded (key material, never read) | ${t.excluded} |`,
    `| never-list (decided never, not candidates) | ${t.neverListed} |`,
    `| not in this build | ${t.absent} |`,
    `| no file data id in the manifest | ${t.noFileDataID} |`,
    `| read by the knowledge base today | ${t.read} (${t.readPresent} in this build) |`,
    `| candidates not read yet | ${report.candidates.length} |`,
    "",
  ];
  if (report.notes.length) {
    lines.push("## Notes on tables the knowledge base reads", "");
    for (const n of report.notes) lines.push(`- ${n.table}: ${n.note}`);
    lines.push("");
  }
  if (report.neverList.length) {
    lines.push("## Never list (decided never, not candidates)", "");
    lines.push("| Table | Reason |", "|---|---|");
    for (const n of report.neverList) lines.push(`| ${n.table} | ${n.reason} |`);
    lines.push("");
  }
  lines.push("## Candidates by domain", "");
  for (const d of report.domains) {
    lines.push(`### ${d.domain} — ${d.present} present, ${d.read} read, ${d.unread} unread`, "");
    const rows = report.candidates.filter((c) => c.domain === d.domain);
    if (!rows.length) {
      lines.push("(all read)", "");
      continue;
    }
    lines.push("| Table | File data id | Via |", "|---|---|---|");
    for (const c of rows) lines.push(`| ${c.table} | ${c.fileDataID} | ${c.via} |`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
