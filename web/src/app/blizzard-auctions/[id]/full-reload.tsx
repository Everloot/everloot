"use client";

import { useEffect } from "react";

/**
 * What a client-side move to this page receives instead of the prices: a fresh load of the same address, so the
 * prices arrive only in a document of their own, one that never loaded ads or analytics.
 */
export default function FullReload() {
  useEffect(() => { window.location.reload(); }, []);
  return <p role="status" className="text-meta text-fg-2">Loading the Blizzard auction house data…</p>;
}
