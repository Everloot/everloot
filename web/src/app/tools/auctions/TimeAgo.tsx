"use client";

import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/auction-house";
import { utcStamp } from "@/lib/time";

/**
 * "12 min ago", recounted in the browser each minute: a cached page would otherwise keep the age it had
 * when it was rendered. The exact UTC time is in the title.
 */
export default function TimeAgo({ at, renderedAt }: { at: number; renderedAt: number }) {
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const iso = new Date(at).toISOString();
  return <time dateTime={iso} title={utcStamp(iso) ?? undefined}>{timeAgo(at, now)}</time>;
}
