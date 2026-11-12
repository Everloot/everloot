import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("SEO-tool crawlers are disallowed while search and public access stay allowed", () => {
  const robots = readFileSync("public/robots.txt", "utf8").replaceAll("\r\n", "\n");
  const groups = robots.split(/\n\s*\n/).map((group) => ({
    agents: [...group.matchAll(/^User-agent:\s*(.+)$/gm)].map((m) => m[1].trim()),
    rules: [...group.matchAll(/^(Allow|Disallow):\s*(.+)$/gm)].map((m) => `${m[1]}: ${m[2].trim()}`),
  }));
  for (const agent of ["MJ12bot", "DotBot"]) {
    expect(groups.find((group) => group.agents.includes(agent))?.rules).toEqual(["Disallow: /"]);
  }
  for (const agent of ["*", "Googlebot", "Bingbot", "OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot"]) {
    const group = groups.find((group) => group.agents.includes(agent))
      ?? groups.find((group) => group.agents.includes("*"));
    expect(group?.rules).toContain("Allow: /");
    expect(group?.rules).not.toContain("Disallow: /");
  }
});

test("public item subclasses and pagination are crawlable while filter permutations stay excluded", () => {
  const robots = readFileSync("public/robots.txt", "utf8").replaceAll("\r\n", "\n");
  const publicRules = robots.split("# AI search")[0];
  const rules = [...publicRules.matchAll(/^(Allow|Disallow):\s*(.+)$/gm)].map((m) => ({
    allow: m[1] === "Allow", path: m[2].trim(),
  }));
  const blocked = (path: string) => {
    const matching = rules.filter((rule) => {
      const pattern = rule.path.replace(/\$$/, "").split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
      return new RegExp(`^${pattern}${rule.path.endsWith("$") ? "$" : ""}`).test(path);
    }).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
    return matching.length > 0 && !matching[0].allow;
  };
  expect(publicRules).toContain("Allow: /database/items?page=*$\n");
  expect(publicRules).toContain("Allow: /database/items/*?page=*$\n");
  expect(blocked("/database/items/trade-goods/cloth")).toBe(false);
  expect(blocked("/database/items/weapons/daggers")).toBe(false);
  expect(blocked("/database/items?quality=2")).toBe(true);
  expect(blocked("/database/items/weapons/daggers?quality=2")).toBe(true);
  for (const path of ["/database/items", "/database/items/weapons", "/database/items/weapons/daggers"]) {
    expect(blocked(path)).toBe(false);
    expect(blocked(`${path}?page=2`)).toBe(false);
    expect(blocked(`${path}?page=12`)).toBe(false);
    for (const filter of ["quality=2", "sort=name", "q=cloth"]) {
      expect(blocked(`${path}?${filter}`)).toBe(true);
      expect(blocked(`${path}?${filter}&page=2`)).toBe(true);
      expect(blocked(`${path}?page=2&${filter}`)).toBe(true);
    }
    expect(blocked(`${path}?pageSize=2`)).toBe(true);
  }
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
