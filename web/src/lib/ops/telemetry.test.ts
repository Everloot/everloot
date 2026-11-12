import { expect, test, vi } from "vitest";
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));
vi.mock("@/lib/supabase/server", () => ({ authQuery: vi.fn() }));
import { writeIntakeTelemetry, outcomeReason } from "./telemetry";
test("records successful no-new-corpus receipts with server pseudonyms and no raw install identifiers", async () => {
  const query = vi.fn().mockResolvedValue(undefined);
  await writeIntakeTelemetry({ reason: "accepted", installId: "synthetic-only-install", records: 0, realms: ["CAMWOW US1 Realm 4 PvP"], kinds: ["player_seen"] },
    { env: { EVERLOOT_OPS_METRICS: "1", EVERLOOT_OPS_HMAC_SECRET: "synthetic-secret" }, query });
  expect(query).toHaveBeenCalledOnce();
  const body = JSON.parse(query.mock.calls[0][1].body);
  expect(body.p_install_key).toMatch(/^[a-f0-9]{64}$/);
  expect(body.p_records).toBe(0);
  expect(query.mock.calls[0][1].body).not.toContain("synthetic-only-install");
});
test("instrumentation errors cannot fail the intake request and outcomes use finite codes", async () => {
  const query = vi.fn().mockRejectedValue(new Error("offline"));
  await expect(writeIntakeTelemetry({ reason: "storage_failure" }, { env: { EVERLOOT_OPS_METRICS: "1" }, query })).resolves.toBeUndefined();
  expect(outcomeReason(429)).toBe("limited");
  expect(outcomeReason(422)).toBe("validation");
});
