import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus, loadCompletion: vi.fn().mockResolvedValue({ unreachable: true }) },
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

import DatabasePage from "./(hub)/page";

beforeEach(() => store.loadCorpus.mockReset());

test("the database index carries the key to reading its numbers", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z", records: [] });
  const page = renderToStaticMarkup(await DatabasePage());
  expect(page).toContain('id="reading"');
  expect(page).toContain("How to read these numbers");
  // The four tiers, in the site's own words.
  expect(page).toContain("3 of 3 installs agree");
  expect(page).toContain("Not recorded");
  expect(page).toContain("Measured zero");
  expect(page).toContain("methodology page");
  expect(page).toContain('href="/methodology"');
});
