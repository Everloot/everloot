import { expect, test } from "vitest";
import { deployEnv, deployedCommit, edgeClientIp, onTrustedEdge } from "./platform";

const req = (headers: Record<string, string>) => new Request("https://everloot.app/x", { headers });

test("on Vercel the client address is the one Vercel's edge sets, never a header the caller can send", () => {
  const env = { VERCEL: "1" };
  expect(edgeClientIp(req({ "x-vercel-forwarded-for": "203.0.113.5", "cf-connecting-ip": "198.51.100.9" }), env)).toBe("203.0.113.5");
  expect(edgeClientIp(req({ "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "198.51.100.10" }), env)).toBeNull();
});

test("on the Cloudflare Worker the client address is cf-connecting-ip, and a forged Vercel header is ignored", () => {
  const env = { EVERLOOT_PLATFORM: "cloudflare" };
  expect(edgeClientIp(req({ "cf-connecting-ip": "198.51.100.9", "x-vercel-forwarded-for": "203.0.113.5" }), env)).toBe("198.51.100.9");
  expect(edgeClientIp(req({ "x-vercel-forwarded-for": "203.0.113.5" }), env)).toBeNull();
});

test("anywhere else no header is trusted", () => {
  expect(edgeClientIp(req({ "x-vercel-forwarded-for": "203.0.113.5", "cf-connecting-ip": "198.51.100.9" }), {})).toBeNull();
  expect(onTrustedEdge({})).toBe(false);
  expect(onTrustedEdge({ VERCEL: "1" })).toBe(true);
  expect(onTrustedEdge({ EVERLOOT_PLATFORM: "cloudflare" })).toBe(true);
});

test("the deploy environment and commit come from Vercel's names, or the Worker's", () => {
  expect(deployEnv({ VERCEL_ENV: "production" })).toBe("production");
  expect(deployEnv({ EVERLOOT_DEPLOY_ENV: "preview" })).toBe("preview");
  expect(deployEnv({})).toBeUndefined();
  expect(deployedCommit({ VERCEL_GIT_COMMIT_SHA: "abc1234" })).toBe("abc1234");
  expect(deployedCommit({ EVERLOOT_COMMIT_SHA: "def5678" })).toBe("def5678");
  expect(deployedCommit({})).toBeUndefined();
});
