import { isDeepStrictEqual } from "node:util";
import { expect, test } from "vitest";
import layerJson from "../../web/src/data/game-data/client-layer.json" with { type: "json" };
import { ClientLayer } from "../src/client-layer.js";
import { CLIENT_LAYER } from "../src/client-layer-file.js";

test("the committed client layer passes the schema, and parsing it changes nothing, so the site can read it as it is", () => {
  const parsed = ClientLayer.parse(layerJson);
  // No default, transform or stripped key: the file read without parsing is exactly what the schema would give.
  expect(isDeepStrictEqual(parsed, layerJson)).toBe(true);
  expect(CLIENT_LAYER).toBe(layerJson);
});
