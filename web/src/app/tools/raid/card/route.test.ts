import { expect, test, vi } from "vitest";
vi.mock("@/lib/og-card", () => ({
  renderCard: async () => new Response("public raid card", { headers: { "Content-Type": "image/png" } }),
  renderBuildCard: async () => new Response("public raid build", { headers: { "Content-Type": "image/png" } }),
}));
import { GET } from "./route";

test("the public raid card opts into a day at the edge without changing its picture", async () => {
  const res = await GET(new Request("https://everloot.app/tools/raid/card"));
  expect(res.headers.get("cdn-cache-control")).toBe("public, max-age=86400");
  expect(res.headers.get("cache-control")).toBe("public, max-age=86400, s-maxage=604800, immutable");
  expect(await res.text()).toBe("public raid card");
});
