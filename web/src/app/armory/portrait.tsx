"use client";

import { useState } from "react";

export default function Portrait({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-card border border-edge bg-panel font-mono text-2xl text-fg-2" aria-hidden="true">
    {src && !failed
      // The small Blizzard avatar or existing race icon is served directly, without an image proxy.
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={src} alt="" width={80} height={80} decoding="async" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      : name.slice(0, 2).toUpperCase()}
  </div>;
}
