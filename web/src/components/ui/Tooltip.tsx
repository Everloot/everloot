"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A focusable explanation. A fixed portal keeps it clear of table scroll containers. */
export default function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const cancelHide = () => { if (timer.current) clearTimeout(timer.current); };
  const hideSoon = () => {
    cancelHide();
    if (document.activeElement !== button.current) timer.current = setTimeout(() => setPosition(null), 150);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!position) return;
    const dismiss = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) {
        setPosition(null);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [position]);
  const show = () => {
    cancelHide();
    const rect = button.current!.getBoundingClientRect();
    setPosition({ top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 160)), left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)) });
  };
  return (
    <>
      <button ref={button} type="button" aria-label={label} aria-describedby={id}
        className="min-h-8 rounded-control text-inherit underline decoration-dotted underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onFocus={show} onBlur={() => { cancelHide(); setPosition(null); }} onMouseEnter={show} onMouseLeave={hideSoon}
        onClick={show} onKeyDown={(e) => { if (e.key === "Escape") { cancelHide(); setPosition(null); } }}>
        {children}
      </button>
      {!position && <span id={id} className="sr-only">{label}</span>}
      {position && createPortal(
        <span ref={popup} id={id} role="tooltip" className="fixed z-50 w-72 rounded-control border border-edge bg-panel p-3 text-sm font-normal text-fg" style={position}
          onMouseEnter={cancelHide} onMouseLeave={hideSoon}>{label}</span>, document.body,
      )}
    </>
  );
}
