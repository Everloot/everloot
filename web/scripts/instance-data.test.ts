import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { renderInstanceData } from "./build-instance-data";
import { LOCAL_ONLY_KINDS, prepareUpload } from "../src/lib/upload-batches";

test("the shipped Collection table matches the dated agreement snapshot and game files", () => {
  const lua = readFileSync(new URL("../../addon/modules/instance_data.lua", import.meta.url), "utf8");
  expect(lua.replace(/\r\n/g, "\n")).toBe(renderInstanceData());
  expect(lua).not.toContain("id = 2720,");
  expect(lua).not.toContain("id = 36, name =");
  expect(lua).toContain("unconfirmed = true");
});

test("boss kill history stays out of public uploads", () => {
  expect(LOCAL_ONLY_KINDS).toContain("boss_kill_owned");
  expect(prepareUpload({ addonVersion: "0.3.22", records: [{ kind: "boss_kill_owned", encounterId: 3026 }] }, {}, []).batches).toEqual([]);
});
