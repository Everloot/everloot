"use client";

import { useEffect, useState } from "react";
import { hasLaunched } from "@/data/wow-forever-launch";

/**
 * "launches" before the launch instant, "launched on" from then on. The server renders the tense for its own clock;
 * a page prerendered before launch keeps that HTML, so the browser checks its clock after hydration and corrects it.
 */
export default function LaunchTense({ launchedAtRender }: { launchedAtRender: boolean }) {
  const [launched, setLaunched] = useState(launchedAtRender);
  useEffect(() => setLaunched(hasLaunched(new Date())), []);
  return <>{launched ? "launched on" : "launches"}</>;
}
