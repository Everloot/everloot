/**
 * Speech-to-text for the Chat composer through the browser's own SpeechRecognition
 * (developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition). The browser may send the audio to its speech
 * service; Everloot never sees, stores or uploads it. Only final transcripts reach the draft, which the player
 * reviews and sends themselves.
 */

/** The part of a recognition `result` event that is read: results from `resultIndex` on changed. */
export type RecognitionResults = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

/** The part of a SpeechRecognition instance that is used. */
export type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionResults) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type RecognitionWindow = { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };

/** The browser's recognition constructor (Chrome and Safari still prefix it), or null without one. */
export function speechRecognition(win: RecognitionWindow | undefined): (new () => Recognition) | null {
  return win?.SpeechRecognition ?? win?.webkitSpeechRecognition ?? null;
}

/** The final transcripts this event adds. `seen` holds the result indexes already taken, so a repeated final event adds nothing. */
export function finalSegments(e: RecognitionResults, seen: Set<number>): string[] {
  const out: string[] = [];
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const r = e.results[i]!;
    if (!r.isFinal || seen.has(i)) continue;
    seen.add(i);
    const text = r[0]?.transcript.trim();
    if (text) out.push(text);
  }
  return out;
}

/** The draft with the words added after it, within `limit` characters. What the player typed stays as it is. */
export function appendSegment(draft: string, segment: string, limit: number): { value: string; truncated: boolean } {
  const joined = draft === "" || /\s$/.test(draft) ? draft + segment : `${draft} ${segment}`;
  return joined.length > limit ? { value: joined.slice(0, Math.max(limit, draft.length)), truncated: true } : { value: joined, truncated: false };
}

const LANGUAGES = ["en-US", "en-GB", "es-ES", "es-MX", "es-US", "pt-BR", "fr-FR", "de-DE", "it-IT", "ru-RU", "ko-KR", "zh-CN"];

/** The languages offered, the browser's own first. */
export function dictationLanguages(browser: string | undefined): string[] {
  return [...new Set([browser || "en-US", ...LANGUAGES])];
}

/** What to tell the player when recognition fails; null for an abort Everloot asked for. */
export function dictationError(code: string): string | null {
  switch (code) {
    case "aborted": return null;
    case "not-allowed":
    case "service-not-allowed": return "Microphone access was blocked, so dictation stopped. Your draft is unchanged; you can keep typing.";
    case "no-speech": return "No speech was heard. Your draft is unchanged.";
    case "audio-capture": return "No microphone was found. Your draft is unchanged; you can keep typing.";
    case "network": return "The browser's speech service couldn't be reached. Your draft is unchanged; you can keep typing.";
    case "language-not-supported": return "The browser can't recognize that language. Your draft is unchanged.";
    default: return "Dictation stopped because of an error. Your draft is unchanged; you can keep typing.";
  }
}
