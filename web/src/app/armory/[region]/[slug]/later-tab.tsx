"use client";

import { useContext, useEffect, useState, type ReactNode } from "react";
import { OpenTab } from "@/components/ui/Tabs";
import type { CharacterTabId } from "../../character-tabs";
import { characterTab } from "./tab-action";

type State = { node: ReactNode } | "idle" | "loading" | "failed";

/**
 * A tab the page does not draw with itself: its content loads the first time the tab opens (a click, the arrow keys,
 * or an address such as #progress), then stays. Without JavaScript only the default tab shows, as before.
 */
export default function LaterTab({ region, slug, tab }: { region: string; slug: string; tab: CharacterTabId }) {
  const open = useContext(OpenTab) === tab;
  const [state, setState] = useState<State>("idle");

  useEffect(() => {
    if (!open || state !== "idle") return;
    setState("loading");
    characterTab(region, slug, tab).then((node) => setState({ node }), () => setState("failed"));
  }, [open, state, region, slug, tab]);

  if (typeof state === "object") return <>{state.node}</>;
  // A page left open across a deploy asks for a tab the new build no longer knows by that call: reloading fixes it.
  if (state === "failed") {
    return (
      <p role="status" className="flex flex-wrap items-center gap-2 py-3 text-sm text-fg-2">
        This tab did not load.
        <button type="button" className="btn btn-sm" onClick={() => setState("idle")}>Try again</button>
        <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>Reload the page</button>
      </p>
    );
  }
  return <p role="status" data-tab-loading={tab} className="py-3 text-sm text-fg-2">Loading…</p>;
}
