import { createServer } from "node:http";
import { expect, test } from "vitest";
import { ANSWER_SYSTEM, evaluateWritten, formatAnswerEval, NOT_FOUND, openAiCompatible, sampleKeyed, score } from "../src/answer-eval.js";
import { openDb } from "../src/db.js";
import type { Question } from "../src/question-bank.js";

// SYNTHETIC questions; the names are made up.
const keyed = (id: string, template: string, text: string, facts: string[]): Question => ({
  id, template, text, subject: { kind: "mount", name: "x" }, expects: { resolve: true, evidence: true }, answer: { facts, from: "test", build: "1" },
});
const horse = keyed("riding-skill:mount:synthetic-horse", "riding-skill", "what riding skill does Synthetic Horse need", ["75"]);
const stockade = keyed("bosses:instance:synthetic-stockade", "bosses", "which bosses are in Synthetic Stockade", ["Synthetic Warden", "Synthetic Jailer"]);
const forest = keyed("where-is:zone:synthetic-forest", "where-is", "where is Synthetic Forest", ["Synthetic Kingdoms"]);

test("score: every fact is correct, some is partial, the exact refusal is declined, none is wrong", () => {
  expect(score("It needs riding skill 75.", ["75"])).toEqual({ verdict: "correct", missing: [] });
  expect(score("It needs riding skill 175.", ["75"])).toEqual({ verdict: "wrong", missing: ["75"] });
  expect(score("Synthetic Warden is there.", ["Synthetic Warden", "Synthetic Jailer"])).toEqual({ verdict: "partial", missing: ["Synthetic Jailer"] });
  expect(score(NOT_FOUND, ["75"])).toEqual({ verdict: "declined", missing: ["75"] });
});

test("sampleKeyed: only questions with a key, every k-th, the same sample on every run", () => {
  const plain: Question = { id: "what-is:mount:x", template: "what-is", text: "what is x", subject: { kind: "mount", name: "x" }, expects: { resolve: true, evidence: true } };
  const bank = [plain, horse, stockade, forest];
  expect(sampleKeyed(bank, 10).map((q) => q.id)).toEqual([horse.id, stockade.id, forest.id]);
  expect(sampleKeyed(bank, 2).map((q) => q.id)).toEqual([horse.id, stockade.id]);
  expect(sampleKeyed([...bank, forest, forest, forest], 2).map((q) => q.id)).toEqual([horse.id, forest.id]);
  expect(sampleKeyed(bank, 2)).toEqual(sampleKeyed(bank, 2));
});

test("evaluateWritten: the model gets the in-game rules and the evidence, each reply is scored, a failed call is an error", async () => {
  const db = openDb(":memory:");
  const seen: { system: string; user: string }[] = [];
  const replies: Record<string, string | Error> = {
    [horse.text]: "Synthetic Horse needs riding skill 75.",
    [stockade.text]: "Synthetic Warden guards it.",
    [forest.text]: new Error("HTTP 503"),
  };
  const report = await evaluateWritten(db, [horse, stockade, forest], async (system, user) => {
    seen.push({ system, user });
    const reply = replies[user.split("\n")[0]!.replace("Question: ", "")]!;
    if (reply instanceof Error) throw reply;
    return reply;
  }, { model: "test-model", ranAt: "2026-10-29T08:00:00.000Z" });
  expect(seen[0]!.system).toBe(ANSWER_SYSTEM);
  expect(seen[0]!.user).toMatch(/^Question: what riding skill does Synthetic Horse need\n\nSources:\n/);
  expect(report.totals).toEqual({ correct: 1, partial: 1, declined: 0, wrong: 0, error: 1 });
  expect(report.byTemplate.find((t) => t.template === "bosses")).toEqual({ template: "bosses", questions: 1, correct: 0, partial: 1, declined: 0, wrong: 0, error: 0 });
  const md = formatAnswerEval(report);
  expect(md).toContain("# Written-answer eval, 2026-10-29");
  expect(md).toContain("| all | 3 | 33% | 33% | 0% | 0% | 33% |");
  expect(md).toContain("| which bosses are in Synthetic Stockade | Synthetic Jailer | Synthetic Warden guards it. |");
  db.close();
});

test("openAiCompatible: posts the model, both messages and temperature 0 to /chat/completions, with the key when given", async () => {
  const bodies: { auth: string | undefined; body: { model: string; temperature: number; messages: { role: string; content: string }[] } }[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    bodies.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
    if (req.url !== "/v1/chat/completions") { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: "Riding skill 75." } }] }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  try {
    expect(await openAiCompatible({ baseUrl: `${base}/`, model: "qwen3:8b", key: "k" })("S", "U")).toBe("Riding skill 75.");
    expect(bodies[0]).toEqual({ auth: "Bearer k", body: { model: "qwen3:8b", temperature: 0, max_tokens: 1500, messages: [{ role: "system", content: "S" }, { role: "user", content: "U" }] } });
    expect((await openAiCompatible({ baseUrl: base, model: "m" })("S", "U"))).toBe("Riding skill 75.");
    expect(bodies[1]!.auth).toBeUndefined();
    await expect(openAiCompatible({ baseUrl: `${base}/nope`, model: "m" })("S", "U")).rejects.toThrow("HTTP 404");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

test("openAiCompatible: an empty reply is an error that says why, never an answer to score", async () => {
  const reply = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  await expect(openAiCompatible({ baseUrl: "http://x", model: "m", send: reply({ choices: [{ finish_reason: "length", message: { content: "" } }] }) })("S", "U"))
    .rejects.toThrow("empty reply: the token budget ran out (raise --max-tokens)");
  await expect(openAiCompatible({ baseUrl: "http://x", model: "m", send: reply({ choices: [{ message: { content: "  " } }] }) })("S", "U")).rejects.toThrow("no text in the reply");
});
