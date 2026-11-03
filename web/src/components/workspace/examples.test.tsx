// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import AltPlanner from "@/app/tools/alts/AltPlanner";
import { WORKSPACE_LIMITS, WORKSPACE_VERSION, bucketKey, withWorkspaceLock, type DeviceStorage, type LocalAlt, type LocalPlan, type Owner, type PlayerWorkspace } from "@/lib/player-workspace";
import { loadCatalog } from "@/lib/talents/catalogs";
import { isLegal, pointsSpent } from "@/lib/talents/rules";
import { decodeBuild, resolveBuild } from "@/lib/talents/share";
import { EXAMPLE_ALTS, EXAMPLE_PLAN_SPECS, copyExampleAlts, copyExamplePlans, examplePlans, examplesKey, type ExamplePlan } from "@/lib/workspace-examples";
import DevicePlans from "./DevicePlans";

// The examples Plans and Alts on this device show a visitor with nothing saved: built from the real talent catalogs,
// marked as examples, shown only while the list is empty, written only when Copy to my device is pressed, and hidden
// for good in this browser when the visitor hides them.

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", async (actual) => ({ ...(await actual<object>()), useRouter: () => ({ refresh }) }));

const ANON: Owner = { kind: "anonymous" };
const MAGE = "EL1-mage-1482-1.60.1.70450-OTAwMDE6Miw5MDAwMjoxOjEsOTAwMDQ6Mg";
const id = (n: number) => `1a2b3c4d-0000-4000-8000-${String(n).padStart(12, "0")}`;

let examples: ExamplePlan[];
let catalogs: Awaited<ReturnType<typeof loadCatalog>>[];
beforeAll(async () => {
  catalogs = await Promise.all(EXAMPLE_PLAN_SPECS.map((s) => loadCatalog(s.classSlug)));
  examples = examplePlans(Object.fromEntries(catalogs.map((c, i) => [EXAMPLE_PLAN_SPECS[i].classSlug, c])));
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) !== "/api/auth/me") throw new Error(`Unexpected request ${String(input)}`);
    return Response.json({ user: null });
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const doc = (plans: LocalPlan[], alts: LocalAlt[] = []): PlayerWorkspace => ({ format: "everloot.player-workspace", version: WORKSPACE_VERSION, owner: ANON, plans, alts, watches: [] });
const seed = (plans: LocalPlan[], alts: LocalAlt[] = []) => localStorage.setItem(bucketKey(ANON), JSON.stringify(doc(plans, alts)));
const stored = () => JSON.parse(localStorage.getItem(bucketKey(ANON)) ?? "null") as PlayerWorkspace | null;
const plan: LocalPlan = { id: id(1), name: "Frost", classSlug: "mage", code: MAGE, code2: null, order: null, order2: null, notes: "", updatedAt: "2026-10-20T12:00:00.000Z", boundTo: null };
const alt: LocalAlt = {
  id: id(2), name: "Jaina", realm: "Moon Guard", classSlug: "mage", faction: "alliance", level: 60, professions: [], notes: "", planIds: [],
  provenance: { source: "manual", fileRecordAt: null, fileDetails: [] }, updatedAt: "2026-10-20T12:00:00.000Z",
};

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function render(ui: React.ReactElement) {
  await act(async () => root.render(ui));
  await settle();
}
const section = (label: string) => [...container.querySelectorAll("section")].find((s) => s.querySelector("h2")?.textContent?.startsWith(label)) ?? null;
const button = (label: string, scope: ParentNode = container) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
async function click(el: Element | undefined) {
  if (!el) throw new Error("Nothing to click");
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
  await settle();
}

describe("the example plans", () => {
  test("are real plans: each code reads, fits its class's tree and spends the points it says", () => {
    expect(examples.map((p) => p.classSlug)).toEqual(EXAMPLE_PLAN_SPECS.map((s) => s.classSlug));
    examples.forEach((example, i) => {
      const decoded = decodeBuild(example.code);
      if (!decoded.ok) throw new Error(`${example.name} does not read`);
      const resolved = resolveBuild(catalogs[i], decoded.build);
      if (!resolved.ok) throw new Error(`${example.name} is not a ${example.classSlug} plan`);
      expect(isLegal(catalogs[i], resolved.build.ranks)).toBe(true);
      expect(pointsSpent(resolved.build.ranks)).toBe(EXAMPLE_PLAN_SPECS[i].points);
      expect(example.name).toMatch(/^Example: /);
    });
  });

  test("show on an empty device, marked as examples, and write nothing until asked", async () => {
    await render(<DevicePlans examples={examples} />);
    const shown = section("Example plans");
    expect(shown?.textContent).toContain("Example");
    for (const p of examples) expect(shown?.textContent).toContain(p.name);
    expect(localStorage.getItem(bucketKey(ANON))).toBeNull();
  });

  test("do not show once the device has a plan", async () => {
    seed([plan]);
    await render(<DevicePlans examples={examples} />);
    expect(section("Example plans")).toBeNull();
  });

  test("Copy to my device saves them as the visitor's own plans", async () => {
    await render(<DevicePlans examples={examples} />);
    await click(button("Copy to my device", section("Example plans")!));
    expect(stored()?.plans.map((p) => [p.name, p.code])).toEqual(examples.map((p) => [p.name, p.code]));
    expect(section("Example plans")).toBeNull();
    expect(container.textContent).toContain("Copied the example plans to this device.");
  });

  test("hiding them is remembered in this browser, and saves no plan", async () => {
    await render(<DevicePlans examples={examples} />);
    await click(button("Hide examples"));
    expect(section("Example plans")).toBeNull();
    expect(localStorage.getItem(examplesKey("builds"))).toBe("hidden");
    expect(localStorage.getItem(bucketKey(ANON))).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(<DevicePlans examples={examples} />);
    expect(section("Example plans")).toBeNull();
  });
});

