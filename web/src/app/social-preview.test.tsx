import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { tokens } from "@/design/tokens";
import sharp from "sharp";

// next/font only runs under Next's compiler.
vi.mock("./fonts", () => ({ fontVariables: "" }));

import OpenGraphImage, { alt, contentType, size } from "./opengraph-image";
import TwitterImage from "./twitter-image";
import { metadata } from "./layout";

test("the site has a large social preview image built from the brand palette", async () => {
  expect(size).toEqual({ width: 1200, height: 630 });
  expect(contentType).toBe("image/png");
  expect(alt).toMatch(/Everloot/);
  const image = await OpenGraphImage();
  expect(image.headers.get("content-type")).toBe("image/png");
  const bytes = new Uint8Array(await image.arrayBuffer());
  expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect((await TwitterImage()).headers.get("content-type")).toBe("image/png");
});

test("shared links use the large card", () => {
  expect((metadata.twitter as { card?: string }).card).toBe("summary_large_image");
});

test("the favicon is the green diamond on the canvas", () => {
  const svg = readFileSync(new URL("./icon.svg", import.meta.url), "utf8");
  expect(new Set(svg.match(/#[0-9A-Fa-f]{6}/g))).toEqual(new Set([tokens.dark.canvas, tokens.dark.accent]));
});

test("SVG and Apple favicons are linked and both Apple paths have a 180px PNG", async () => {
  expect(metadata.icons).toMatchObject({ icon: expect.arrayContaining([{ url: "/icon.svg", type: "image/svg+xml" }]), apple: "/apple-icon.png" });
  for (const path of ["./apple-icon.png", "../../public/apple-touch-icon.png"]) {
    expect(await sharp(readFileSync(new URL(path, import.meta.url))).metadata()).toMatchObject({ width: 180, height: 180, format: "png" });
  }
});
