// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import UploadClient from "./UploadClient";

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
let send: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  send = vi.fn();
  vi.stubGlobal("fetch", send);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<UploadClient />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function load(count: number) {
  // One install per row makes small, separate batches without a large fixture.
  const text = JSON.stringify({ addonVersion: "0.3.12", records: Array.from({ length: count }, (_, i) => ({
    kind: "loot", installId: `upload-ui-${i}`, eventId: `epoch:${i}`, capturedAt: "2026-10-28T00:00:00Z", sourceNpcId: 1, items: [],
  })) });
  const file = new File([text], "Everloot.json");
  Object.defineProperty(file, "text", { value: async () => text });
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}

const rejected = () => Response.json({ ok: false, accepted: [], rejected: [{ index: 0, reason: "Try again later" }] }, { status: 422 });
const accepted = () => Response.json({ ok: true, persisted: true, uploadId: "saved", accepted: [{ index: 0, kind: "loot" }], rejected: [] });

test("contribution attribution is a separate unchecked choice after a durable upload", async () => {
  const text = JSON.stringify({ addonVersion: "0.3.12", records: [
    { kind: "loot", installId: "my-install", eventId: "epoch:1", capturedAt: "2026-11-12T00:00:00Z", sourceNpcId: 1, items: [] },
    { kind: "profession_owned", installId: "my-install", characterKey: "1234abcd" },
    { kind: "profession_owned", installId: "my-install", characterKey: "5678abcd" },
  ] });
  const file = new File([text], "Everloot.json");
  Object.defineProperty(file, "text", { value: async () => text });
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  send.mockResolvedValueOnce(accepted());
  await click("Send upload");
  expect(send).toHaveBeenCalledTimes(1);
  send.mockResolvedValueOnce(Response.json({ userId: "my-account", links: [{ id: "my-link", name: "Mychar", realm: "Realm" }] }));
  await click("Manage contribution identity");
  const consent = container.querySelector<HTMLInputElement>('input[aria-label="Share contribution character"]')!;
  expect(consent.checked).toBe(false);
  const save = [...container.querySelectorAll("button")].find(b => b.textContent === "Attribute these upload receipts")!;
  expect(save.disabled).toBe(true);
  await act(async () => consent.click());
  send.mockResolvedValueOnce(Response.json({ ok: true }));
  await click("Attribute these upload receipts");
  const [url, init] = send.mock.calls[2];
  expect(url).toBe("/api/me/contributions");
  expect(JSON.parse(init.body)).toMatchObject({ expectedUserId: "my-account", consent: true, linkId: "my-link", uploadIds: ["saved"], installId: "my-install", completionKeys: ["1234abcd", "5678abcd"] });
  expect(container.textContent).toContain("Request attribution saved");
  expect(container.textContent).toContain("does not mean this character authored every record");
});

test("a file without its own character key stays anonymous and explains the limit", async () => {
  await load(1); send.mockResolvedValueOnce(accepted()); await click("Send upload");
  expect(container.textContent).toContain("This file has no matching character key for attribution");
  expect(container.textContent).not.toContain("Observed character names establish");
  expect(send).toHaveBeenCalledTimes(1);
});

test("a rejected batch and saved batch remain visible while retry sends only the failed later batch", async () => {
  await load(3);
  send.mockResolvedValueOnce(rejected()).mockResolvedValueOnce(accepted())
    .mockResolvedValueOnce(Response.json({ error: "Storage unavailable" }, { status: 503 }));
  await click("Send upload");
  expect(send).toHaveBeenCalledTimes(3);
  expect(container.textContent).toContain("2 of 3 batches processed; 1 records saved, 1 records rejected");
  expect(container.textContent).toContain("Rejected records were not saved. Keep your original file");
  expect(container.textContent).toContain("Upload paused");
  send.mockResolvedValueOnce(accepted());
  await click("Resume upload");
  expect(send.mock.calls.map((call) => JSON.parse(call[1].body).records[0].eventId)).toEqual(["epoch:0", "epoch:1", "epoch:2", "epoch:2"]);
  expect(container.textContent).toContain("3 of 3 batches processed; 2 records saved, 1 records rejected");
  expect(container.querySelector("progress")?.getAttribute("aria-label")).toBe("Processed upload batches");
});

test("an upload with nothing accepted reports rejection and zero saved records", async () => {
  await load(1);
  send.mockResolvedValueOnce(rejected());
  await click("Send upload");
  expect(container.textContent).toContain("Upload processed with rejections");
  expect(container.textContent).toContain("1 of 1 batches processed; 0 records saved, 1 records rejected");
  expect(container.textContent).toContain("Try again later");
  expect(container.textContent).toContain("Rejected records were not saved. Keep your original file");
  expect(container.textContent).not.toContain("batches confirmed");
});

test("the preview counts boss pulls, says what they hold and how to stop them, only where the site keeps them", async () => {
  const pull = { kind: "pull_summary", installId: "upload-ui-pull", eventId: "epoch:1", capturedAt: "2026-11-02T12:00:00Z", encounterId: 1144,
    name: "Rhahk'zor", instanceMapId: 36, success: true, realm: "Forever", members: [{ name: "Thrallina", class: "SHAMAN" }] };
  const text = JSON.stringify({ addonVersion: "0.3.16", records: [pull] });
  const choose = async () => {
    const file = new File([text], "Everloot.json");
    Object.defineProperty(file, "text", { value: async () => text });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  };
  // Switch off: the row is read as the site then reads it, an unknown kind, as before boss pulls.
  await choose();
  expect(container.textContent).not.toContain("Boss pulls");
  expect(container.textContent).toContain("and 1 invalid records stay out of this upload");
  await act(async () => root.render(<UploadClient pullSummaries />));
  await choose();
  expect(container.textContent).toContain("Boss pulls in this upload: 1.");
  expect(container.textContent).toContain("/everloot pulls off");
  expect(container.textContent).toContain("name, realm, class, role and the damage, healing, damage taken and deaths");
  expect(container.textContent).toContain("Everloot keeps them privately for a year");
  expect(container.querySelector('a[href="/players/opt-out"]')?.textContent).toBe("hide a character");
});
