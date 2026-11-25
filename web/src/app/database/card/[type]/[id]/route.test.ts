import { expect, test } from "vitest";
import { GET as moved } from "@/app/card/[type]/[id]/route";
import { GET } from "./route";

// The card moved to /card; pages cached before the move still ask the old path and get the same handler.
test("the old /database/card path answers with the /card handler", () => {
  expect(GET).toBe(moved);
});
