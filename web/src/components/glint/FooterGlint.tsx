"use client";

import { useEffect, useRef, useState } from "react";
import { MOTION } from "@/design/tokens";
import Glint from "./Glint";
import { FOOTER_LINES, lineText } from "./lines";

/**
 * Glint perched on the footer's top edge. Hover, focus or a click gives a greeting bounce and pops a line in a small
 * bubble, a different one each time; it goes after MOTION.glint.duration.pop. The bubble is a polite live region
 * that only changes when someone reaches for him.
 */
export default function FooterGlint() {
  const [turn, setTurn] = useState(0);
  const [open, setOpen] = useState(false);
  const close = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(close.current), []);

  const say = () => {
    setTurn((n) => n + 1);
    setOpen(true);
    window.clearTimeout(close.current);
    close.current = window.setTimeout(() => setOpen(false), MOTION.glint.duration.pop);
  };
  const line = FOOTER_LINES[Math.max(0, turn - 1) % FOOTER_LINES.length];

  return (
    <div data-footer-glint="" className="absolute bottom-full left-4 flex items-end gap-1 lg:left-6">
      <button
        type="button"
        aria-label="Glint, the Everloot mascot"
        className="-mb-[3px] rounded-control"
        onPointerEnter={(e) => { if (e.pointerType === "mouse") say(); }}
        onFocus={(e) => { if (e.currentTarget.matches(":focus-visible")) say(); }}
        onClick={say}
      >
        <Glint size={48} pose={open ? "cheer" : "idle"} flap={turn} />
      </button>
      <p
        aria-live="polite"
        className={`mb-6 whitespace-nowrap rounded-card border border-edge bg-panel px-2 py-1 text-xs text-fg transition-opacity duration-fade ease-out ${open ? "opacity-100" : "invisible opacity-0"}`}
      >
        {open ? lineText(line) : ""}
      </p>
    </div>
  );
}
