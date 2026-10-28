/** The reviewer-facing text of a changelog entry: the pull request body and the terminal summary. */
import type { ChangeEntry } from "./changes.js";

/** Names come from game files. Keep them from turning into links, mentions, HTML or table breaks. */
const clean = (s: string) => s.replace(/[`@<>|\r\n[\]]/g, " ").replace(/\s+/g, " ").trim();
const val = (v: unknown) => (v === null || v === undefined ? "none" : typeof v === "object" ? clean(JSON.stringify(v)) : clean(String(v)));
const unlock = (u: { spentRequired?: { amount: number; scope: string }; ranksInNodes?: { nodeId: number; ranks: number }[] }) => {
  const parts = [
    u.spentRequired ? `${u.spentRequired.amount} points spent (${u.spentRequired.scope === "unconfirmed" ? "scope unconfirmed" : `counted ${u.spentRequired.scope}-wide`})` : null,
    ...(u.ranksInNodes ?? []).map((r) => `${r.ranks} ranks in node ${r.nodeId}`),
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "no gate";
};
const prereqs = (p: { nodeId: number; rule: string }[]) => (p.length ? p.map((x) => `${x.rule} ${x.nodeId}`).join(", ") : "none");
const pos = (p: { tree: string | null; row: number; col: number }) => `${p.tree ? `${clean(p.tree)} ` : ""}row ${p.row} col ${p.col}`;


function sections(entry: ChangeEntry): { title: string; items: string[] }[] {
  const t = entry.talents;
  const label = (w: { className: string | null; tree: string | null; name: string; spoiler: boolean }) =>
    `${w.spoiler ? "[spoiler] " : ""}${clean(w.className ?? "?")}${w.tree ? ` / ${clean(w.tree)}` : ""}: ${clean(w.name)}`;
  const out: { title: string; items: string[] }[] = [];
  if (t) {
    const cls = (c: { className: string | null; classId: number; spoiler: boolean }) => `${c.spoiler ? "[spoiler] " : ""}${clean(c.className ?? `class ${c.classId}`)}`;
    out.push({ title: "Classes added", items: t.classesAdded.map(cls) });
    out.push({ title: "Classes removed", items: t.classesRemoved.map(cls) });
    out.push({ title: "Talents added", items: t.added.map((w) => `${label(w)} (${w.kind}, ${w.maxRanks} rank${w.maxRanks === 1 ? "" : "s"})`) });
    out.push({ title: "Talents removed", items: t.removed.map((w) => label(w)) });
    out.push({ title: "Talents moved", items: t.moved.map((w) => `${label(w)}: ${pos(w.from)} -> ${pos(w.to)}`) });
    out.push({ title: "Rank changes", items: t.ranks.map((w) => `${label(w)}: ${w.before} -> ${w.after} ranks`) });
    out.push({ title: "Gate changes", items: t.gates.map((w) => `${label(w)}: ${unlock(w.before)} -> ${unlock(w.after)}`) });
    out.push({ title: "Prerequisite changes", items: t.prereqs.map((w) => `${label(w)}: ${prereqs(w.before)} -> ${prereqs(w.after)}`) });
    out.push({ title: "Talent swapped for another spell", items: t.replaced.map((w) => `${label(w)}: spells ${w.before.join(", ")} -> ${w.after.join(", ")}`) });
    out.push({
      title: "Spell values",
      items: t.spellValues.map((w) => `${label(w)} (spell ${w.spellId}): ${w.changes.map((c) => `${clean(c.field)} ${val(c.before)} -> ${val(c.after)}`).join("; ")}`),
    });
    out.push({ title: "Talent points", items: t.pointLevels.map((p) => `${clean(p.className ?? `class ${p.classId}`)}: ${p.before.length} points (levels ${p.before[0] ?? "-"} to ${p.before.at(-1) ?? "-"}) -> ${p.after.length} points (levels ${p.after[0] ?? "-"} to ${p.after.at(-1) ?? "-"})`) });
  }
  const r = entry.raidBuffs;
  if (r) out.push({ title: "Raid buff spell changes", items: r.spellChanges.map((c) => `${c.spoiler ? "[spoiler] " : ""}${clean(c.label)}${c.spellId === null ? "" : `, spell ${c.spellId}`}: ${clean(c.change)}`) });
  if (r) out.push({ title: "Raid buff scope changes", items: r.scopeChanges.map((c) => `${c.spoiler ? "[spoiler] " : ""}${clean(c.label)}: ${val(c.before)} -> ${val(c.after)}${c.before === c.after ? ` (by rank: ${clean(c.beforeRanks)} -> ${clean(c.afterRanks)})` : ""}`) });
  if (entry.mapChanges) out.push({ title: "Map changes", items: entry.mapChanges.map((c) => `${c.spoiler ? "[spoiler] " : ""}${c.kind} ${clean(c.name)} (${c.id}): ${clean(c.change)}`) });
  const rs = entry.readSet;
  if (rs) {
    const items = [
      ...(rs.layoutChanged ? ["table definitions changed: every table may read as changed"] : []),
      ...rs.addedTables.map((t) => `${clean(t.table)}: new table, ${t.rows} rows`),
      ...rs.removedTables.map((t) => `${clean(t.table)}: no longer read`),
      ...rs.changedTables.map((t) => `${clean(t.table)}: ${t.rowsBefore} -> ${t.rowsAfter} rows, content changed`),
    ];
    out.push({ title: "Client data", items });
  }
  return out;
}

/** Longest list shown before "and N more"; the full list is in the JSON entry. */
const CAP = 40;

function describe(entry: ChangeEntry): string[] {
  const lines: string[] = [];
  const found = sections(entry).filter((s) => s.items.length);
  if (entry.initial) lines.push("First data for this product: nothing to compare with, so this entry records a baseline.");
  else if (!found.length) lines.push("No differences in the talents, spell numbers, raid buffs, map or client tables.");
  for (const s of found) {
    lines.push("", `### ${s.title} (${s.items.length})`, "");
    for (const item of s.items.slice(0, CAP)) lines.push(`- ${item}`);
    if (s.items.length > CAP) lines.push(`- and ${s.items.length - CAP} more in the JSON entry`);
  }
  return lines;
}

