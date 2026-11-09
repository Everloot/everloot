import { it, expect, vi } from "vitest";
import { ForeverApi } from "./api.js";
it("shares a token and sends conditional headers only when given", async () => {
  const f = vi
    .fn()
    .mockImplementation(async (url: string) =>
      url.includes("oauth")
        ? Response.json({ access_token: "fake", expires_in: 3600 })
        : Response.json({}),
    );
  const api = new ForeverApi({
    clientId: "id",
    clientSecret: "secret",
    region: "eu",
    fetchImpl: f,
  });
  await Promise.all([
    api.get("/one", "profile", { ifModifiedSince: "date" }),
    api.get("/two", "dynamic"),
  ]);
  expect(f).toHaveBeenCalledTimes(3);
  expect(f.mock.calls[1][0]).toContain("namespace=profile-forever-eu");
  expect(new Headers(f.mock.calls[1][1].headers).get("If-Modified-Since")).toBe(
    "date",
  );
  expect(new Headers(f.mock.calls[2][1].headers).has("If-Modified-Since")).toBe(
    false,
  );
});
it.each([304, 404, 500])("HTTP %i", async (status) => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ access_token: "fake", expires_in: 3600 }),
    )
    .mockResolvedValueOnce(new Response(null, { status }));
  const r = new ForeverApi({
    clientId: "id",
    clientSecret: "secret",
    region: "us",
    fetchImpl: f,
  }).get("/test", "profile");
  if (status === 500) await expect(r).rejects.toThrow("500");
  else expect(await r).toEqual({ status, body: null, lastModified: null });
});
it("refreshes before expiry", async () => {
  let now = 0;
  const f = vi
    .fn()
    .mockImplementation(async (url: string) =>
      url.includes("oauth")
        ? Response.json({ access_token: "fake", expires_in: 120 })
        : Response.json({}),
    );
  const api = new ForeverApi({
    clientId: "id",
    clientSecret: "secret",
    region: "eu",
    fetchImpl: f,
    now: () => now,
  });
  await api.get("/test", "profile");
  now = 61000;
  await api.get("/test", "profile");
  expect(f).toHaveBeenCalledTimes(4);
});

it("caches an OAuth failure for the instance", async () => {
  const f = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
  const api = new ForeverApi({
    clientId: "id",
    clientSecret: "secret",
    region: "eu",
    fetchImpl: f,
  });
  await expect(api.get("/one", "profile")).rejects.toThrow("OAuth");
  await expect(api.get("/two", "profile")).rejects.toThrow("OAuth");
  expect(f).toHaveBeenCalledTimes(1);
  expect(f.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});

it("types API network errors as transient and applies a request timeout", async () => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ access_token: "fake", expires_in: 3600 }),
    )
    .mockRejectedValueOnce(new TypeError("fetch failed"));
  const api = new ForeverApi({
    clientId: "id",
    clientSecret: "secret",
    region: "eu",
    fetchImpl: f,
  });
  await expect(api.get("/test", "profile")).rejects.toMatchObject({
    status: null,
    phase: "api",
    transient: true,
  });
  expect(f.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
});

it("retries a body stream network error but preserves malformed JSON as fatal", async () => {
  for (const error of [
    new TypeError("terminated"),
    new SyntaxError("bad JSON"),
  ]) {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ access_token: "fake", expires_in: 3600 }),
      )
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        json: async () => {
          throw error;
        },
      });
    const api = new ForeverApi({
      clientId: "id",
      clientSecret: "secret",
      region: "eu",
      fetchImpl: f,
    });
    const request = api.get("/test", "profile");
    if (error instanceof TypeError)
      await expect(request).rejects.toMatchObject({
        transient: true,
        status: null,
      });
    else await expect(request).rejects.toBe(error);
  }
});
