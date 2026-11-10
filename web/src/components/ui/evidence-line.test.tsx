import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import EvidenceLine from "./EvidenceLine";
import Badge from "./Badge";
import type { Edge } from "../../../../kb/src/edges";

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
  expect(html).toContain("3 of 3 installs agree");
  expect(html).not.toContain("<a");
  expect(renderToStaticMarkup(<EvidenceLine rows={[]} now={0} />)).toBe("");
});
