import { describe, expect, it, vi } from "vitest";
import { findCode } from "@/lib/raid";
import { readPlanHash } from "@/lib/talents/import";
import { hasRejectionFragment, readConsent, saveConsent, withRejectionFragment, writeConsent, syncOptionalScripts } from "./consent";

describe("a rejection carried in the address when storage is blocked", () => {
  const blocked = { getItem: () => { throw new Error("blocked"); } };

  it("is read beside a #plan= share code, and the old lone fragment still counts", () => {
    expect(readConsent(blocked, blocked, "#plan=EL1abc&plan2=EL1def&everloot-analytics-rejected", "analytics")).toBe("rejected");
    expect(readConsent(blocked, blocked, "#everloot-analytics-rejected", "analytics")).toBe("rejected");
    expect(readConsent(blocked, blocked, "#plan=EL1abc", "analytics")).toBeNull();
  });

  it("counts only a whole part, never a lookalike inside another one", () => {
    for (const hash of ["#plan=everloot-analytics-rejected", "#everloot-analytics-rejected-x", "#xeverloot-analytics-rejected"]) {
      expect(hasRejectionFragment(hash, "analytics"), hash).toBe(false);
    }
    expect(hasRejectionFragment("#plan=EL1abc&everloot-analytics-rejected", "advertising")).toBe(false);
  });

  it("is added after the share code and taken out again without touching it", () => {
    const withMark = withRejectionFragment("#plan=EL1abc&plan2=EL1def", "analytics", true);
    expect(withMark).toBe("#plan=EL1abc&plan2=EL1def&everloot-analytics-rejected");
    expect(withRejectionFragment(withMark, "analytics", true)).toBe(withMark);
    expect(readPlanHash(withMark)).toMatchObject({ first: "EL1abc", second: "EL1def" });
    expect(withRejectionFragment(withMark, "analytics", false)).toBe("#plan=EL1abc&plan2=EL1def");
    expect(withRejectionFragment("", "analytics", true)).toBe("#everloot-analytics-rejected");
    expect(withRejectionFragment("#everloot-analytics-rejected", "analytics", false)).toBe("");
  });

  it("leaves spend-order parts exactly as they were, wherever the rejection sits", () => {
    const plan = "#plan=EL1abc&plan2=EL1def&order=O1p-AB_c-9&order2=O1g-BAz";
    const withMark = withRejectionFragment(plan, "analytics", true);
    expect(withMark).toBe(`${plan}&everloot-analytics-rejected`);
    expect(withRejectionFragment(withMark, "analytics", false)).toBe(plan);
    // A page that appends its own parts after the rejection keeps them when the rejection comes out.
    expect(withRejectionFragment("#plan=EL1abc&everloot-analytics-rejected&order=O1p-AB_c-9", "analytics", false)).toBe("#plan=EL1abc&order=O1p-AB_c-9");
    expect(hasRejectionFragment(plan, "analytics")).toBe(false);
  });

  it("keeps a raid link readable", () => {
    const raid = "#raid=ELR1-25-1.15.8-abc_DEF";
    expect(findCode(withRejectionFragment(raid, "analytics", true).slice("#raid=".length))).toBe("ELR1-25-1.15.8-abc_DEF");
  });

  it("carries both categories at once, and drops one without the other", () => {
    const both = withRejectionFragment(withRejectionFragment("#plan=EL1abc", "analytics", true), "advertising", true);
    expect(hasRejectionFragment(both, "analytics")).toBe(true);
    expect(hasRejectionFragment(both, "advertising")).toBe(true);
    const one = withRejectionFragment(both, "advertising", false);
    expect(one).toBe("#plan=EL1abc&everloot-analytics-rejected");
  });
});

