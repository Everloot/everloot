// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { Checklist, CopyMacro, KeyboardMap } from "./controls";
import { STARTER_MACROS } from "@/data/reference-spells";

let root: Root | undefined;
let host: HTMLDivElement;
async function mount(el: React.ReactNode) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host); await act(async () => root!.render(el));
}
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); vi.restoreAllMocks(); localStorage.clear(); });

test("checklists work when reading or writing storage throws", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("full"); });
  await mount(<Checklist storageKey="test" items={[{ id: "bag", text: "Pack your bag" }]} />);
  const input = host.querySelector("input")!;
  await act(async () => input.click());
  expect(input.checked).toBe(true);
  expect(host.textContent).toContain("cannot save");
});

test("checklists restore valid choices and ignore malformed saved data", async () => {
  localStorage.setItem("test", JSON.stringify(["bag", "unknown"]));
  await mount(<Checklist storageKey="test" items={[{ id: "bag", text: "Pack your bag" }]} />);
  expect(host.querySelector("input")!.checked).toBe(true);
  await act(async () => host.querySelector("input")!.click());
  expect(JSON.parse(localStorage.getItem("test")!)).toEqual([]);
  await act(async () => root!.unmount()); root = undefined; host.remove();
  localStorage.setItem("test", "{broken");
  await mount(<Checklist storageKey="test" items={[{ id: "bag", text: "Pack your bag" }]} />);
  expect(host.querySelector("input")!.checked).toBe(false);
  expect(host.textContent).not.toContain("cannot save");
});

test("Copy writes exactly the displayed macro, and reports clipboard failure", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await mount(<CopyMacro text={STARTER_MACROS[0].text} label="Warrior" />);
  await act(async () => host.querySelector("button")!.click());
  expect(writeText).toHaveBeenCalledWith(host.querySelector("pre")!.textContent);
  expect(host.querySelector("pre")!.tabIndex).toBe(0);
  expect(host.textContent).toContain("Copied");
  writeText.mockRejectedValue(Error("denied"));
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("Select and copy");
  vi.unstubAllGlobals();
});

test("class tabs support arrows and keyboard buttons expose persistent role information", async () => {
  await mount(<KeyboardMap />);
  const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  expect(tabs).toHaveLength(9);
  tabs[0].focus();
  await act(async () => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  expect(tabs[1].className).not.toBe(tabs[0].className);
  expect(document.activeElement).toBe(tabs[1]);
  const key = host.querySelector<HTMLButtonElement>('[data-key="Q"]')!;
  expect(key.getAttribute("aria-label")).toContain("Interrupt");
  await act(async () => key.click());
  expect(host.querySelector('[role="status"]')!.textContent).toContain("Not confirmed yet");
  expect(key.hasAttribute("aria-describedby")).toBe(false);
  expect(host.querySelector('[data-key="1"]')!.getAttribute("aria-label")).toContain("Unassigned");
});
