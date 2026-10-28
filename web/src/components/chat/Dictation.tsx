"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { appendSegment, dictationError, dictationLanguages, finalSegments, speechRecognition, type Recognition } from "@/lib/chat/dictation";

/** The composer's own maxLength. */
const LIMIT = 2000;
const chip = "inline-flex min-h-8 items-center gap-1 rounded-full border border-line px-3 text-xs text-fg-2 hover:border-edge disabled:opacity-50";
const menu = "min-h-8 max-w-[14rem] rounded-full border border-line bg-panel px-2 text-xs text-fg-2 hover:border-edge focus:border-accent";

function languageName(code: string): string {
  try {
    return `${new Intl.DisplayNames([navigator.language || "en"], { type: "language" }).of(code) ?? code} (${code})`;
  } catch {
    return code;
  }
}

/** Takes the handlers off a recognition so nothing it reports later reaches the draft. */
function detach(rec: Recognition) {
  rec.onresult = null;
  rec.onerror = null;
  rec.onend = null;
}

/**
 * Speech to text for the question box. Dictate opens a panel that says the browser may send the audio to its
 * speech service; listening starts only from Start listening there and runs until Stop, an error, a full
 * question box, a switch to another conversation (`sessionKey`), `disabled` (an answer being sent) or unmount,
 * and never restarts by itself. Final words are added after the draft as it stands, so typing in between is
 * kept. It never sends: the player reviews the text and presses Send.
 */
export default function DictationButton({ value, onChange, disabled = false, sessionKey }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  sessionKey: string;
}) {
  const panel = useId();
  const [open, setOpen] = useState(false);
  const [supported, setSupported] = useState(true);
  const [lang, setLang] = useState("");
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const live = useRef<Recognition | null>(null);
  // The latest draft and setter, read when words arrive.
  const draft = useRef(value);
  draft.current = value;
  const change = useRef(onChange);
  change.current = onChange;
  const scope = useRef({ sessionKey, disabled });
  scope.current = { sessionKey, disabled };

  /** Ends listening now and drops anything still on its way. */
  const halt = () => {
    const rec = live.current;
    if (!rec) return;
    live.current = null;
    detach(rec);
    try { rec.abort(); } catch { /* Already ended by the browser. */ }
    setListening(false);
  };

  useLayoutEffect(() => () => {
    halt();
    setNotice(null);
  }, [sessionKey]);

  useLayoutEffect(() => {
    if (disabled) halt();
  }, [disabled]);

  const toggle = () => {
    if (open) halt();
    if (!open) {
      setSupported(speechRecognition(window as never) !== null);
      setLang((l) => l || dictationLanguages(navigator.language)[0]!);
    }
    setOpen(!open);
  };

  const start = () => {
    const Recognition = speechRecognition(window as never);
    if (!Recognition) { setSupported(false); return; }
    let rec: Recognition;
    try { rec = new Recognition(); }
    catch { setNotice({ text: dictationError("start-failed")!, error: true }); return; }
    const startedIn = sessionKey;
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    const seen = new Set<number>();
    rec.onresult = (e) => {
      if (live.current !== rec || scope.current.sessionKey !== startedIn || scope.current.disabled) return;
      let next = draft.current;
      let full = false;
      for (const segment of finalSegments(e, seen)) {
        const r = appendSegment(next, segment, LIMIT);
        next = r.value;
        if (r.truncated) { full = true; break; }
      }
      if (next !== draft.current) {
        draft.current = next;
        change.current(next);
      }
      if (full) {
        setNotice({ text: "The question reached its 2,000-character limit, so listening stopped. Words after that were not added.", error: false });
        halt();
      }
    };
    rec.onerror = (e) => {
      if (live.current !== rec) return;
      const text = dictationError(e.error);
      halt();
      if (text) setNotice({ text, error: true });
    };
    rec.onend = () => {
      if (live.current !== rec) return;
      live.current = null;
      detach(rec);
      setListening(false);
    };
    setNotice(null);
    live.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      live.current = null;
      detach(rec);
      setNotice({ text: dictationError("start-failed")!, error: true });
    }
  };

  const stop = () => {
    const rec = live.current;
    if (!rec) return;
    live.current = null;
    detach(rec);
    rec.stop();
    setListening(false);
  };

  return (
    <>
      <button type="button" className={chip} aria-expanded={open} aria-controls={panel} disabled={disabled} onClick={toggle}>
        {listening ? "Dictate · listening" : "Dictate"}
      </button>
      {open && (
        <div id={panel} role="group" aria-label="Dictation" className="flex basis-full flex-wrap items-center gap-2 rounded-card border border-line px-3 py-2">
          {supported ? (
            <>
              <p className="basis-full text-xs text-muted">
                Dictation uses your browser&apos;s speech recognition, and the browser may send your audio to its speech service to turn it into text. Everloot doesn&apos;t record or keep the audio. The words go into your question, and nothing is sent until you press Send.
              </p>
              <select aria-label="Dictation language" className={menu} value={lang} disabled={listening || disabled}
                onChange={(e) => setLang(e.target.value)}>
                {dictationLanguages(navigator.language).map((code) => <option key={code} value={code}>{languageName(code)}</option>)}
              </select>
              {listening
                ? <button type="button" className="btn min-h-8 px-3 text-xs" onClick={stop}>Stop listening</button>
                : <button type="button" className="btn min-h-8 px-3 text-xs" disabled={disabled} onClick={start}>Start listening</button>}
            </>
          ) : (
            <p className="basis-full text-xs text-fg-2">Dictation isn&apos;t available in this browser. You can keep typing your question.</p>
          )}
          <p role="status" className="text-xs text-fg-2">{listening ? "Listening…" : notice && !notice.error ? notice.text : ""}</p>
          {notice?.error && <p role="alert" className="basis-full text-xs text-danger">{notice.text}</p>}
        </div>
      )}
    </>
  );
}
