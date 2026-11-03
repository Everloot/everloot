// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import HomeAsk from "./HomeAsk";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  push.mockReset();
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<HomeAsk />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function ask(question: string): SubmitEvent {
  const input = container.querySelector<HTMLInputElement>("#home-ask")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, question);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  const e = new SubmitEvent("submit", { bubbles: true, cancelable: true });
  act(() => { container.querySelector("form")!.dispatchEvent(e); });
  return e;
}

test("the question goes to /chat in this tab's storage, not in the address", () => {
  const e = ask("  Where does Linen Cloth drop?  ");
  expect(e.defaultPrevented).toBe(true);
  expect(push).toHaveBeenCalledWith("/chat");
  expect(sessionStorage.getItem("everloot.chat.ask.v1")).toBe("Where does Linen Cloth drop?");
});

test("without storage the plain GET form goes ahead", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
  const e = ask("Where does Linen Cloth drop?");
  vi.restoreAllMocks();
  expect(e.defaultPrevented).toBe(false);
  expect(push).not.toHaveBeenCalled();
});
