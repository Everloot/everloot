import { DEGRADED_META } from "@/lib/cf-edge-cache";

/**
 * Marks a render that is missing data it could not read, so the Worker's edge cache keeps it a minute rather than
 * the page's hour (src/lib/cf-edge-cache.ts). Pass the read's own failure flag. Shows nothing.
 */
export default function EdgeDegraded({ when }: { when: boolean }) {
  return when ? <meta name={DEGRADED_META} content="1" /> : null;
}
