import { expect, test } from "vitest";
import {
  deleteConversation, keyReady, loadConversations, loadProviders, maskKey, pickModel, recordCheck, removeProvider, saveConversation, saveProvider,
  setDefault, setModel, titleFor,
  type ChatMessage,
} from "./store";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}
const OR = "sk-or-v1-example-example-example-example";
const ANT = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";

test("providers are kept per kind, the latest saved first, and a saved key survives a model change", () => {
  const s = memory();
  saveProvider(s, { kind: "openrouter", model: "deepseek/deepseek-v4.1-flash", key: ` ${OR} ` });
  saveProvider(s, { kind: "anthropic", model: "claude-sonnet-5-5", key: ANT });
  expect(loadProviders(s).map((p) => p.kind)).toEqual(["anthropic", "openrouter"]);
  saveProvider(s, { kind: "openrouter", model: "qwen/qwen3.7-flash" });
  expect(loadProviders(s)[0]).toEqual({ kind: "openrouter", model: "qwen/qwen3.7-flash", key: OR });
  expect(pickModel(s, "anthropic", "claude-haiku-5-5")[0]).toEqual({ kind: "anthropic", model: "claude-haiku-5-5", key: ANT });
  expect(removeProvider(s, "anthropic").map((p) => p.kind)).toEqual(["openrouter"]);
  removeProvider(s, "openrouter");
  expect(s.m.size).toBe(0);
});

test("bad pastes and unsaved providers are refused before anything is written", () => {
  const s = memory();
  expect(() => saveProvider(s, { kind: "anthropic", model: "claude-sonnet-5-5", key: "hunter2" })).toThrow(/sk-ant-/);
  expect(() => saveProvider(s, { kind: "openrouter", model: "x", key: "" })).toThrow(/Paste the key first/);
  expect(() => saveProvider(s, { kind: "ollama", model: "" })).toThrow(/Pick or type a model/);
  expect(() => saveProvider(s, { kind: "nope" as never, model: "m" })).toThrow(/Pick a provider/);
  expect(() => pickModel(s, "anthropic", "claude-haiku-5-5")).toThrow(/not saved/);
  expect(s.m.size).toBe(0);
  expect(saveProvider(s, { kind: "ollama", model: "qwen3:8b" })[0]).toEqual({ kind: "ollama", model: "qwen3:8b", key: "" });
});

const msg = (text: string, role: "user" | "assistant" = "user"): ChatMessage => ({ role, text, at: "2026-10-20T10:00:00.000Z", model: null, sources: [], steps: [] });

test("damaged storage reads as empty, and a conversation keeps the newest sixty messages", () => {
  const s = memory();
  s.setItem("everloot.chat.providers.v1", "{not json");
  s.setItem("everloot.chat.conversations.v1", JSON.stringify([{ id: "a", messages: [{ role: "system", text: "x" }] }, null, { id: 3 }]));
  expect(loadProviders(s)).toEqual([]);
  expect(loadConversations(s)).toEqual([]);
  saveConversation(s, { id: "a", title: "", updatedAt: "", messages: Array.from({ length: 70 }, (_, i) => msg(`m${i}`)) });
  expect(loadConversations(s)[0].messages.map((m) => m.text)[0]).toBe("m10");
  saveConversation(s, { id: "a", title: "", updatedAt: "", messages: [] });
  expect(s.m.has("everloot.chat.conversations.v1")).toBe(false);
});

test("conversations: newest first, titled by their first question, deletable; the old single thread moves in", () => {
  const s = memory();
  s.setItem("everloot.chat.thread.v1", JSON.stringify([msg("Who is Leeroy Jenkins?"), msg("A paladin.", "assistant")]));
  const migrated = loadConversations(s);
  expect(migrated.map((c) => c.title)).toEqual(["Who is Leeroy Jenkins?"]);
  expect(s.m.has("everloot.chat.thread.v1")).toBe(false);
  saveConversation(s, { id: "b", title: "", updatedAt: "", messages: [msg(`  Where does   Linen Cloth drop? ${"x".repeat(80)}`)] });
  const list = loadConversations(s);
  expect(list.map((c) => c.id)).toEqual(["b", migrated[0].id]);
  expect(list[0].title).toMatch(/^Where does Linen Cloth drop\? x+…$/);
  expect(list[0].title).toHaveLength(60);
  // Saving an older conversation again brings it to the top.
  expect(saveConversation(s, { ...migrated[0], messages: [...migrated[0].messages, msg("And Onyxia?")] }).map((c) => c.id)).toEqual([migrated[0].id, "b"]);
  expect(deleteConversation(s, "b").map((c) => c.id)).toEqual([migrated[0].id]);
  deleteConversation(s, migrated[0].id);
  expect(s.m.size).toBe(0);
  expect(titleFor([])).toBe("New chat");
});

