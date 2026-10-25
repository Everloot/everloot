import { describe, expect, test } from "vitest";
import {
  chatWorkspaceOn, decodeCursor, encodeCursor, parseConversationSave, parseDelete, parseEntrySave, parseImport, parseProjectSave, sameSitePath,
} from "./workspace";

const ACCOUNT = "11111111-2222-4333-8444-555555555555";
const ID = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";
const PROJECT = "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22";
const msg = (over: object = {}) => ({ role: "user", text: "Where does it drop?", at: "2026-10-25T12:00:00.000Z", model: null, sources: [], steps: [], ...over });
const save = (conversation: object, over: object = {}) =>
  parseConversationSave({ expectedAccountId: ACCOUNT, expectedRevision: 0, conversation: { id: ID, title: "Hogger", projectId: null, pinned: false, messages: [msg()], ...conversation }, ...over });
const entry = (e: object, over: object = {}) =>
  parseEntrySave({ expectedAccountId: ACCOUNT, expectedRevision: 0, entry: { id: ID, projectId: null, kind: "note", title: "Plan", buildId: null, href: null, text: "Farm", sources: [], ...e }, ...over });

test("the workspace is off unless EVERLOOT_CHAT_WORKSPACE is exactly 1, whatever saved builds says", () => {
  expect(chatWorkspaceOn({})).toBe(false);
  expect(chatWorkspaceOn({ EVERLOOT_CHAT_WORKSPACE: "true", EVERLOOT_SAVED_BUILDS: "1" })).toBe(false);
  expect(chatWorkspaceOn({ EVERLOOT_CHAT_WORKSPACE: "1" })).toBe(true);
});

