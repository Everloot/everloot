import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { DESCRIPTION_MAX, DESCRIPTION_MIN } from "@/lib/seo";
import GameVersionPage, { generateMetadata, generateStaticParams } from "./page";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
// A version with no build and no note, served by a version whose build is not yet known: no placeholder may reach the page.
vi.mock("@/lib/build-versions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/build-versions")>();
  const blank = { ...real.WITHOUT_SNAPSHOT[0]!, id: "ptr", label: "PTR", build: null, note: null };
  return { ...real, WITHOUT_SNAPSHOT: [blank, ...real.WITHOUT_SNAPSHOT.filter((v) => v.id !== "ptr")], SERVED: { ...real.SERVED, build: null } };
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("only a version without the snapshot has a notice", async () => {
  expect(generateStaticParams()).toEqual([{ id: "ptr" }, { id: "beta" }]);
  await expect(GameVersionPage(params("live"))).rejects.toThrow("NOT_FOUND");
  expect(await generateMetadata(params("live"))).toEqual({});
});

test("a version with no build and no note says none is running, and an unknown served build is the current one", async () => {
  const page = text(renderToStaticMarkup(await GameVersionPage(params("ptr"))));
  expect(page).toContain("PTR game data");
  expect(page).toContain("PTR: No build is running.");
  expect(page).toContain("Every page on the site shows Live, the current build, and the version label");
  expect(page).not.toContain("[?]");
  const m = await generateMetadata(params("ptr"));
  expect(String(m.description)).toContain("Every page shows Live, the current build, and says so");
  expect(String(m.description)).not.toContain("[?]");
});

test("since launch /beta is a notice too: none running, and the pages show Live", async () => {
  const page = text(renderToStaticMarkup(await GameVersionPage(params("beta"))));
  expect(page).toContain("Beta: None running since launch, 2026-11-04.");
  expect((await generateMetadata(params("beta"))).alternates?.canonical).toBe("/beta");
});

test("the notice's canonical is its own prefix, and it stays out of the index", async () => {
  const m = await generateMetadata(params("ptr"));
  expect(m.alternates?.canonical).toBe("/ptr");
  expect(m.robots).toEqual({ index: false, follow: true });
  const description = String(m.description);
  expect(description.length).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
  expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
});
