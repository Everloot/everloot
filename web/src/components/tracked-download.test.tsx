// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import TrackedDownload from "./TrackedDownload";

test.each([
  { href: "/downloads/Everloot-0.3.10.zip", to: "site" as const, download: true, label: "Download the zip" },
  { href: "https://www.curseforge.com/wow/addons/everloot", to: "curseforge" as const, download: false, label: "Open in the CurseForge app" },
])("$label keeps its link and reports only while analytics is loaded", async ({ href, to, download, label }) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  const capture = vi.fn();
  window.gtag = capture;
  try {
    await act(async () => root.render(<TrackedDownload href={href} addon="everloot" to={to} download={download}>{label}</TrackedDownload>));
    const anchor = container.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe(href);
    expect(anchor.hasAttribute("download")).toBe(download);
    anchor.addEventListener("click", (event) => event.preventDefault());
    await act(async () => anchor.click());
    expect(capture).toHaveBeenCalledExactlyOnceWith("event", "addon_download", { addon: "everloot", to });
    delete window.gtag;
    await act(async () => anchor.click());
    expect(capture).toHaveBeenCalledOnce();
  } finally {
    delete window.gtag;
    await act(async () => root.unmount());
  }
});
