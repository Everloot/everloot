import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { ALL_RECORD_KINDS, PUBLIC_RECORD_KINDS, RULES } from "@everloot/protocol";

// One page per record kind, read from the same schemas the schema files are written from.

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, usePathname: () => "/" }));

import Page, { generateStaticParams } from "./page";
import { recordFields } from "@/lib/docs/records";

const render = async (kind: string) => renderToStaticMarkup((await Page({ params: Promise.resolve({ kind }) })) as ReactNode);
const decode = (html: string) => html.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

test("the loot page lists every field of schema/records/loot.json with its description, nested items included", async () => {
  const file = JSON.parse(readFileSync(new URL("../../../../../../../packages/protocol/schema/records/loot.json", import.meta.url), "utf8")) as {
    properties: Record<string, { description?: string; properties?: Record<string, unknown> }>; required: string[];
  };
  const html = decode(await render("loot"));
  for (const [name, node] of Object.entries(file.properties)) {
    expect(html, name).toContain(`>${name}</code>`);
    if (node.description) expect(html, name).toContain(node.description.replaceAll("`", "").split(" (")[0]!);
  }
  // Fields inside the items array are rows of their own, named by their path.
  for (const field of ["items[].itemId", "items[].count"]) expect(html).toContain(`>${field}</code>`);
  const fields = recordFields("loot");
  expect(fields.filter((f) => f.required && !f.name.includes("[]")).map((f) => f.name)).toEqual(file.required);
  // Inside a required array, an item's required fields are required too; an optional object's never are.
  expect(fields.find((f) => f.name === "items[].itemId")!.required).toBe(true);
  expect(fields.find((f) => f.name === "items")!.type).toBe("array of objects, up to 50");
  expect(fields.find((f) => f.name === "lootType")!.type).toBe("one of: kill, pickpocket, skinning, gather, disenchant, container, fishing");
  expect(fields.find((f) => f.name === "copper")!.type).toBe("integer, 1 to 10000000000");
  // The cross-field rules the server checks are on the page, and the schema file and the public flag are linked.
  for (const rule of RULES.loot) expect(html).toContain(`${rule}.`);
  expect(html).toContain('href="/schema/records/loot.json"');
  expect(html).toContain("In the public corpus.");
});

test("a private kind says so, and a kind with no cross-field rules has no server-checks section", async () => {
  const html = decode(await render("census_self"));
  expect(PUBLIC_RECORD_KINDS).not.toContain("census_self");
  expect(html).toContain("Not in the public corpus.");
  expect(html).toContain("Published only as counts");
  expect(html).not.toContain("What the server also checks");
});

test("every kind the protocol declares has a page, and its fields come from its own schema", async () => {
  expect(generateStaticParams()).toEqual(ALL_RECORD_KINDS.map((kind) => ({ kind })));
  for (const kind of ALL_RECORD_KINDS) {
    const html = decode(await render(kind));
    expect(html, kind).toContain(`>${kind}</span>`);
    expect(html, kind).toContain('>kind</code><span class="rounded-[4px] bg-panel px-1.5 font-mono text-xs text-fg-2">exactly ' + kind);
    expect(recordFields(kind).length, kind).toBeGreaterThan(3);
  }
});

test("an unknown kind answers 404", async () => {
  await expect(render("nope")).rejects.toThrow("NOT_FOUND");
  await expect(render("Loot")).rejects.toThrow("NOT_FOUND");
});
