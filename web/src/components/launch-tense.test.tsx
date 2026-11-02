// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import LaunchTense from "./LaunchTense";
import { LAUNCH_AT } from "@/data/wow-forever";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

/** What the browser shows once a page rendered with `launchedAtRender` has hydrated at the current clock. */
async function hydratedAt(launchedAtRender: boolean): Promise<string> {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("p");
  const root = createRoot(container);
  await act(async () => root.render(<LaunchTense launchedAtRender={launchedAtRender} />));
  const out = container.textContent ?? "";
  await act(async () => root.unmount());
  return out;
}

test("the server renders the tense it is given", () => {
  expect(renderToString(<LaunchTense launchedAtRender={false} />)).toBe("launches");
  expect(renderToString(<LaunchTense launchedAtRender />)).toBe("launched on");
});

test("a page prerendered before launch reads 'launched on' in a browser after launch", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(LAUNCH_AT));
  expect(await hydratedAt(false)).toBe("launched on");
  vi.setSystemTime(new Date(Date.parse(LAUNCH_AT) - 1));
  expect(await hydratedAt(false)).toBe("launches");
});
