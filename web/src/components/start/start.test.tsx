// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { CLASS_CONTEXT_SLOT } from "@/lib/class-context";
import { startTiles } from "@/lib/start-here";
import { StartClassProvider, ClassSelect, ClassStartLink } from "./StartClass";
import RulesetChooser from "./RulesetChooser";

let root: Root | undefined;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); localStorage.clear(); });
async function mount(node: React.ReactNode) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(node));
}
function choices() {
  return <StartClassProvider><ClassSelect />{startTiles(true).filter((t) => ["talents", "class"].includes(t.key)).map((t) => <ClassStartLink key={t.key} tile={t}>{t.label}</ClassStartLink>)}</StartClassProvider>;
}

test("server markup has usable generic links and no storage dependency", () => {
  const markup = renderToStaticMarkup(choices());
  expect(markup).toContain('href="/tools/talents"');
  expect(markup).toContain('href="/classes"');
});

test("selecting a class remembers it across remounts and personalizes links", async () => {
  await mount(choices());
  const select = host.querySelector("select")!;
  await act(async () => { select.value = "mage"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(JSON.parse(localStorage.getItem(CLASS_CONTEXT_SLOT)!)).toEqual({ classSlug: "mage" });
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/tools/talents/mage");
  await act(async () => root!.unmount()); root = undefined;
  await mount(choices());
  expect(host.querySelector("select")?.value).toBe("mage");
  expect(host.querySelectorAll("a")[1].getAttribute("href")).toBe("/classes/mage");
  await act(async () => { const s = host.querySelector("select")!; s.value = ""; s.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(localStorage.getItem(CLASS_CONTEXT_SLOT)).toBeNull();
});

test.each(["getter", "write", "corrupt"])("class memory fails safely: %s", async (failure) => {
  if (failure === "getter") vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("blocked"); });
  if (failure === "write") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
  if (failure === "corrupt") localStorage.setItem(CLASS_CONTEXT_SLOT, "{broken");
  await mount(choices());
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/tools/talents");
  await act(async () => { const s = host.querySelector("select")!; s.value = "druid"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/tools/talents/druid");
  if (failure !== "corrupt") expect(host.textContent).toContain("could not remember");
});

test("ruleset form requires three radio groups and explains its submitted result", async () => {
  await mount(<RulesetChooser />);
  const form = host.querySelector("form")!;
  expect(host.querySelectorAll("fieldset fieldset")).toHaveLength(3);
  expect(form.checkValidity()).toBe(false);
  for (const name of ["pvp", "roleplay", "friends"]) {
    const radio = host.querySelector<HTMLInputElement>(`input[name="${name}"][value="yes"]`)!;
    expect(radio.labels?.length).toBe(1);
    await act(async () => radio.click());
  }
  expect(form.checkValidity()).toBe(true);
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(host.querySelector('[role="status"]')?.textContent).toContain("RP-PvP");
  expect(host.textContent).toContain("Check your friends");
  expect(host.textContent).toContain("Not confirmed yet");
  await act(async () => host.querySelector<HTMLInputElement>('input[name="pvp"][value="no"]')!.click());
  expect(host.querySelector('[role="status"]')?.textContent).not.toContain("RP-PvP");
});


test("reselecting the stored class preserves its level and role; changing class explains their replacement", async () => {
  localStorage.setItem(CLASS_CONTEXT_SLOT, JSON.stringify({ classSlug: "druid", level: 25, role: "healer" }));
  await mount(choices());
  const select = host.querySelector("select")!;
  await act(async () => { select.value = "druid"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(JSON.parse(localStorage.getItem(CLASS_CONTEXT_SLOT)!)).toEqual({ classSlug: "druid", level: 25, role: "healer" });
  expect(host.querySelectorAll("a")[1].getAttribute("href")).toBe("/classes/druid?level=25&role=healer");
  expect(host.textContent).toContain("Changing class replaces any remembered level and role");
  await act(async () => { select.value = "mage"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(JSON.parse(localStorage.getItem(CLASS_CONTEXT_SLOT)!)).toEqual({ classSlug: "mage" });
});

test("the unhydrated ruleset form cannot submit a GET with no result", () => {
  const html = renderToStaticMarkup(<RulesetChooser />);
  const doc = new DOMParser().parseFromString(html, "text/html");
  expect(doc.querySelector("form > fieldset")?.hasAttribute("disabled")).toBe(true);
  expect(html.indexOf("<noscript>")).toBeLessThan(html.indexOf("<form"));
  expect(doc.body.textContent).not.toContain("Availability and start date");
});