test("a key counts as ready once any provider is saved, and the list shows only its last four characters", () => {
  expect(keyReady([])).toBe(false);
  expect(keyReady([{ kind: "ollama", model: "qwen3:8b", key: "" }])).toBe(true);
  expect(maskKey(OR)).toBe("ending ••••mple");
  expect(maskKey("")).toBe("no key needed");
});

test("the account page's cards: a new provider keeps the default, the model changes in place, the default is chosen apart", () => {
  const s = memory();
  saveProvider(s, { kind: "openrouter", model: "deepseek/deepseek-v4.1-flash", key: OR }, { asDefault: false });
  saveProvider(s, { kind: "anthropic", model: "claude-sonnet-5-5", key: ANT }, { asDefault: false });
  expect(loadProviders(s).map((p) => p.kind)).toEqual(["openrouter", "anthropic"]);
  expect(setModel(s, "anthropic", "claude-haiku-5-5").map((p) => [p.kind, p.model])).toEqual([["openrouter", "deepseek/deepseek-v4.1-flash"], ["anthropic", "claude-haiku-5-5"]]);
  expect(setDefault(s, "anthropic").map((p) => p.kind)).toEqual(["anthropic", "openrouter"]);
  // Replacing a key in place keeps the order.
  saveProvider(s, { kind: "openrouter", model: "deepseek/deepseek-v4.1-flash", key: `${OR}x` }, { asDefault: false });
  expect(loadProviders(s).map((p) => p.kind)).toEqual(["anthropic", "openrouter"]);
  expect(() => setModel(s, "ollama", "qwen3:8b")).toThrow(/not saved/);
  expect(() => setModel(s, "anthropic", "bad model id")).toThrow(/model id/);
  expect(() => setDefault(s, "ollama")).toThrow(/not saved/);
});

test("a Test's result is kept with the key, and forgotten when the key changes", () => {
  const s = memory();
  saveProvider(s, { kind: "openrouter", model: "deepseek/deepseek-v4.1-flash", key: OR });
  expect(recordCheck(s, "openrouter", false, "2026-10-20T10:00:00.000Z")[0].check).toEqual({ ok: false, at: "2026-10-20T10:00:00.000Z" });
  expect(loadProviders(s)[0].check).toEqual({ ok: false, at: "2026-10-20T10:00:00.000Z" });
  // A model change keeps it; a new key drops it.
  expect(saveProvider(s, { kind: "openrouter", model: "qwen/qwen3.7-flash" })[0].check?.ok).toBe(false);
  expect(saveProvider(s, { kind: "openrouter", model: "qwen/qwen3.7-flash", key: `${OR}x` })[0]).not.toHaveProperty("check");
  // An unsaved provider records nothing; a damaged check is dropped on read.
  expect(recordCheck(s, "anthropic", true)).toHaveLength(1);
  s.setItem("everloot.chat.providers.v1", JSON.stringify([{ kind: "openrouter", model: "m", key: OR, check: { ok: "yes" } }]));
  expect(loadProviders(s)[0]).toEqual({ kind: "openrouter", model: "m", key: OR });
});

test("an answer keeps its item as a reference only; older answers without one read as before", () => {
  const s = memory();
  const at = "2026-10-25T00:00:00.000Z";
  const base = { role: "assistant" as const, text: "a", at, model: null, sources: [], steps: [] };
  saveConversation(s, { id: "c", title: "", updatedAt: at, messages: [
    { role: "user", text: "Where does Linen Cloth drop?", at, model: null, sources: [], steps: [] },
    { ...base, item: { id: 2589, label: "Linen Cloth", lines: ["Sell Price 13c"] } as never },
    { ...base, item: { query: "Linen" } },
    { ...base, item: { id: "x" } as never },
    base,
  ] });
  const stored = s.m.get("everloot.chat.conversations.v1")!;
  expect(stored).not.toContain("Sell Price");
  expect(stored).not.toContain("\"label\"");
  const [, exact, choices, broken, old] = loadConversations(s)[0].messages;
  expect(exact.item).toEqual({ id: 2589 });
  expect(choices.item).toEqual({ query: "Linen" });
  expect(broken).not.toHaveProperty("item");
  expect(old).not.toHaveProperty("item");
});
