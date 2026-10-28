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
