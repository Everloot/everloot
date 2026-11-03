import { DataTable, SectionHeading, type Column } from "@/components/ui";
import type { LegacyPerkCatalog, Node, Tree } from "../../../kb/src/legacy-perks/catalog";

/**
 * The Legacy perk catalog as the game files hold it, read-only (docs/LEGACY_PERKS.md). Ids, ranks and prerequisites
 * are stored values. The cost, the cap and where a spend gate counts are readings of column names: they are shown as
 * such, an unknown one shows no number, and nothing on this page spends or enforces them.
 */
export default function LegacyPerks({ catalog }: { catalog: LegacyPerkCatalog }) {
  // The columns of every tree share the same PosX values; number them left to right.
  const xs = [...new Set(catalog.trees.flatMap((t) => t.nodes.map((n) => n.x)).filter((x): x is number => x !== null))].sort((a, b) => a - b);
  const column = (n: Node) => (n.x === null ? null : xs.indexOf(n.x) + 1);
  const cap = (id: number | null) => catalog.currencies.find((c) => c.id === id)?.cap;

  return (
    <div className="space-y-12">
      <p className="text-sm text-muted">
        {`Found in game files, unconfirmed. Build ${catalog.build.version}, trait system ${catalog.traitSystemId}. `}
        {catalog.credit}
      </p>

      {catalog.trees.map((tree) => {
        const id = `tree-${tree.id}`;
        const c = cap(tree.currencyId);
        return (
          <section key={tree.id} aria-labelledby={id}>
            <SectionHeading
              id={id}
              note={<>
                {`The game files give this tree no name. ${tree.nodes.length} perks. `}
                {`Cost per rank: ${tree.cost.value === null ? "not known" : `${tree.cost.value}, an unconfirmed reading of ${tree.cost.from}`}. `}
                {`Most points a character holds: ${!c || c.value === null ? "not known" : `${c.value}, an unconfirmed reading of ${c.from}`}.`}
              </>}
            >
              {`Legacy tree ${tree.id}`}
            </SectionHeading>
            <DataTable caption={`Perks of Legacy tree ${tree.id}`} columns={perkColumns(tree, column)} rows={sortNodes(tree.nodes, column)} rowKey={(n) => String(n.id)} />
          </section>
        );
      })}

      <section aria-labelledby="legacy-open">
        <SectionHeading id="legacy-open">What the files leave open</SectionHeading>
        <ul className="list-disc space-y-2 pl-5 text-sm text-fg-2">
          <li>Spend gates are partial: the points a gate asks for are stored, but where those points are counted is read from a column name and is unconfirmed.</li>
          <li>The cost per rank and the most points a character holds are readings of column names. Nothing here spends points.</li>
          <li>How points are earned, and whether they belong to the account or the character, is not in the tables read.</li>
          {catalog.emptyTreeIds.length > 0 && <li>{`Trait system ${catalog.traitSystemId} also holds ${catalog.emptyTreeIds.length === 1 ? "tree" : "trees"} ${catalog.emptyTreeIds.join(", ")}, with no perks.`}</li>}
          {catalog.warnings.map((w) => <li key={w}>{w}</li>)}
          {catalog.withdrawn.map((w) => (
            <li key={`${w.kind}-${w.id}`}>{`Withdrawn ${w.kind} ${w.id}${w.name ? ` (${w.name})` : ""}: last in build ${w.lastSeen}, gone in ${w.withdrawnIn}.`}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const sortNodes = (nodes: Node[], column: (n: Node) => number | null) =>
  [...nodes].sort((a, b) => (column(a) ?? Infinity) - (column(b) ?? Infinity) || (a.y ?? Infinity) - (b.y ?? Infinity) || a.id - b.id);

const nodeName = (n: Node) => n.entries[0]?.name ?? "No name in the files";

function perkColumns(tree: Tree, column: (n: Node) => number | null): Column<Node>[] {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const gatesOn = (n: Node) => tree.gates.filter((g) => g.guards.includes(n.id));
  return [
    { key: "perk", header: "Perk", cell: (n) => <>{nodeName(n)}{n.kind === "tiered" && <span className="text-muted">{` (${n.entries.length} tiers)`}</span>}</> },
    { key: "node", header: "Node id", numeric: true, cell: (n) => n.id },
    { key: "entries", header: "Entry ids", numeric: true, cell: (n) => n.entries.map((e) => e.id).join(", ") },
    { key: "ranks", header: "Ranks", numeric: true, cell: (n) => n.ranks.value ?? "Not known" },
    { key: "column", header: "Column", numeric: true, cell: (n) => column(n) ?? "Not known" },
    {
      key: "requires",
      header: "Requires",
      cell: (n) => n.prereqs.length
        ? n.prereqs.map((p) => `${byId.get(p.nodeId) ? nodeName(byId.get(p.nodeId)!) : `node ${p.nodeId}`}${p.rule === null ? " (rule not known)" : ""}`).join(n.prereqs.every((p) => p.rule === "all") ? " and " : " or ")
        : "—",
    },
    {
      key: "gate",
      header: "Spend gate",
      cell: (n) => gatesOn(n).map((g) => `${g.amount} points spent (${g.confidence === "unknown" ? "where they count is not known" : "where they count is unconfirmed"})`).join("; ") || "—",
    },
  ];
}
