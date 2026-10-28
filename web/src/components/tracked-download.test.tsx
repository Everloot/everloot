// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import TrackedDownload from "./TrackedDownload";

test("an Everloot zip keeps its download link and reports only while analytics is loaded", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  const capture = vi.fn();
  window.gtag = capture;
  try {
    await act(async () => root.render(<TrackedDownload href="/downloads/Everloot-0.3.10.zip" addon="everloot" to="site" download>Download addon</TrackedDownload>));
    const anchor = container.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe("/downloads/Everloot-0.3.10.zip");
    expect(anchor.hasAttribute("download")).toBe(true);
    anchor.addEventListener("click", (event) => event.preventDefault());
    await act(async () => anchor.click());
    expect(capture).toHaveBeenCalledExactlyOnceWith("event", "addon_download", { addon: "everloot", to: "site" });
    delete window.gtag;
    await act(async () => anchor.click());
    expect(capture).toHaveBeenCalledOnce();
  } finally {
    delete window.gtag;
    await act(async () => root.unmount());
  }
});
