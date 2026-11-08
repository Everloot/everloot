import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tools } from "@/data/tools";
import sitemap from "@/app/sitemap";

describe("working feature discovery", () => {
  it("links directly to the working database and upload", () => {
    expect(tools.find((tool) => tool.slug === "database")).toMatchObject({ href: "/database", status: "collecting" });
    expect(tools.find((tool) => tool.slug === "upload")).toMatchObject({ href: "/upload", status: "live" });
  });
  it("describes the farming tool as live now that its page is", () => {
    expect(tools.find((tool) => tool.slug === "farming-routes")?.status).toBe("collecting");
  });
  it("lists canonical routes once without redirect or waitlist duplicates", async () => {
    const urls = (await sitemap()).map((entry) => new URL(entry.url).pathname);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toContain("/database");
    expect(urls).toContain("/upload");
    expect(urls).not.toContain("/tools/database");
    expect(urls).not.toContain("/tools/guild-tracker");
    expect(urls).not.toContain("/tools/completionist");
    expect(urls).not.toContain("/tools/profession-planner");
  });
  it("exposes a contact page linked from the footer and sitemap", async () => {
    const urls = (await sitemap()).map((entry) => new URL(entry.url).pathname);
    expect(urls).toContain("/about");
    expect(urls).toContain("/privacy");
    expect(urls).toContain("/contact");
    const footer = readFileSync(new URL("./Footer.tsx", import.meta.url), "utf8");
    expect(footer).toMatch(/href(?:=|: )"\/contact"/);
    const contact = readFileSync(new URL("../app/contact/page.tsx", import.meta.url), "utf8");
    expect(contact).toContain("mailto:hello@everloot.app");
  });
  it("claims no feature the addon or server does not have", () => {
    const page = (path: string) => readFileSync(new URL(`../app/${path}`, import.meta.url), "utf8");
    const professions = page("tools/professions/page.tsx");
    // No recipe emitter or perk record kind exists, and farming routes are planned.
    expect(professions).not.toMatch(/perk tracking|We track which perks|recipe sightings and material drops flow|plug straight into/);
    expect(tools.find((tool) => tool.slug === "professions")?.description).not.toMatch(/perk/i);
    // Opt-out needs a verified character grant; not any character.
    expect(page("privacy/page.tsx")).not.toContain("any character can opt out");
    // score_v1 has no published weights, and /tools/guild-tracker only redirects.
    const guild = page("guilds/[slug]/page.tsx");
    expect(guild).not.toContain("the score");
    expect(guild).not.toContain('href="/tools/guild-tracker"');
  });
});