export interface BodyContext {
  /** Open pull requests for older builds of the same product, to be closed once this one is decided. */
  supersedes: number[];
  runUrl?: string;
}

export const BODY_MARKER = (product: string, buildId: number) => `<!-- everloot:build-watch product=${product} build=${buildId} -->`;

export function prBody(entry: ChangeEntry, ctx: BodyContext): string {
  const b = entry.build;
  const lines = [
    BODY_MARKER(entry.product, b.buildId),
    `Automated data update from the build watch. A maintainer reviews it; nothing here merges itself.`,
    "",
    `- Product: \`${entry.product}\`${entry.live ? "" : " (not live: beta or unreleased)"}`,
    `- Build: ${clean(b.version)} (build id ${b.buildId}, config \`${b.buildConfig.slice(0, 8)}\`)`,
    `- Compared with: ${entry.previous ? `${clean(entry.previous.version)} (the data now on the base branch)` : "nothing: first data for this product"}`,
    `- Catalog: ${entry.catalog.classes} classes, ${entry.catalog.nodes} talent nodes`,
    `- Encrypted blocks skipped, never decrypted: ${entry.encryptedBlocks.total}${entry.encryptedBlocks.tables.length ? ` (${entry.encryptedBlocks.tables.map((t) => `${t.table} ${t.blocks}`).join(", ")})` : ""}`,
  ];
  if (entry.raidBuffs) {
    lines.push(`- Raid buffs compared with: ${entry.raidBuffs.comparedTo ? clean(entry.raidBuffs.comparedTo) : "no earlier raid file, so no comparison"} (the committed raid file)`);
  }
  if (entry.readSet) {
    const rs = entry.readSet;
    lines.push(`- Client tables: ${rs.tables.after} read (${rs.tables.before} before), ${rs.rows.after} rows (${rs.rows.before} before), ${rs.addedTables.length + rs.removedTables.length + rs.changedTables.length} changed`);
  }
  if (entry.spoiler) {
    lines.push("", "**Spoiler.** This build is not live, so everything below is marked `spoiler` in the changelog entry and stays hidden on the site unless the reader turns spoilers on. Labelled *found in game files, unconfirmed*.");
  }
  if (entry.warnings.length) lines.push("", "**Warnings**", "", ...entry.warnings.map((w) => `- ${clean(w)}`));
  lines.push("", ...describe(entry));
  lines.push(
    "",
    "### Review",
    "",
    "- [ ] The changes above look like the game, not a parsing problem (check any mass removal or warning).",
    "- [ ] Only the files the site reads changed (`web/src/data/game-data/`: talents, raid file, map, spell values, client digests, one changelog entry; `addon/modules/raid_data.lua`; the import line in `raid.ts`; `kb/curated/recheck.json` when a zone or entrance moved).",
    "- [ ] For a changed `QuestV2` or `UiMap`, run `npm run kb -- client-diff` between the two local snapshots and `npm run kb -- recheck-scopes` on its output, so the rows it changed are rechecked.",
    "- [ ] `client-digests.json` is the next build's baseline; it is written, not edited by hand.",
    "- [ ] The web tests still pass: some hard-code the build number in sample raid codes.",
    "- [ ] Spoiler flags are right for a build players cannot play yet.",
    "- [ ] Before merging: this build's asset folder and name files are uploaded and the site's asset URL setting points at it. The site reads item, quest, set and spell names only for the client layer's build, so merging first leaves production without names (see `docs/BUILD_WATCH.md`).",
    "",
    "Hotfixes that change no build never show up here, because the game files do not change. The blue tracker covers those.",
    "",
    "Game data is Blizzard's and is not under Everloot's licence (see `web/src/data/game-data/README.md` and `docs/DATA_POLICY.md`).",
  );
  if (ctx.supersedes.length) lines.push("", `Older build PRs still open for this product: ${ctx.supersedes.map((n) => `#${n}`).join(", ")}. Close them once this one is decided.`);
  if (ctx.runUrl) lines.push("", `Run: ${ctx.runUrl}`);
  const body = lines.join("\n");
  return body.length > 60_000 ? `${body.slice(0, 60_000)}\n\n(truncated; the JSON entry has the rest)` : body;
}

/** Plain text for the terminal and the dry run. */
export function terminalSummary(entry: ChangeEntry): string {
  const b = entry.build;
  const head = [
    `${entry.product} ${b.version} (build ${b.buildId})${entry.live ? "" : " [not live: everything is spoiler]"}`,
    entry.previous ? `compared with ${entry.previous.version}` : "first data for this product (baseline)",
    `encrypted blocks skipped: ${entry.encryptedBlocks.total}`,
  ];
  const counts = sections(entry).map((s) => `${s.title}: ${s.items.length}`);
  return [...head, ...counts, ...entry.warnings.map((w) => `warning: ${w}`)].join("\n");
}
