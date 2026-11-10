import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import EvidenceLine from "./EvidenceLine";
import Badge from "./Badge";
import type { Edge } from "../../../../kb/src/edges";

const file: Edge = {
  fromKind: "item", fromId: 1, rel: "dropped_by", toKind: "npc", toId: 2,
  evidence: "client", build: "1.60.1.80001", installs: null, firstSeen: null, lastSeen: null,
};

test("file evidence and its badge link to changes for the read build", () => {
  const html = renderToStaticMarkup(<EvidenceLine rows={[file]} now={0} />);
  expect(html).toContain('href="/changes?show=builds&amp;q=1.60.1.80001"');
  expect(html).toContain("found in game files, build 1.60.1.80001");
  const badge = renderToStaticMarkup(<Badge tone="files" href="/changes?show=builds&q=1.60.1.80001" />);
  expect(badge).toContain('href="/changes?show=builds&amp;q=1.60.1.80001"');
});

test("player evidence keeps its agreement count and empty rows stay silent", () => {
  const observed: Edge = { ...file, evidence: "observed", build: null, installs: 3 };
  const html = renderToStaticMarkup(<EvidenceLine rows={[file, observed]} now={0} />);
  expect(html).toContain("3 of 3 installs agree");
  expect(html).not.toContain("<a");
  expect(renderToStaticMarkup(<EvidenceLine rows={[]} now={0} />)).toBe("");
});
