import Link from "@/components/Link";
import EntityLink from "./EntityLink";

/** Up to this many quests show whole; a longer chain shows its first and last quest and this quest's neighbours. */
const WHOLE = 9;
const AROUND = 2;

type Step = { kind: "quest"; questId: number; position: number } | { kind: "gap"; count: number; key: string };

/**
 * The steps to draw: every quest of a short chain; of a long one, the ends and two either side of `current`. With no
 * `current` (the chain's own page) every quest is drawn.
 */
export function chainSteps(questIds: readonly number[], current?: number): Step[] {
  const at = current === undefined ? -1 : questIds.indexOf(current);
  const keep = (i: number) => current === undefined || questIds.length <= WHOLE || i === 0 || i === questIds.length - 1 || Math.abs(i - at) <= AROUND;
  const steps: Step[] = [];
  let skipped = 0;
  questIds.forEach((questId, i) => {
    if (!keep(i)) { skipped++; return; }
    if (skipped) steps.push({ kind: "gap", count: skipped, key: `gap-${i}` });
    skipped = 0;
    steps.push({ kind: "quest", questId, position: i + 1 });
  });
  return steps;
}

/**
 * A quest chain as a row of steps in order: each quest a link, this quest marked and unlinked, the steps a long chain
 * leaves out counted and linked to the chain's own page. On a phone the steps stack, so a long title never scrolls.
 * Without `current` it is the chain's own page: every step drawn, and no link back to the page itself.
 */
export default function QuestChainFlow({ questIds, current, name, href, nameOf, truncated }: {
  questIds: readonly number[]; current?: number; name: string; href: string; nameOf: (id: number) => string | undefined; truncated?: boolean;
}) {
  const steps = chainSteps(questIds, current);
  const own = current === undefined;
  return (
    <section aria-labelledby="quest-chain-heading" className="mb-6">
      <h2 id="quest-chain-heading" className="mb-2 text-h2-sm font-semibold text-fg sm:text-h2">
        {own ? "Steps" : <>Quest chain: <Link href={href} className="underline decoration-edge underline-offset-4 hover:decoration-fg">{name}</Link></>}
      </h2>
      <ol data-quest-chain className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-2">
        {steps.map((step, i) => (
          <li key={step.kind === "quest" ? step.questId : step.key} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className="hidden text-muted sm:inline">→</span>}
            {step.kind === "gap" ? (
              <Link href={href} className="text-meta text-muted underline decoration-edge underline-offset-4 hover:decoration-fg">{step.count} more</Link>
            ) : step.questId === current ? (
              <span aria-current="step" className="flex min-w-0 items-center gap-2 rounded-control border border-accent bg-panel px-3 py-1.5 text-cell font-semibold text-fg">
                <span className="font-mono text-xs tabular-nums text-muted">{step.position}</span>
                {nameOf(step.questId) ?? `Quest ${step.questId}`}
              </span>
            ) : (
              <span className="flex min-w-0 items-center gap-2 rounded-control border border-line bg-panel px-3 py-1.5 text-cell">
                <span className="font-mono text-xs tabular-nums text-muted">{step.position}</span>
                <EntityLink kind="quest" id={step.questId} name={nameOf(step.questId)} />
              </span>
            )}
          </li>
        ))}
      </ol>
      {!own && <p className="mt-2 text-meta">
        <Link href={href} className="text-fg-2 underline decoration-edge underline-offset-4 hover:decoration-fg">
          All {questIds.length}{truncated ? "+" : ""} quests
        </Link>
      </p>}
    </section>
  );
}
