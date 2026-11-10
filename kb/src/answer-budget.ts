import { ANSWER_BYTES } from "@everloot/protocol";

const encoder = new TextEncoder();

/** The bytes a client receives for one tool result: the text block and the structured content, as UTF-8 JSON. */
export function answerBytes(answer: { text: string; structured: unknown }): number {
  return encoder.encode(JSON.stringify({ content: [{ type: "text", text: answer.text }], structuredContent: answer.structured })).length;
}

/**
 * The answer with the most items, up to max, that fits ANSWER_BYTES. render(n) builds the answer holding the first n
 * items of the page, with its counts and continuation taken from n. One item is the floor, even when it alone is
 * over the budget, so following nextOffset always moves on.
 */
export function fitAnswer<T extends { text: string; structured: unknown }>(max: number, render: (n: number) => T): T {
  const full = render(max);
  if (max <= 1 || answerBytes(full) <= ANSWER_BYTES) return full;
  let best = 1;
  let lo = 2;
  let hi = max - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (answerBytes(render(mid)) <= ANSWER_BYTES) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return render(best);
}
