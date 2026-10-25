"use client";

import { useEffect, useRef, useState } from "react";

/** Display ad units in the Everloot AdSense account (pub-7465007562895301), all responsive. */
export const AD_SLOTS = {
  /** Below the facts on database pages, the patch notes and the home page. */
  inContent: "6833061644",
  /** The desktop-only sidebar on news posts (ReadingLayout rail, hidden below lg). */
  sidebar: "7165243291",
  /** Directly below a tool (talents, raid planner, gold calculator, professions). */
  belowTool: "9300452042",
} as const;

declare global {
  interface Window { adsbygoogle?: unknown[] }
}

/** The Desktop App's embedded site views add this token to their user agent; the app shows no ads. */
const DESKTOP_APP_TOKEN = "EverlootDesktopApp/";

/**
 * One AdSense unit, labelled as an advertisement once an ad fills it. Until then the slot takes no
 * space and shows no label, and it is removed when AdSense marks it unfilled (data-ad-status), so a
 * visitor never sees an empty box: not before approval, not when no ad is served, not when the
 * script is blocked or consent is declined. Renders nothing unless NEXT_PUBLIC_ADSENSE_CLIENT is set,
 * so previews, tests and local builds show no ads, and nothing inside the Desktop App. Pages decide
 * where a slot may go: never on a page without real content.
 */
export default function AdSlot({ slot, client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT }: { slot: keyof typeof AD_SLOTS; client?: string }) {
  const unit = useRef<HTMLModElement>(null);
  const [status, setStatus] = useState<"waiting" | "filled" | "empty">("waiting");
  useEffect(() => {
    const ins = unit.current;
    if (!client || !ins) return;
    if (navigator.userAgent.includes(DESKTOP_APP_TOKEN)) {
      setStatus("empty");
      return;
    }
    // AdSense sets data-ad-status on the <ins> when its request finishes: "filled", "unfilled" or
    // "unfill-optimized". Only "filled" puts an ad in the box.
    const read = () => {
      const value = ins.getAttribute("data-ad-status");
      if (value) setStatus(value === "filled" ? "filled" : "empty");
    };
    const observer = new MutationObserver(read);
    observer.observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* a slot that's already filled */ }
    read();
    return () => observer.disconnect();
  }, [client]);
  if (!client || status === "empty") return null;
  const filled = status === "filled";
  return (
    <aside aria-label={filled ? "Advertisement" : undefined} aria-hidden={filled ? undefined : true} className={filled ? "not-prose my-8" : "not-prose h-0 overflow-hidden"}>
      {filled && <p className="mb-1 text-[11px] font-mono text-muted">Advertisement</p>}
      <ins
        ref={unit}
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={client}
        data-ad-slot={AD_SLOTS[slot]}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
