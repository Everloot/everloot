import { expect, test, vi } from "vitest";
import { censusIcons, readCensusIcons, CENSUS_MEDIA } from "./census-media";

test("without credentials the icon fallback makes no request", async () => {
  vi.stubEnv("BNET_CLIENT_ID", "");
  vi.stubEnv("BNET_CLIENT_SECRET", "");
  const fetch = vi.spyOn(globalThis, "fetch");
  try {
    expect(await censusIcons()).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); vi.unstubAllEnvs(); }
});

test("media uses playable ids and static endpoints, only accepting Blizzard's HTTPS icon asset", async () => {
  const get = vi.fn(async (path: string) => ({ status: 200 as const, lastModified: null, body: { assets: [
    { key: "other", value: "https://render.worldofwarcraft.com/not-icon.jpg" },
    { key: "icon", value: path.endsWith("class/3") ? "https://render.worldofwarcraft.com/icons/56/classicon_hunter.jpg" : "https://example.org/untrusted.jpg" },
  ] } }));
  expect(await readCensusIcons({ get })).toEqual({ HUNTER: "https://render.worldofwarcraft.com/icons/56/classicon_hunter.jpg" });
  expect(get).toHaveBeenCalledWith("/data/wow/media/playable-class/3", "static");
  expect(get).toHaveBeenCalledWith("/data/wow/media/playable-race/5", "static");
  expect(CENSUS_MEDIA).not.toHaveProperty("Skyborne");
});

test("missing media and API failure leave names alone", async () => {
  expect(await readCensusIcons({ get: vi.fn().mockResolvedValue({ status: 404, body: null }) })).toEqual({});
  expect(await readCensusIcons({ get: vi.fn().mockRejectedValue(new Error("unavailable")) })).toEqual({});
});
