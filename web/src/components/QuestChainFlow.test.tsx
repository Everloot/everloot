import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));

import QuestChainFlow, { chainSteps } from "./QuestChainFlow";

const ids = Array.from({ length: 12 }, (_, i) => 100 + i);

test("a long chain on a quest's page keeps its ends and the quest's neighbours", () => {
  expect(chainSteps(ids, 105).filter((s) => s.kind === "gap")).toHaveLength(2);
});

test("with no current quest, every step of a long chain is drawn, numbered, and nothing links back to the chain", () => {
  expect(chainSteps(ids).every((s) => s.kind === "quest")).toBe(true);
  const out = renderToStaticMarkup(<QuestChainFlow questIds={ids} name="Long" href="/database/quest-chains/1-long" nameOf={() => undefined} />);
  expect(out).not.toContain('href="/database/quest-chains/1-long"');
  expect(out).not.toContain("aria-current");
  expect(out).toContain(">12</span>");
  expect(out).toContain("Steps");
});
