// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Recognition, RecognitionResults } from "@/lib/chat/dictation";
import DictationButton from "./Dictation";

/** A simulated SpeechRecognition: no microphone, the test plays its events. */
class FakeRecognition implements Recognition {
  static made: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = true;
  maxAlternatives = 0;
  onresult: Recognition["onresult"] = null;
  onerror: Recognition["onerror"] = null;
  onend: Recognition["onend"] = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn(() => this.onend?.());
  private list: { text: string; final: boolean }[] = [];
  constructor() { FakeRecognition.made.push(this); }
  /** Sets result `i` and fires a result event from it. */
  say(i: number, text: string, final = true) {
    this.list[i] = { text, final };
    const items = this.list.map((r) => Object.assign([{ transcript: r.text }], { isFinal: r.final }));
    act(() => this.onresult?.({ resultIndex: i, results: items } as RecognitionResults));
  }
  fail(error: string) { act(() => { this.onerror?.({ error }); this.onend?.(); }); }
}

let root: Root;
let host: HTMLDivElement;
let draft: () => string;
let setDraft: (v: string) => void;
let submits: number;

function Harness({ initial = "", sessionKey = "a", disabled = false }: { initial?: string; sessionKey?: string; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  draft = () => value;
  setDraft = setValue;
  return (
    <form onSubmit={(e) => { e.preventDefault(); submits++; }}>
      <DictationButton value={value} onChange={setValue} disabled={disabled} sessionKey={sessionKey} />
    </form>
  );
}

function render(props: Parameters<typeof Harness>[0] = {}) {
  act(() => root.render(<Harness {...props} />));
}

const button = (name: RegExp) => [...host.querySelectorAll("button")].find((b) => name.test(b.textContent ?? "") || name.test(b.getAttribute("aria-label") ?? ""));
const click = (name: RegExp) => { const b = button(name); if (!b) throw new Error(`No button ${name}`); act(() => b.click()); };
const status = () => host.querySelector('[role="status"]')?.textContent ?? "";
const language = () => host.querySelector("select") as HTMLSelectElement;
const rec = () => FakeRecognition.made.at(-1)!;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  FakeRecognition.made = [];
  submits = 0;
  vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("without browser recognition it says so and leaves typing as the way in", () => {
  vi.stubGlobal("webkitSpeechRecognition", undefined);
  render({ initial: "typed" });
  click(/dictate/i);
  expect(host.textContent).toMatch(/isn.t available in this browser/i);
  expect(host.textContent).toMatch(/keep typing/i);
  expect(button(/start listening/i)).toBeUndefined();
  expect(draft()).toBe("typed");
});

test("it explains the speech service before any listening, and starts only on a click", () => {
  render();
  expect(FakeRecognition.made).toHaveLength(0);
  click(/dictate/i);
  expect(host.textContent).toMatch(/browser may send your audio to its speech service/i);
  expect(host.textContent).not.toMatch(/on-device|offline/i);
  expect(FakeRecognition.made).toHaveLength(0);
  click(/start listening/i);
  expect(FakeRecognition.made).toHaveLength(1);
  expect(rec().start).toHaveBeenCalledTimes(1);
  expect(rec().interimResults).toBe(false);
  expect(status()).toMatch(/listening/i);
  expect(button(/stop listening/i)).toBeDefined();
});

test("the language starts as the browser's and the chosen one is used", () => {
  vi.spyOn(navigator, "language", "get").mockReturnValue("es-PR");
  render();
  click(/dictate/i);
  expect(language().value).toBe("es-PR");
  act(() => { language().value = "en-GB"; language().dispatchEvent(new Event("change", { bubbles: true })); });
  click(/start listening/i);
  expect(rec().lang).toBe("en-GB");
  expect(language().disabled).toBe(true);
});

test("final words are added once after the draft, interim words never, and typed edits stay", () => {
  render({ initial: "Where is" });
  click(/dictate/i);
  click(/start listening/i);
  rec().say(0, "Hog", false);
  expect(draft()).toBe("Where is");
  rec().say(0, "Hogger", true);
  expect(draft()).toBe("Where is Hogger");
  rec().say(0, "Hogger", true);
  expect(draft()).toBe("Where is Hogger");
  // The player edits while still listening; the next words land after the edit.
  act(() => setDraft("Where is Hogger exactly?"));
  rec().say(1, "in Elwynn", true);
  expect(draft()).toBe("Where is Hogger exactly? in Elwynn");
});

test("Stop ends listening, nothing restarts, and nothing is sent", () => {
  render({ initial: "keep" });
  click(/dictate/i);
  click(/start listening/i);
  click(/stop listening/i);
  expect(rec().stop).toHaveBeenCalledTimes(1);
  expect(status()).not.toMatch(/listening/i);
  expect(FakeRecognition.made).toHaveLength(1);
  expect(rec().start).toHaveBeenCalledTimes(1);
  expect(submits).toBe(0);
  for (const b of host.querySelectorAll("button")) expect(b.type).toBe("button");
  expect(draft()).toBe("keep");
});

test("a refused microphone keeps the draft, says why, and does not retry", () => {
  render({ initial: "my draft" });
  click(/dictate/i);
  click(/start listening/i);
  rec().fail("not-allowed");
  expect(draft()).toBe("my draft");
  expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/microphone access was blocked/i);
  expect(rec().start).toHaveBeenCalledTimes(1);
  expect(FakeRecognition.made).toHaveLength(1);
  expect(button(/start listening/i)).toBeDefined();
});

