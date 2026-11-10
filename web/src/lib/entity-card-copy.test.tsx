import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/og", () => ({ ImageResponse: class extends Response {
  constructor(tree: Parameters<typeof renderToStaticMarkup>[0]) { super(renderToStaticMarkup(tree)); }
} }));
import { renderEntityCard } from "./og-card";

test("item and NPC cards omit zero agreement but keep positive counts and unavailable storage quiet", async () => {
  for (const type of ["Item", "NPC"]) {
    for (const installs of [0, null, 1, 3]) {
      const html = await (await renderEntityCard({ title: "A name", type, installs, omitZero: true })).text();
      expect(html.includes("installs agree")).toBe(installs !== null && installs > 0);
      expect(html).not.toContain("0 of 3");
      expect(html).not.toContain("<img");
    }
  }
  expect(await (await renderEntityCard({ title: "Quest", type: "Quest", installs: 0 })).text()).toContain("0 of 3");
});


test("entity cards embed an icon once and fall back when art is off or unavailable", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }));
  vi.stubGlobal("fetch", fetcher);
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", "https://assets.example/build");
  const card = { title: "Helm", type: "Armor", installs: null, icon: "https://assets.example/build/icons/1.png" };
  expect(await (await renderEntityCard(card)).text()).toContain('src="data:image/png;base64,');
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockRejectedValueOnce(new Error("offline"));
  expect(await (await renderEntityCard(card)).text()).not.toContain("<img");
  fetcher.mockResolvedValueOnce(new Response("invalid WebP", { headers: { "content-type": "image/webp" } }));
  expect(await (await renderEntityCard(card)).text()).not.toContain("<img");
  fetcher.mockResolvedValueOnce(new Response("not found", { status: 404 }));
  expect(await (await renderEntityCard(card)).text()).not.toContain("<img");
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", "");
  fetcher.mockClear();
  expect(await (await renderEntityCard(card)).text()).not.toContain("<img");
  expect(fetcher).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