describe("projects", () => {
  test("a project is trimmed, and an empty description is none", () => {
    expect(parseProjectSave({ expectedAccountId: ACCOUNT, expectedRevision: 0, project: { id: ID.toUpperCase(), name: "  Raid ", description: "  " } }))
      .toEqual({ ok: true, value: { expectedAccountId: ACCOUNT, expectedRevision: 0, project: { id: ID, name: "Raid", description: null } } });
  });
  test.each([
    ["no name", { name: " " }], ["a long name", { name: "x".repeat(101) }], ["a long description", { description: "x".repeat(1001) }],
    ["a bad id", { id: "nope" }], ["a number description", { description: 5 }],
  ])("%s is refused", (_, over) => {
    const r = parseProjectSave({ expectedAccountId: ACCOUNT, expectedRevision: 0, project: { id: ID, name: "Raid", description: null, ...over } });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
  test.each([-1, 1.5, "1", null, 2 ** 31])("revision %s is refused", (expectedRevision) => {
    expect(parseProjectSave({ expectedAccountId: ACCOUNT, expectedRevision, project: { id: ID, name: "Raid", description: null } }).ok).toBe(false);
  });
  test("without the account it was meant for, nothing is accepted", () => {
    expect(parseProjectSave({ expectedRevision: 0, project: { id: ID, name: "Raid", description: null } }).ok).toBe(false);
  });
});

describe("conversations", () => {
  test("messages keep the known fields only, so nothing else reaches the account", () => {
    const r = save({ messages: [msg({ cardFacts: { name: "Hogger's Trousers" }, item: { id: 2589, name: "x" }, pages: ["/item/2589"], context: "Jaina, a Mage." }),
      msg({ role: "assistant", model: "claude-sonnet-5-5", sources: ["Source: Everloot"], steps: [{ tool: "item_page", input: "{}", chars: 10, extra: 1 }] })] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.conversation.messages).toEqual([
      { role: "user", text: "Where does it drop?", at: "2026-10-25T12:00:00.000Z", model: null, sources: [], steps: [], pages: ["/item/2589"], context: "Jaina, a Mage.", item: { id: 2589 } },
      { role: "assistant", text: "Where does it drop?", at: "2026-10-25T12:00:00.000Z", model: "claude-sonnet-5-5", sources: ["Source: Everloot"], steps: [{ tool: "item_page", input: "{}", chars: 10 }] },
    ]);
  });
  test.each([
    ["a role", { role: "system" }], ["a bad time", { at: "yesterday" }],
    ["a bad model", { model: " drop table" }], ["a non-list of sources", { sources: "x" }], ["a bad item", { item: { id: -1 } }],
    ["a bad step", { steps: [{ tool: "x", input: 5, chars: 1 }] }],
  ])("a message with %s is refused", (_, over) => {
    expect(save({ messages: [msg(over)] })).toMatchObject({ ok: false, status: 400 });
  });
  test("a long message, 201 messages, or more than 1 MiB, are refused as too large", () => {
    expect(save({ messages: [msg({ text: "x".repeat(20001) })] })).toMatchObject({ ok: false, status: 413 });
    expect(save({ messages: Array.from({ length: 201 }, () => msg()) })).toMatchObject({ ok: false, status: 413 });
    expect(save({ messages: Array.from({ length: 60 }, () => msg({ text: "x".repeat(20000) })) })).toMatchObject({ ok: false, status: 413 });
  });
  test("title, project and pinned are checked", () => {
    expect(save({ title: "" }).ok).toBe(false);
    expect(save({ title: "x".repeat(101) }).ok).toBe(false);
    expect(save({ projectId: "x" }).ok).toBe(false);
    expect(save({ pinned: "yes" }).ok).toBe(false);
    expect(save({ projectId: PROJECT, pinned: true })).toMatchObject({ ok: true, value: { conversation: { projectId: PROJECT, pinned: true } } });
  });
});

describe("entries", () => {
  test("each kind carries exactly its own reference", () => {
    expect(entry({ kind: "build", text: null, buildId: ID, title: "" }).ok).toBe(true);
    expect(entry({ kind: "page", text: null, href: "/item/2589?x=1#drops" }).ok).toBe(true);
    expect(entry({ kind: "answer", sources: ["https://everloot.app/npc/448"] }).ok).toBe(true);
    expect(entry({ kind: "build", text: null, buildId: null }).ok).toBe(false);
    expect(entry({ kind: "build", buildId: ID }).ok).toBe(false);
    expect(entry({ kind: "page", text: null, href: null }).ok).toBe(false);
    expect(entry({ kind: "note", text: "  " }).ok).toBe(false);
    expect(entry({ kind: "file" }).ok).toBe(false);
  });
  test("bounds: title, text, sources", () => {
    expect(entry({ title: "x".repeat(101) }).ok).toBe(false);
    expect(entry({ text: "x".repeat(20001) })).toMatchObject({ ok: false, status: 413 });
    expect(entry({ sources: Array.from({ length: 21 }, () => "s") }).ok).toBe(false);
    expect(entry({ sources: ["x".repeat(513)] }).ok).toBe(false);
    expect(entry({ sources: [""] }).ok).toBe(false);
  });
  test.each(["//evil.example/x", "https://evil.example/x", "/\\evil.example", "javascript:alert(1)", "/a b", "/a\nb", "item/1", `/${"x".repeat(2048)}`])(
    "%j is not a same-site page", (href) => {
      expect(sameSitePath(href)).toBe(false);
      expect(entry({ kind: "page", text: null, href }).ok).toBe(false);
    });
});

test("import takes one browser chat with its source and local id", () => {
  const body = { expectedAccountId: ACCOUNT, sourceId: ID, legacyId: "k3x9", conversation: { title: "Old chat", messages: [msg()] } };
  expect(parseImport(body)).toMatchObject({ ok: true, value: { sourceId: ID, legacyId: "k3x9", conversation: { title: "Old chat" } } });
  expect(parseImport({ ...body, sourceId: "x" }).ok).toBe(false);
  expect(parseImport({ ...body, legacyId: "" }).ok).toBe(false);
  expect(parseImport({ ...body, legacyId: "x".repeat(201) }).ok).toBe(false);
  expect(parseImport({ ...body, conversation: { title: "Old chat", messages: [msg({ role: "tool" })] } }).ok).toBe(false);
});

test("a delete names the account and the revision it saw", () => {
  expect(parseDelete({ expectedAccountId: ACCOUNT, expectedRevision: 3 })).toEqual({ ok: true, value: { expectedAccountId: ACCOUNT, expectedRevision: 3 } });
  expect(parseDelete({ expectedAccountId: ACCOUNT, expectedRevision: 0 }).ok).toBe(false);
  expect(parseDelete({ expectedRevision: 3 }).ok).toBe(false);
});

test("a cursor round-trips, and anything else is refused", () => {
  const at = "2026-10-25T12:00:00.123Z";
  expect(decodeCursor(encodeCursor([true, at, ID]), true)).toEqual([true, at, ID]);
  expect(decodeCursor(encodeCursor([at, ID]), false)).toEqual([at, ID]);
  expect(decodeCursor(encodeCursor([at, ID]), true)).toBeNull();
  expect(decodeCursor("nope", false)).toBeNull();
  expect(decodeCursor(encodeCursor(["soon", ID]), false)).toBeNull();
});
