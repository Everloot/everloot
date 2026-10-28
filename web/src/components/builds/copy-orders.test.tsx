// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import type { SavedBuild } from "@/lib/saved-builds";
import BuildActions from "./BuildActions";
import SaveCopy from "./SaveCopy";

// A copy of a build keeps both sets' spend orders, and a new copy says whether it is shared and shows its owner's name:
// the site picks neither for it.

const MAGE = "EL1-mage-0-1.60.1.70450-MTE6NQ";
const MAGE2 = "EL1-mage-1482-1.60.1.70450-MjE6MQ";
const ORDER = "O1p-AAAAA";
const ORDER2 = "O1g-A";
const BUILD: SavedBuild = {
  id: "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11", slug: "AbCd1234", name: "Fire", notes: "For raids", classSlug: "mage",
  characterId: "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22", code: MAGE, code2: MAGE2, gameBuild: "1.60.1.70450", shared: false, active: false,
  link: null, updatedAt: "2026-10-20T12:00:00.000Z", showName: true, order: ORDER, order2: ORDER2,
};

let container: HTMLDivElement;
let root: Root;
let posts: Array<{ url: string; body: Record<string, unknown> }>;
let answer: () => Response;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  posts = [];
  answer = () => Response.json({ build: BUILD });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    posts.push({ url, body: JSON.parse(String(init!.body)) });
    return answer();
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const press = async (label: string) => {
  const target = [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
  await act(async () => { target.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

test("Save a copy on a shared build's page sends both sets' orders, and says the copy is shared and anonymous", async () => {
  // A refusal, so the page stays put: the copy's link would open the calculator.
  answer = () => Response.json({ error: "You have 200 saved builds. Delete one to save another." }, { status: 409 });
  await act(async () => root.render(<SaveCopy name="Raid frost" notes={null} code={MAGE} code2={MAGE2} order={ORDER} order2={ORDER2} />));
  await press("Save a copy");
  expect(posts).toEqual([{ url: "/api/me/builds", body: { name: "Raid frost (copy)", notes: null, code: MAGE, code2: MAGE2, order: ORDER, order2: ORDER2,
    shared: true, showName: false } }]);
  expect(container.querySelector('[role="alert"]')!.textContent).toBe("You have 200 saved builds. Delete one to save another.");
});

test("Save a copy of a build read before the spend-order migration names no order, so the save does not need one", async () => {
  answer = () => Response.json({ error: "You have 200 saved builds. Delete one to save another." }, { status: 409 });
  await act(async () => root.render(<SaveCopy name="Raid frost" notes={null} code={MAGE} code2={null} />));
  await press("Save a copy");
  expect(posts).toEqual([{ url: "/api/me/builds", body: { name: "Raid frost (copy)", notes: null, code: MAGE, code2: null, shared: true, showName: false } }]);
});

test("Duplicate keeps the build's orders and sharing, and says the copy does not show the owner's name", async () => {
  await act(async () => root.render(<BuildActions build={BUILD} />));
  await press("Duplicate");
  expect(posts).toEqual([{ url: "/api/me/builds", body: { name: "Fire (copy)", notes: "For raids", characterId: BUILD.characterId, code: MAGE, code2: MAGE2,
    order: ORDER, order2: ORDER2, shared: false, showName: false } }]);
  expect(router.refresh).toHaveBeenCalled();
});

test("Make active saves the build as it is, orders included", async () => {
  await act(async () => root.render(<BuildActions build={BUILD} canActivate />));
  await press("Make active");
  expect(posts).toEqual([{ url: "/api/me/builds", body: { id: BUILD.id, name: "Fire", notes: "For raids", characterId: BUILD.characterId, code: MAGE,
    code2: MAGE2, order: ORDER, order2: ORDER2, active: true } }]);
});
