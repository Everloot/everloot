import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `@/` is a tsconfig path alias; the app bundler resolves it, vitest needs it too.
export default defineConfig({
  // Next preserves JSX for its own compiler; component tests need a transform.
  oxc: { jsx: { runtime: "automatic" } },
  // The first test in a file pays its cold imports (the MCP SDK, the social-card renderer), over a
  // second even when warm. On a busy machine, e.g. during `next build`, that can pass the 5 s default.
  // better-auth loads next/headers itself (nextCookies); inlining it lets a test mock that module.
  test: { testTimeout: 15_000, setupFiles: ["./vitest.setup.ts"], server: { deps: { inline: ["better-auth"] } } },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
