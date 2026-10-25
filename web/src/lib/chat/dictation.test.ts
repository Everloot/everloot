import { describe, expect, test } from "vitest";
import { appendSegment, dictationError, dictationLanguages, finalSegments, speechRecognition, type RecognitionResults } from "./dictation";

/** A recognition `result` event's shape: results from `resultIndex` on are the ones this event changed. */
function results(resultIndex: number, list: { text: string; final: boolean }[]): RecognitionResults {
  const items = list.map(({ text, final }) => Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal: final }));
  return { resultIndex, results: Object.assign(items, { item: (i: number) => items[i]! }) };
}

describe("speechRecognition", () => {
  test("uses the standard constructor, then the prefixed one, and reports none without either", () => {
    class Std {}
    class Webkit {}
    expect(speechRecognition({ SpeechRecognition: Std, webkitSpeechRecognition: Webkit } as never)).toBe(Std);
    expect(speechRecognition({ webkitSpeechRecognition: Webkit } as never)).toBe(Webkit);
    expect(speechRecognition({} as never)).toBeNull();
    expect(speechRecognition(undefined)).toBeNull();
  });
});

describe("finalSegments", () => {
  test("takes each final result once, skips interim ones and a repeated final event", () => {
    const seen = new Set<number>();
    expect(finalSegments(results(0, [{ text: "where does", final: false }]), seen)).toEqual([]);
    expect(finalSegments(results(0, [{ text: "where does linen drop", final: true }]), seen)).toEqual(["where does linen drop"]);
    // The same final result reported again (some browsers do) adds nothing.
    expect(finalSegments(results(0, [{ text: "where does linen drop", final: true }]), seen)).toEqual([]);
    expect(finalSegments(results(1, [{ text: "where does linen drop", final: true }, { text: " in Elwynn ", final: true }]), seen)).toEqual(["in Elwynn"]);
  });

  test("ignores empty transcripts", () => {
    expect(finalSegments(results(0, [{ text: "   ", final: true }]), new Set())).toEqual([]);
  });
});

describe("appendSegment", () => {
  test("adds the words after the draft with one space, and keeps the draft as typed", () => {
    expect(appendSegment("", "hello", 2000)).toEqual({ value: "hello", truncated: false });
    expect(appendSegment("Where is", "Hogger", 2000)).toEqual({ value: "Where is Hogger", truncated: false });
    expect(appendSegment("Line one\n", "two", 2000)).toEqual({ value: "Line one\ntwo", truncated: false });
    expect(appendSegment("ends with space ", "next", 2000)).toEqual({ value: "ends with space next", truncated: false });
  });

  test("stops at the composer's limit and says so", () => {
    expect(appendSegment("abcd", "efgh", 7)).toEqual({ value: "abcd ef", truncated: true });
    expect(appendSegment("abcdefg", "more", 7)).toEqual({ value: "abcdefg", truncated: true });
  });
});

describe("dictationLanguages", () => {
  test("starts with the browser's language and lists it once", () => {
    const langs = dictationLanguages("es-PR");
    expect(langs[0]).toBe("es-PR");
    expect(langs).toContain("en-US");
    expect(dictationLanguages("en-US").filter((l) => l === "en-US")).toHaveLength(1);
    expect(dictationLanguages(undefined)[0]).toBe("en-US");
  });
});

describe("dictationError", () => {
  test("a refused microphone and other failures say the draft is kept; our own abort says nothing", () => {
    expect(dictationError("not-allowed")).toMatch(/microphone/i);
    expect(dictationError("service-not-allowed")).toMatch(/microphone|speech service/i);
    for (const code of ["not-allowed", "no-speech", "audio-capture", "network", "something-new"]) expect(dictationError(code), code).toMatch(/draft/i);
    expect(dictationError("aborted")).toBeNull();
  });
});
