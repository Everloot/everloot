import Link from "next/link";
import AgreementMeter, { AGREEMENT_NEEDED, clampAgreement, reportedLabel } from "./AgreementMeter";

export interface EmptyStateProps {
  /** One sentence: what is missing and why it will come. "Nobody has looted this in Forever yet." */
  message: string;
  /** Installs that have reported it so far; usually 0. */
  count?: number;
  /** The one action. Getting the addon unless the page has a better one. */
  action?: { href: string; label: string };
  /** Drop the frame when the empty state sits inside a Card or a DataTable that already draws one. */
  framed?: boolean;
  /**
   * Fill the action. Off by default: the header's "Get the addon" is already the filled button in view, and a
   * page with a form or a sign-up has its own. Turn it on only where this action is the one thing to do.
   */
  primary?: boolean;
}

export const GET_THE_ADDON = { href: "/addon", label: "Get the addon" } as const;

/**
 * The line an empty player-data tab ends on: how many installs it takes. A page that already says so ("A pin needs
 * 3 installs at the same spot.") keeps its own words and does not add this.
 */
export function installsNeeded(reported = 0): string {
  const n = clampAgreement(reported);
  return n === 0 ? `It shows once ${AGREEMENT_NEEDED} installs report it.` : `${reportedLabel(n)}; it shows once ${AGREEMENT_NEEDED} do.`;
}

/**
 * Every empty dataset looks like this: the agreement meter at its count, one sentence and one
 * action. Never a bare "0", never an empty box.
 */
export default function EmptyState({ message, count = 0, action = GET_THE_ADDON, framed = true, primary = false }: EmptyStateProps) {
  return (
    <div
      data-empty-state
      className={`flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6 ${framed ? "rounded-card border border-line bg-panel p-6" : "px-4 py-8 sm:px-6"}`}
    >
      <AgreementMeter count={count} size="lg" />
      <p className="min-w-0 flex-1 text-fg-2">{message}</p>
      <Link href={action.href} className={`btn shrink-0${primary ? " btn-primary" : ""}`}>{action.label}</Link>
    </div>
  );
}
