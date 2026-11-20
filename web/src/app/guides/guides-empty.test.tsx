// @vitest-environment jsdom
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

import GuidesEmpty, { GUIDE_CONTRACT_URL, GUIDE_SUBMISSION_URL } from "./GuidesEmpty";
import { classLabel } from "@/lib/class-context";
import { TALENT_CLASSES } from "@/lib/talents/catalogs";

/** The words as read: each paragraph's text, one space between paragraphs. */
const text = (html: string) =>
  [...new DOMParser().parseFromString(html, "text/html").querySelectorAll("p")].map((p) => p.textContent ?? "").join(" ").replace(/\s+/g, " ");
const hrefs = (html: string) => [...new DOMParser().parseFromString(html, "text/html").querySelectorAll("a")].map((a) => a.getAttribute("href"));

// The class is read from the catalog list, never typed here (docs/DATA_POLICY.md).
const slug = TALENT_CLASSES[0]!;
const name = classLabel(slug);

const WHAT = "A guide is Everloot's own advice on one talent plan for one class: who it is for, why it fits an activity, how to play it and what we do not know yet. It is reviewed before it is published.";
const HOW = "To offer one, read the guide contract, plan the build in the Talent calculator and send the Guide submission form with your sources and a link to your draft.";

describe("the shared guides empty state", () => {
  test("says what a reviewed guide is and how one is offered, linking the contract, the calculator and the submission form", () => {
    const html = renderToStaticMarkup(<GuidesEmpty />);
    expect(html).toContain("data-guides-empty");
    expect(text(html)).toContain(`No guide is reviewed yet. ${WHAT} ${HOW}`);
    expect(hrefs(html)).toEqual([GUIDE_CONTRACT_URL, "/tools/talents", GUIDE_SUBMISSION_URL]);
    expect(GUIDE_CONTRACT_URL).toBe("https://github.com/Everloot/everloot/blob/main/docs/GUIDES.md");
    expect(GUIDE_SUBMISSION_URL).toBe("https://github.com/Everloot/everloot/issues/new?template=guide-submission.yml");
    expect(text(html)).not.toContain("class page");
  });

  test("on the guides index it also links the class pages", () => {
    const html = renderToStaticMarkup(<GuidesEmpty classes />);
    expect(text(html)).toContain(`${HOW} Each class page lists its guides once one is reviewed.`);
    expect(hrefs(html)).toEqual([GUIDE_CONTRACT_URL, "/tools/talents", GUIDE_SUBMISSION_URL, "/classes"]);
  });

  test("on a class hub it names the class and opens the calculator on that class", () => {
    const html = renderToStaticMarkup(<GuidesEmpty classSlug={slug} />);
    expect(text(html)).toContain(`No ${name} guide is reviewed yet. ${WHAT} To offer one, read the guide contract, plan the build in the ${name} talent calculator and send the Guide submission form`);
    expect(hrefs(html)).toEqual([GUIDE_CONTRACT_URL, `/tools/talents/${slug}`, GUIDE_SUBMISSION_URL]);
  });

  test("names no role, so a hub with no guide still names none", () => {
    const words = text(renderToStaticMarkup(<GuidesEmpty classSlug={slug} classes />)).toLowerCase();
    for (const role of ["tank", "healer", "damage", "dps"]) expect(words, role).not.toContain(role);
  });
});
