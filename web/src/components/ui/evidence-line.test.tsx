import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import EvidenceLine from "./EvidenceLine";
import Badge from "./Badge";
import type { Edge } from "@kb/edges";

const file: Edge = {
  fromKind: "item", fromId: 1, rel: "dropped_by", toKind: "npc", toId: 2,
  evidence: "client", build: "1.60.1.80001", installs: null, firstSeen: null, lastSeen: null,
};

test("file evidence prints no line; its badge links to the read build when given one", () => {
  expect(renderToStaticMarkup(<EvidenceLine rows={[file]} now={0} />)).toBe("");
  const badge = renderToStaticMarkup(<Badge tone="files" href="/changes?show=builds&q=1.60.1.80001" />);
  expect(badge).toContain('href="/changes?show=builds&amp;q=1.60.1.80001"');
  expect(badge).toContain("min-h-6 min-w-6");
  expect(renderToStaticMarkup(<Badge tone="files" />)).not.toContain("<a");
});

test("player evidence keeps its agreement count and empty rows stay silent", () => {
  const observed: Edge = { ...file, evidence: "observed", build: null, installs: 3 };
  const html = renderToStaticMarkup(<EvidenceLine rows={[file, observed]} now={0} />);
  expect(html).toContain("3 installs agree on each row");
  expect(html).not.toContain("<a");
  expect(renderToStaticMarkup(<EvidenceLine rows={[]} now={0} />)).toBe("");
});

// QA round 12: item 11284's Sold by tab said "3 of 3 installs agree" over two rows each saying "4 installs". The line
// above a table now gives the rows' own count (installs agreeing on each row's fact), never a figure capped at 3.
test("the line above a table gives the rows' own install count, the same number the rows show", () => {
  const sold = (toId: number, installs: number, lastSeen: string): Edge => ({
    ...file, rel: "sold_by", toId, evidence: "observed", build: null, installs, firstSeen: lastSeen, lastSeen,
  });
  const now = Date.parse("2026-11-27T12:00:00.000Z");
  const same = renderToStaticMarkup(<EvidenceLine rows={[sold(2, 4, "2026-11-25T18:00:00.000Z"), sold(3, 4, "2026-11-24T18:00:00.000Z")]} now={now} />);
  expect(same).toContain("4 installs agree on each row · last seen 42 h ago");
  expect(same).not.toContain("3 of 3");
  const mixed = renderToStaticMarkup(<EvidenceLine rows={[sold(2, 3, "2026-11-25T18:00:00.000Z"), sold(3, 5, "2026-11-20T18:00:00.000Z")]} now={now} />);
  expect(mixed).toContain("At least 3 installs agree on each row · last seen 42 h ago");
});
