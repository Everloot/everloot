"use client";

import { useEffect, useState } from "react";

type DesktopFile = { os: string; file: { url: string } };

/** Phones and tablets keep the full list: their OS cannot run these builds. */
export function desktopOS(platform: string, userAgent: string): string | null {
  if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return null;
  if (/Windows/i.test(platform || userAgent)) return "Windows";
  if (/macOS|Macintosh/i.test(platform || userAgent)) return "macOS";
  if (/Linux/i.test(platform || userAgent)) return "Linux";
  return null;
}

export default function DesktopDownload({ files }: { files: DesktopFile[] }) {
  const [os, setOS] = useState<string | null>(null);
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    setOS(desktopOS(nav.userAgentData?.platform ?? "", nav.userAgent));
  }, []);
  // Files arrive in page order: Windows uses the installer, rather than the portable build.
  const selected = files.find((entry) => entry.os === os);
  return (
    <a className="btn btn-primary min-h-11 w-full whitespace-nowrap" href={selected?.file.url ?? "#desktop-files"}>
      {selected ? `Download for ${os}` : "Choose your download"}
    </a>
  );
}