describe("the example alts", () => {
  test("show on a device with no alts, with made-up names, and write nothing until asked", async () => {
    await render(<AltPlanner examplePlans={examples} />);
    const shown = section("Example alts");
    for (const a of EXAMPLE_ALTS) {
      expect(a.name).toMatch(/^Example /);
      expect(shown?.textContent).toContain(a.name);
    }
    expect(localStorage.getItem(bucketKey(ANON))).toBeNull();
  });

  test("do not show once the device has an alt", async () => {
    seed([], [alt]);
    await render(<AltPlanner examplePlans={examples} />);
    expect(section("Example alts")).toBeNull();
  });

  test("Copy to my device saves the alts and the example plans they use, linked", async () => {
    await render(<AltPlanner examplePlans={examples} />);
    await click(button("Copy to my device", section("Example alts")!));
    const now = stored()!;
    expect(now.alts.map((a) => a.name)).toEqual(EXAMPLE_ALTS.map((a) => a.name));
    for (const a of now.alts) {
      expect(a.planIds).toHaveLength(1);
      expect(now.plans.find((p) => p.id === a.planIds[0])?.classSlug).toBe(a.classSlug);
    }
    expect(section("Example alts")).toBeNull();
  });

  test("hiding them is remembered apart from the plans page's", async () => {
    await render(<AltPlanner examplePlans={examples} />);
    await click(button("Hide examples"));
    expect(section("Example alts")).toBeNull();
    expect(localStorage.getItem(examplesKey("alts"))).toBe("hidden");
    expect(localStorage.getItem(examplesKey("builds"))).toBeNull();
    expect(localStorage.getItem(bucketKey(ANON))).toBeNull();
  });
});

describe("copying the examples", () => {
  const plans = (n: number) => Array.from({ length: n }, (_, i) => ({ ...plan, id: id(100 + i) }));
  /** This browser's localStorage, refusing every write as a full one does. */
  const full = (): DeviceStorage => ({
    getItem: (key) => localStorage.getItem(key),
    setItem: () => { throw new DOMException("full", "QuotaExceededError"); },
    removeItem: (key) => localStorage.removeItem(key),
  });

  test("the alts and their plans are saved together or not at all: one plan short of room, nothing is saved", async () => {
    seed(plans(WORKSPACE_LIMITS.plans - 1));
    const before = localStorage.getItem(bucketKey(ANON));
    await render(<AltPlanner examplePlans={examples} />);
    await click(button("Copy to my device", section("Example alts")!));
    expect(localStorage.getItem(bucketKey(ANON))).toBe(before);
    expect(container.textContent).toContain("Nothing was changed.");
  });

  test("a full storage saves none of them", () => {
    seed([], []);
    const before = localStorage.getItem(bucketKey(ANON));
    expect(copyExampleAlts(full(), ANON, EXAMPLE_ALTS, examples)).toMatchObject({ ok: false, error: "full" });
    expect(copyExamplePlans(full(), ANON, examples)).toMatchObject({ ok: false, error: "full" });
    expect(localStorage.getItem(bucketKey(ANON))).toBe(before);
  });

  test("two requests made before either is saved copy the plans once", async () => {
    const results = await Promise.all([1, 2].map(() => withWorkspaceLock(() => copyExamplePlans(localStorage, ANON, examples))));
    expect(results.map((r) => r.ok)).toEqual([true, false]);
    expect(results[1]).toMatchObject({ error: "changed" });
    expect(stored()?.plans).toHaveLength(examples.length);
  });

  test("two requests made before either is saved copy the alts once", async () => {
    const results = await Promise.all([1, 2].map(() => withWorkspaceLock(() => copyExampleAlts(localStorage, ANON, EXAMPLE_ALTS, examples))));
    expect(results.map((r) => r.ok)).toEqual([true, false]);
    expect(stored()?.alts).toHaveLength(EXAMPLE_ALTS.length);
    expect(stored()?.plans).toHaveLength(examples.length);
  });

  test("a plan saved in another tab after the examples showed stops the copy", async () => {
    await render(<DevicePlans examples={examples} />);
    seed([plan]);
    await click(button("Copy to my device", section("Example plans")!));
    expect(stored()?.plans.map((p) => p.id)).toEqual([plan.id]);
    expect(container.textContent).toContain("saved in another tab, so the examples were not copied");
  });
});
