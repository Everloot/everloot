import { afterEach, expect, test, vi } from "vitest";
import { REPO_URL, deployedSha, sourceUrl } from "./source";

afterEach(() => vi.unstubAllEnvs());

test("the deployed commit is Vercel's, or the Cloudflare Worker's, and only a well-formed one", () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
  vi.stubEnv("EVERLOOT_COMMIT_SHA", "abc1234");
  expect(deployedSha()).toBe("abc1234");
  expect(sourceUrl()).toBe(`${REPO_URL}/tree/abc1234`);
  vi.stubEnv("EVERLOOT_COMMIT_SHA", "not a sha");
  expect(deployedSha()).toBeUndefined();
  expect(sourceUrl()).toBe(REPO_URL);
});
