import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { REPO_URL } from "@/lib/source";
import { TOOL_GROUPS } from "@/data/tools";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("/terms covers uploads, keys, trademarks, takedown, warranty and governing law, each under a linkable heading", async () => {
  const { default: Terms } = await import("./terms/page");
  const html = renderToStaticMarkup(<Terms />);
  for (const id of ["uploads", "accounts", "api", "licences", "trademarks", "takedown", "warranty", "law", "changes"]) {
    expect(html, id).toContain(`id="${id}"`);
  }
  const text = visible(html);
  expect(text).toContain("CC BY-SA 4.0");
  expect(text).toContain("Arizona");
  expect(text).toContain("run by R21 Media Group, LLC");
  expect(text).toContain("hello@everloot.app");
  expect(text).toContain("Not affiliated with or endorsed by Blizzard Entertainment.");
  expect(text).toContain("Last updated");
  expect(html).not.toMatch(/TODO|TBD|\[date\]/i);
});

test("/terms states the retention and limit numbers the code enforces, not other ones", async () => {
  const { default: Terms } = await import("./terms/page");
  const { KEYS_PER_ACCOUNT } = await import("@/lib/api-keys");
  const text = visible(renderToStaticMarkup(<Terms />));
  expect(text).toContain(`${KEYS_PER_ACCOUNT} keys`);
});

test("/privacy names who is responsible, lists your rights, keeps retention periods in step with the code, and anchors the choices section", async () => {
  const { default: Privacy } = await import("./privacy/page");
  const { USAGE_KEPT_DAYS, REVOKED_KEPT_DAYS } = await import("@/lib/api-keys");
  const html = renderToStaticMarkup(<Privacy />);
  for (const id of ["controller", "rights", "retention", "children", "choices"]) expect(html, id).toContain(`id="${id}"`);
  const text = visible(html);
  expect(text).toContain("run by R21 Media Group, LLC");
  expect(text).toContain(`${USAGE_KEPT_DAYS} days`);
  expect(text).toContain(`${REVOKED_KEPT_DAYS} days`);
  expect(text).toContain("30 days");
  expect(text).toMatch(/Last updated: \d{1,2} \w+ 20\d\d/);
  expect(html).toContain('href="/terms"');
});

test("/security says how to report, what is in scope, and matches SECURITY.md on the contact", async () => {
  const { default: Security } = await import("./security/page");
  const html = renderToStaticMarkup(<Security />);
  const text = visible(html);
  const policy = readFileSync(new URL("../../../SECURITY.md", import.meta.url), "utf8");
  expect(text).toContain("hello@everloot.app");
  expect(policy).toContain("hello@everloot.app");
  expect(html).toContain(`${REPO_URL}/security/advisories/new`);
  expect(html).toContain('href="/.well-known/security.txt"');
  expect(text).toContain("In scope");
});

test("/.well-known/security.txt follows RFC 9116 and has not expired", () => {
  const file = readFileSync(new URL("../../public/.well-known/security.txt", import.meta.url), "utf8");
  expect(file).toContain("Contact: mailto:hello@everloot.app");
  expect(file).toContain("Contact: https://github.com/Everloot/everloot/security/advisories/new");
  expect(file).toContain("Policy: https://everloot.app/security");
  expect(file).toContain("Canonical: https://everloot.app/.well-known/security.txt");
  const expires = file.match(/^Expires: (.+)$/m)?.[1];
  expect(expires).toBeDefined();
  const when = new Date(expires!).getTime();
  // An expired file is a defect; this fails before that happens so the date gets renewed.
  expect(when, "renew the Expires date in public/.well-known/security.txt").toBeGreaterThan(Date.now() + 14 * 86_400_000);
  expect(when).toBeLessThanOrEqual(Date.now() + 366 * 86_400_000);
});

test("/about links every tool at the address it lives at, not a slug that redirects or 404s", async () => {
  const { default: About } = await import("./about/page");
  const html = renderToStaticMarkup(<About />);
  for (const l of TOOL_GROUPS.flatMap((g) => g.links)) expect(html, l.href).toContain(`href="${l.href}"`);
  for (const slug of ["upload", "completionist", "guild-tracker"]) expect(html).not.toContain(`href="/tools/${slug}"`);
});

test("/accessibility says what is in place, what was checked and when, what was not, and how to report", async () => {
  const { default: Accessibility } = await import("./accessibility/page");
  const html = renderToStaticMarkup(<Accessibility />);
  for (const id of ["aim", "in-place", "checked", "not-checked", "report"]) expect(html, id).toContain(`id="${id}"`);
  const text = visible(html);
  expect(text).toContain("WCAG");
  expect(text).toContain("do not claim full conformance");
  expect(text).toMatch(/On \d{1,2} \w+ 20\d\d we ran an automated axe-core audit/);
  expect(text).toContain("have not checked yet");
  expect(text).toContain("hello@everloot.app");
  expect(html).toContain(`${REPO_URL}/issues/new/choose`);
  expect(html).not.toMatch(/TODO|TBD/i);
});

test("/contact points copyright and takedown requests at the terms", async () => {
  const { default: Contact } = await import("./contact/page");
  expect(renderToStaticMarkup(<Contact />)).toContain('href="/terms#takedown"');
});
