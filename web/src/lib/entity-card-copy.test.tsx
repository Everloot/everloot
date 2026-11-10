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
