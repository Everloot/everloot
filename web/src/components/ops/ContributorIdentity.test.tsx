// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ContributorIdentity from "./ContributorIdentity";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("requests protected fresh detail and displays only explicit authorized request attribution", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ attribution: "opted-in", identity: { name: "Authorized character", realm: "Recorded realm", class: "Mage", level: 60, path: "/character/authorized", provenance: "contributor-opt-in", attributedAt: "2026-11-12T12:00:00Z" } }));
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<ContributorIdentity id="opaque-alias" />));
  expect(fetch.mock.calls[0][0]).toBe("/api/ops/contributors/opaque-alias");
  expect(fetch.mock.calls[0][1].cache).toBe("no-store");
  expect(container.querySelector("a")?.textContent).toBe("Authorized character");
  expect(container.textContent).toContain("Contributor opt-in");
  expect(container.textContent).toContain("does not establish authorship of every record");
});
it("never shows a returned name when current disclosure is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ attribution: "unavailable", identity: { name: "Suppressed name" } })));
  await act(async () => root.render(<ContributorIdentity id="opaque-alias" />));
  expect(container.textContent).toContain("Submitting identity: unavailable");
  expect(container.textContent).not.toContain("Suppressed name");
  expect(container.querySelector("a")).toBeNull();
});
it("shows a failed protected detail read as unavailable without guessing", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
  await act(async () => root.render(<ContributorIdentity id="opaque-alias" />));
  expect(container.textContent).toContain("Submitting identity: unavailable");
});
