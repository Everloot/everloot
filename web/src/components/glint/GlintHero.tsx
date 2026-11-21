"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MOTION } from "@/design/tokens";
import { LAUNCH_AT } from "@/data/wow-forever";
import Glint from "./Glint";
import { heroLines, LOOT_GET, lineText, type GlintLine } from "./lines";

function Words({ line }: { line: GlintLine }) {
  if (!line.when) return <>{line.text}</>;
  const [before, after] = line.text.split("{when}");
  return (
    <>
      {before}
      <Link href="/wow-forever" className="font-semibold text-fg underline underline-offset-4 hover:text-accent transition-colors">
        <time dateTime={LAUNCH_AT}>{line.when}</time>
      </Link>
      {after}
    </>
  );
}

/**
 * Glint on the home hero, holding the launch countdown in a speech bubble. The lines take turns every
 * MOTION.glint.duration.line, and wait while the pointer or keyboard focus is on him or the tab is hidden. Every line
 * sits in the same grid cell, so the bubble is as tall as its longest line and nothing below it moves when the line
 * changes. Hovering him gives a small greeting bounce and he says "Loot get!"; clicking him moves to the next line. The turns are
 * not announced: only a line asked for with a click goes to the screen reader's live region.
 */
export default function GlintHero({ initialNow }: { initialNow?: number }) {
  const [now, setNow] = useState<number | null>(initialNow ?? null);
  const [index, setIndex] = useState(0);
  const [cheering, setCheering] = useState(false);
  const [flap, setFlap] = useState(0);
  const [said, setSaid] = useState("");
  const pointerOn = useRef(false);
  const focusOn = useRef(false);
  const pop = useRef<number | undefined>(undefined);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (pointerOn.current || focusOn.current || document.hidden) return;
      setIndex((i) => i + 1);
    }, MOTION.glint.duration.line);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => () => window.clearTimeout(pop.current), []);

  const lines = heroLines(now);
  const current = lines[index % lines.length];
  const shown = cheering ? LOOT_GET : current;

  const cheer = () => {
    setFlap((n) => n + 1);
    setCheering(true);
    window.clearTimeout(pop.current);
    pop.current = window.setTimeout(() => setCheering(false), MOTION.glint.duration.pop);
  };
  const next = () => {
    const line = lines[(index + 1) % lines.length];
    window.clearTimeout(pop.current);
    setCheering(false);
    setFlap((n) => n + 1);
    setIndex((i) => i + 1);
    setSaid(lineText(line));
  };

  return (
    <div
      data-glint-hero=""
      className="flex items-center gap-3 xl:flex-col-reverse xl:items-end xl:gap-1"
      onFocus={() => { focusOn.current = true; }}
      onBlur={() => { focusOn.current = false; }}
      onPointerLeave={() => { pointerOn.current = false; }}
    >
      <button
        type="button"
        aria-label="Glint, the Everloot mascot. Say something else"
        className="shrink-0 rounded-card"
        onPointerEnter={(e) => {
          pointerOn.current = true;
          if (e.pointerType === "mouse") cheer();
        }}
        onClick={next}
      >
        <Glint size={176} pose={cheering ? "cheer" : "idle"} flap={flap} className="h-[72px] w-[72px] xl:h-44 xl:w-44" />
      </button>
      <div className="relative min-w-0 flex-1 rounded-card border border-edge bg-panel px-4 py-3 text-sm text-fg xl:w-64 xl:flex-none">
        <svg aria-hidden="true" viewBox="0 0 12 16" className="absolute -left-[11px] top-1/2 h-4 w-3 -translate-y-1/2 fill-panel stroke-edge xl:hidden">
          <path d="M12.5 1 1 8l11.5 7" />
        </svg>
        <svg aria-hidden="true" viewBox="0 0 16 12" className="absolute -bottom-[11px] right-6 hidden h-3 w-4 fill-panel stroke-edge xl:block">
          <path d="M1-.5 13 11 15-.5" />
        </svg>
        <p data-glint-lines="" className="grid">
          {[...lines, LOOT_GET].map((line) => {
            const on = line.id === shown.id;
            return (
              <span
                key={line.id}
                aria-hidden={on ? undefined : true}
                className={`glint-line [grid-area:1/1] transition-opacity duration-fade ease-out ${on ? "opacity-100" : "invisible opacity-0"}`}
              >
                <Words line={line} />
              </span>
            );
          })}
        </p>
      </div>
      <p aria-live="polite" className="sr-only">{said}</p>
    </div>
  );
}
