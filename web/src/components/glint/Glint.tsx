"use client";

import { useEffect, useRef } from "react";
import { MOTION, type QUALITIES, tokens } from "@/design/tokens";
import { reducedMotion } from "@/lib/motion";
import "./glint.css";

export type GlintPose = "idle" | "cheer" | "sad";
export type GlintGem = "everloot" | (typeof QUALITIES)[number];

export interface GlintProps {
  size?: number;
  pose?: GlintPose;
  /** Optional item-quality colour for the small hat pin. */
  gem?: GlintGem;
  /** Without a label the mascot is decorative. */
  label?: string;
  still?: boolean;
  /** Each new value triggers a small greeting bounce. */
  flap?: number;
  className?: string;
}

export const gemColour = (gem: GlintGem): string => (gem === "everloot" ? tokens.dark.accent : tokens.dark[`q-${gem}`]);

/** Jovian's crouched character, with painted shading and only a narrow green hat band and emerald pin added. */
export default function Glint({ size = 160, pose = "idle", gem = "everloot", label, still = false, flap = 0, className }: GlintProps) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (still || !svg) return;
    let onScreen = true;
    const sync = () => svg.toggleAttribute("data-paused", !onScreen || document.hidden);
    const observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; sync(); })
      : null;
    observer?.observe(svg);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      svg.removeAttribute("data-paused");
    };
  }, [still]);

  useEffect(() => {
    const svg = ref.current;
    if (!flap || still || !svg || reducedMotion()) return;
    svg.removeAttribute("data-flap");
    void svg.getBoundingClientRect();
    svg.setAttribute("data-flap", "");
    const done = window.setTimeout(() => svg.removeAttribute("data-flap"), MOTION.glint.duration.flap);
    return () => {
      window.clearTimeout(done);
      svg.removeAttribute("data-flap");
    };
  }, [flap, still]);

  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <svg
      ref={ref}
      viewBox="0 0 216 216"
      width={size}
      height={size}
      focusable="false"
      data-glint=""
      data-pose={pose}
      data-still={still ? "" : undefined}
      className={className ? `glint ${className}` : "glint"}
      {...a11y}
    >
      <g className="glint-bob">
        <g className="glint-response">
          <image href={`/mascot/glint-${pose}.webp`} width="216" height="216" preserveAspectRatio="xMidYMid meet" />
          {gem !== "everloot" && pose !== "sad" && (
            <path data-part="gem" d="m120 56 3 3-1 5-3 1-2-4Z" fill={gemColour(gem)} />
          )}
        </g>
      </g>
    </svg>
  );
}