test("a start that throws keeps the draft and reports it", () => {
  render({ initial: "my draft" });
  click(/dictate/i);
  const original = FakeRecognition.made.length;
  vi.stubGlobal("webkitSpeechRecognition", class extends FakeRecognition { start = vi.fn(() => { throw new Error("busy"); }); });
  click(/start listening/i);
  expect(FakeRecognition.made.length).toBe(original + 1);
  expect(draft()).toBe("my draft");
  expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/draft is unchanged/i);
  expect(status()).not.toMatch(/listening/i);
});

test("words past the composer's 2000-character limit are dropped, listening stops and it says so", () => {
  const initial = "x".repeat(1995);
  render({ initial });
  click(/dictate/i);
  click(/start listening/i);
  rec().say(0, "hello world", true);
  expect(draft()).toBe(`${initial} hell`);
  expect(draft()).toHaveLength(2000);
  expect(rec().abort).toHaveBeenCalled();
  expect(host.textContent).toMatch(/2,000-character limit/i);
});

test("switching conversation stops listening and later words go nowhere", () => {
  render({ initial: "first", sessionKey: "a" });
  click(/dictate/i);
  click(/start listening/i);
  const first = rec();
  render({ initial: "first", sessionKey: "b" });
  expect(first.abort).toHaveBeenCalledTimes(1);
  first.say(0, "late words", true);
  expect(draft()).toBe("first");
  expect(status()).not.toMatch(/listening/i);
  expect(FakeRecognition.made).toHaveLength(1);
});

test("being disabled (an answer is being sent) stops listening and disables the controls", () => {
  render({ initial: "q" });
  click(/dictate/i);
  click(/start listening/i);
  const r = rec();
  render({ initial: "q", disabled: true });
  expect(r.abort).toHaveBeenCalledTimes(1);
  r.say(0, "more", true);
  expect(draft()).toBe("q");
  expect(button(/dictate/i)!.disabled).toBe(true);
  expect(FakeRecognition.made).toHaveLength(1);
});

test("unmounting stops listening", () => {
  render();
  click(/dictate/i);
  click(/start listening/i);
  const r = rec();
  act(() => root.render(<form />));
  expect(r.abort).toHaveBeenCalledTimes(1);
  expect(r.onresult).toBeNull();
});

test("late queued callbacks cannot add words to a different conversation's draft", () => {
  render({ initial: "first", sessionKey: "a" });
  click(/dictate/i); click(/start listening/i);
  const late = rec().onresult!;
  render({ sessionKey: "b" });
  act(() => setDraft("new conversation"));
  act(() => late({ resultIndex: 0, results: [Object.assign([{ transcript: "old words" }], { isFinal: true })] }));
  expect(draft()).toBe("new conversation");
});

test("closing the panel aborts listening instead of hiding Stop", () => {
  render(); click(/dictate/i); click(/start listening/i);
  const r = rec(); click(/dictate/i);
  expect(r.abort).toHaveBeenCalledTimes(1);
  expect(r.onresult).toBeNull();
});

test("Stop disconnects results immediately even when the browser ends asynchronously", () => {
  render({ initial: "keep" }); click(/dictate/i); click(/start listening/i);
  const r = rec(); r.stop = vi.fn();
  click(/stop listening/i);
  r.say(0, "late words");
  expect(draft()).toBe("keep");
  expect(status()).not.toMatch(/listening/i);
});

test("an error stops the recognizer without waiting for a later end event", () => {
  render(); click(/dictate/i); click(/start listening/i);
  const r = rec(); act(() => r.onerror?.({ error: "network" }));
  expect(r.abort).toHaveBeenCalledTimes(1);
  expect(status()).not.toMatch(/listening/i);
});

test("an unavailable constructor leaves the draft and gives the typing fallback", () => {
  render({ initial: "keep" }); click(/dictate/i);
  vi.stubGlobal("webkitSpeechRecognition", class { constructor() { throw new Error("unavailable"); } });
  expect(() => click(/start listening/i)).not.toThrow();
  expect(draft()).toBe("keep");
  expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/keep typing/i);
});
