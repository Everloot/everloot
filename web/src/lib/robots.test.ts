import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("public item subclasses are crawlable while filter permutations stay excluded", () => {
  const robots = readFileSync("public/robots.txt", "utf8").replaceAll("\r\n", "\n");
  const publicRules = robots.split("# AI search")[0];
  const rules = [...publicRules.matchAll(/^Disallow:\s*(.+)$/gm)].map((m) => m[1].trim());
  const blocked = (path: string) => rules.some((rule) => {
    const pattern = rule.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${pattern}`).test(path);
  });
  expect(blocked("/database/items/trade-goods/cloth")).toBe(false);
  expect(blocked("/database/items/weapons/daggers")).toBe(false);
  expect(blocked("/database/items?quality=2")).toBe(true);
  expect(blocked("/database/items/weapons/daggers?quality=2")).toBe(true);
});

test("training is disallowed without blocking search and user-requested AI access", () => {
  const robots = readFileSync("public/robots.txt", "utf8").replaceAll("\r\n", "\n");
  for (const agent of ["GPTBot", "ClaudeBot", "CCBot", "Bytespider", "Amazonbot", "Meta-ExternalAgent", "Google-Extended", "Applebot-Extended"]) {
    expect(robots).toContain(`User-agent: ${agent}\n`);
  }
  for (const agent of ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Googlebot", "Bingbot"]) {
    expect(robots).not.toContain(`User-agent: ${agent}\n`);
  }
});
