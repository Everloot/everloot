import { expect, test } from "vitest";
import { deployEnv, deployedCommit, edgeClientIp, onTrustedEdge } from "./platform";

const req = (headers: Record<string, string>) => new Request("https://everloot.app/x", { headers });

test("on the Cloudflare Worker the client address is cf-connecting-ip, never a header the caller can send", () => {
  const env = { EVERLOOT_PLATFORM: "cloudflare" };
  expect(edgeClientIp(req({ "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "203.0.113.5" }), env)).toBe("198.51.100.9");
  expect(edgeClientIp(req({ "x-forwarded-for": "203.0.113.5", "x-real-ip": "203.0.113.6" }), env)).toBeNull();
});

test("anywhere else no header is trusted", () => {
  expect(edgeClientIp(req({ "cf-connecting-ip": "198.51.100.9" }), {})).toBeNull();
  expect(edgeClientIp(req({ "cf-connecting-ip": "198.51.100.9" }), { VERCEL: "1" })).toBeNull();
  expect(onTrustedEdge({})).toBe(false);
  expect(onTrustedEdge({ VERCEL: "1" })).toBe(false);
  expect(onTrustedEdge({ EVERLOOT_PLATFORM: "cloudflare" })).toBe(true);
});

test("the deploy environment and commit come from the Worker's names", () => {
  expect(deployEnv({ EVERLOOT_DEPLOY_ENV: "preview" })).toBe("preview");
  expect(deployEnv({ VERCEL_ENV: "production" })).toBeUndefined();
  expect(deployEnv({})).toBeUndefined();
  expect(deployedCommit({ EVERLOOT_COMMIT_SHA: "def5678" })).toBe("def5678");
  expect(deployedCommit({ VERCEL_GIT_COMMIT_SHA: "abc1234" })).toBeUndefined();
  expect(deployedCommit({})).toBeUndefined();
});
