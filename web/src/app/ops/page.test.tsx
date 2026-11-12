import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const { authorize, read } = vi.hoisted(() => ({ authorize: vi.fn(), read: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "cf-access-jwt-assertion": "fixture" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/ops/access", () => ({ authorizeOps: authorize }));
vi.mock("@/lib/ops/store", () => ({ readOpsSummary: read }));
import OperationsPage, { dynamic, fetchCache, metadata } from "./page";

beforeEach(() => { authorize.mockReset(); read.mockReset(); });
it("denies anonymous and agent principals before reading private metrics", async () => {
  for (const principal of [null, { kind: "agent", id: "fixture" }]) {
    authorize.mockResolvedValue(principal);
    await expect(OperationsPage()).rejects.toThrow("NOT_FOUND");
    expect(read).not.toHaveBeenCalled();
  }
  expect(authorize.mock.calls[0][0].headers.get("cf-access-jwt-assertion")).toBe("fixture");
  expect(authorize.mock.calls[0][1]).toBe("human");
});
it("shows unavailable rather than invented metrics to authorized humans", async () => {
  authorize.mockResolvedValue({ kind: "human", id: "fixture" });
  read.mockResolvedValue(null);
  const html = renderToStaticMarkup(await OperationsPage());
  expect(read).toHaveBeenCalledOnce();
  expect(html).toContain("Operations snapshot unavailable");
  expect(dynamic).toBe("force-dynamic");
  expect(fetchCache).toBe("force-no-store");
  expect(metadata.robots).toEqual({ index: false, follow: false, nocache: true });
});
