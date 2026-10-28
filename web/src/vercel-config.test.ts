import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(join(__dirname, "..", "vercel.json"), "utf8")) as { ignoreCommand: string };

// vercel.json's ignoreCommand replaces the dashboard's "Ignored Build Step"; exit 0 skips the build, 1 builds.
describe("vercel.json ignoreCommand", () => {
  // Deliberate and unchanged from the dashboard command: an ordinary PR branch (feat/*, fix/*) gets NO Vercel preview
  // build. Only main and preview/* build. To get a preview for a PR, push it to (or also as) a preview/* branch.
  // CI still runs the checks on every PR.
  it("builds only main and preview/* branches", () => {
    expect(config.ignoreCommand).toMatch(/^case "\$VERCEL_GIT_COMMIT_REF" in main\|preview\/\*\) ;; \*\) exit 0;; esac;/);
  });

  it("builds when the previous commit is unknown", () => {
    expect(config.ignoreCommand).toContain('git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA^{commit}" 2>/dev/null || exit 1;');
  });

  it("watches the web app, the kb and the packages, but not tests or the web notes", () => {
    expect(config.ignoreCommand).toContain("-- . ../kb ../packages");
    for (const skip of ["**/*.test.ts", "**/*.test.tsx", "web/README.md", "web/NEXT_STEPS.md"]) expect(config.ignoreCommand).toContain(skip);
  });
});
