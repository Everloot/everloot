import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("@/components/ApiKeys", () => ({ default: () => null }));

import { KEY_SCOPES } from "@/lib/api-key-policy";
import KeysPage from "./page";

afterEach(() => { vi.unstubAllEnvs(); });

const decode = (html: string) => html.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

/** The scopes table's body rows, as HTML, with keys on. */
function scopeRows(): string[] {
  vi.stubEnv("EVERLOOT_DATA_GUARD", "1");
  const html = renderToStaticMarkup(<KeysPage />);
  const start = html.indexOf('id="scopes"');
  expect(start).toBeGreaterThan(-1);
  const section = html.slice(start, html.indexOf("<h2", start + 1));
  const body = section.slice(section.indexOf("<tbody>"), section.indexOf("</tbody>"));
  return body.split("<tr ").slice(1);
}

test("the scopes table has one row per scope in KEY_SCOPES: its id, label, note, and which key carries it", () => {
  const rows = scopeRows();
  expect(rows).toHaveLength(KEY_SCOPES.length);
  KEY_SCOPES.forEach((scope, i) => {
    const row = decode(rows[i]);
    expect(row).toContain(`>${scope.id}</code>`);
    expect(row).toContain(scope.label);
    expect(row).toContain(scope.note);
    if (scope.always) expect(row).toContain("(on every key)");
    else expect(row).not.toContain("(on every key)");
  });
  expect(KEY_SCOPES.filter((s) => s.always).map((s) => s.id)).toEqual(["read:public"]);
});

test("each opt-in scope's row names a route under /api/me, and that route's code checks the scope", () => {
  const rows = scopeRows();
  KEY_SCOPES.forEach((scope, i) => {
    if (scope.always) return;
    const path = decode(rows[i]).match(/\/api\/me\/[\w/-]+/)?.[0];
    expect(path, scope.id).toBeDefined();
    const route = readFileSync(new URL(`../../../api/me/${path!.slice("/api/me/".length)}/route.ts`, import.meta.url), "utf8");
    expect(route, `${path} checks ${scope.id}`).toContain(scope.id);
  });
});

test("with keys off the page lists no scopes", () => {
  expect(renderToStaticMarkup(<KeysPage />)).not.toContain('id="scopes"');
});
