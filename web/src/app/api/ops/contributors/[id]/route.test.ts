import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorizeOps: vi.fn(), contributorIdentity: vi.fn() }));
vi.mock("@/lib/ops/access", () => ({ authorizeOps: mocks.authorizeOps }));
vi.mock("@/lib/ops/attribution", () => ({ contributorIdentity: mocks.contributorIdentity }));
import { GET } from "./route";
const request = () => new Request("https://everloot.app/api/ops/contributors/abc");
const ctx = (id = "a".repeat(64)) => ({ params: Promise.resolve({ id }) });
beforeEach(() => vi.resetAllMocks());
test("denied humans and aggregate agents cannot read identity", async () => {
  mocks.authorizeOps.mockResolvedValue(null);
  const response = await GET(request(), ctx());
  expect(response.status).toBe(403);
  expect(mocks.authorizeOps).toHaveBeenCalledWith(expect.any(Request), "contributors");
  expect(mocks.contributorIdentity).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
test("only an opaque valid contributor ID reaches live detail reader", async () => {
  mocks.authorizeOps.mockResolvedValue({ kind: "human", id: "operator" });
  expect((await GET(request(), ctx("raw-install-id"))).status).toBe(404);
  expect(mocks.contributorIdentity).not.toHaveBeenCalled();
  mocks.contributorIdentity.mockResolvedValue({ identity: null, attribution: "anonymous" });
  const response = await GET(request(), ctx());
  expect(await response.json()).toEqual({ identity: null, attribution: "anonymous" });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
