import { completeWithFallback, type Provider } from "../providers/chain";
import { answerFromEvidence, MAX_ANSWER, type AnswerEngine, type Sourced } from "./engine";

const NOT_FOUND = "Not in the sources.";

const SYSTEM = [
  "You answer a World of Warcraft: Forever player's question for a small in-game chat window.",
  "Use only the sources in the user message. If they do not answer the question, reply exactly: " + NOT_FOUND,
  "Answer in at most two sentences of plain text, without markdown.",
].join(" ");

/**
 * The knowledge server's evidence first, then the user's providers phrase a short answer from it.
 * No evidence means no model call; every answer names the model that wrote it.
 */
export function llmEngine(options: { sources: (question: string) => Promise<Sourced>; providers: Provider[] }): AnswerEngine {
  return {
    async answer(question) {
      const sourced = await options.sources(question);
      const grounded = answerFromEvidence(sourced);
      if (grounded.source === "none") return grounded;
      const reply = await completeWithFallback(options.providers, SYSTEM, `Question: ${question}\n\nSources:\n${sourced.text}`);
      const text = plainText(reply.text);
      if (text === NOT_FOUND) return { answer: "No sourced answer found.", source: "none" };
      return { answer: `${text} (answered by ${reply.model})`.slice(0, MAX_ANSWER), source: grounded.source };
    },
  };
}

/** In-game chat shows Markdown literally: drop emphasis and code marks, fold lines into one. */
function plainText(text: string): string {
  return text.replace(/[*_`]+/g, "").replace(/\s+/g, " ").trim();
}