describe("optional tracking consent", () => {
  it("keeps withdrawal rejected after reload when local writes fail but reads still return accepted", () => {
    const local = { getItem: () => "accepted", setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("blocked"); } };
    const values = new Map<string, string>();
    const session = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    expect(writeConsent("rejected", local, session)).toEqual({ persisted: false, needsRejectionFragment: false });
    const reloadedChoice = readConsent(local, session);
    expect(reloadedChoice).toBe("rejected");
    const doc = { getElementById: () => null, createElement: vi.fn() };
    syncOptionalScripts(reloadedChoice, "ca-pub-test", doc as unknown as Document);
    expect(doc.createElement).not.toHaveBeenCalled();
  });

  it("prioritizes the private rejection fragment if every storage write is blocked", () => {
    const storage = { getItem: () => "accepted", setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(saveConsent("rejected", storage)).toBe(false);
    expect(readConsent(storage, storage, "#everloot-cookie-rejected")).toBe("rejected");
    expect(writeConsent("rejected", storage, storage)).toEqual({ persisted: false, needsRejectionFragment: true });
  });

  it("removes stale acceptance where removal works and clears the session veto on explicit acceptance", () => {
    const local = { getItem: vi.fn(() => "accepted"), setItem: vi.fn((): void => { throw new Error("quota"); }), removeItem: vi.fn() };
    const session = { getItem: () => "rejected", setItem: vi.fn(), removeItem: vi.fn() };
    writeConsent("rejected", local, session);
    expect(local.removeItem).toHaveBeenCalledWith("gg-cookie-consent-v1");
    local.setItem.mockImplementation(() => {});
    expect(writeConsent("accepted", local, session)).toEqual({ persisted: true, needsRejectionFragment: false });
    expect(session.removeItem).toHaveBeenCalledWith("everloot-cookie-rejection");
  });

  it("fails closed when a previously written session veto cannot be read", () => {
    const local = { getItem: () => "accepted" };
    const session = { getItem: () => { throw new Error("blocked"); } };
    expect(readConsent(local, session)).toBeNull();
  });

  it.each([null, "rejected", "invalid"])("does not load tracking for %s", (choice) => {
    const doc = { getElementById: vi.fn(() => null), createElement: vi.fn() };
    syncOptionalScripts(choice as null | "rejected", "ca-pub-test", doc as unknown as Document);
    expect(doc.createElement).not.toHaveBeenCalled();
  });

  it("loads configured ads only after acceptance and does not duplicate them", () => {
    const appendChild = vi.fn();
    const script = {};
    const doc = { getElementById: vi.fn(() => null), createElement: vi.fn(() => script), head: { appendChild } };
    syncOptionalScripts("accepted", "ca-pub-test", doc as unknown as Document);
    expect(script).toMatchObject({ src: "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-test", async: true });
    expect(appendChild).toHaveBeenCalledOnce();
    doc.getElementById.mockReturnValue(script as never);
    syncOptionalScripts("accepted", "ca-pub-test", doc as unknown as Document);
    expect(appendChild).toHaveBeenCalledOnce();
  });

  it("removes the optional script on rejection", () => {
    const remove = vi.fn();
    const doc = { getElementById: () => ({ remove }) };
    syncOptionalScripts("rejected", "ca-pub-test", doc as unknown as Document);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("persists only recognized choices and fails closed when storage is unavailable", () => {
    const storage = { getItem: vi.fn(() => "accepted"), setItem: vi.fn() };
    expect(readConsent(storage)).toBe("accepted");
    saveConsent("rejected", storage);
    expect(storage.setItem).toHaveBeenCalledWith("gg-cookie-consent-v1", "rejected");
    storage.getItem.mockReturnValue("unexpected");
    expect(readConsent(storage)).toBeNull();
    storage.getItem.mockImplementation(() => { throw new Error("blocked"); });
    expect(readConsent(storage)).toBeNull();
    storage.setItem.mockImplementation(() => { throw new Error("blocked"); });
    expect(saveConsent("accepted", storage)).toBe(false);
  });
});
