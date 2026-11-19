import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The shared parser and intake schemas live in web/src and import zod from web's install, and the
// knowledge code through web's `@kb/` path alias.
export default defineConfig({
  resolve: { alias: { zod: fileURLToPath(new URL("../web/node_modules/zod", import.meta.url)), "@kb": fileURLToPath(new URL("../kb/src", import.meta.url)) } },
});
