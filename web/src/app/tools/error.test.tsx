import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import ToolsUnavailable from "./error";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

test("the tools boundary names the section, says it could not be read, and offers a retry and the tools index", () => {
  const html = renderToStaticMarkup(<ToolsUnavailable error={new Error("x")} reset={() => {}} />);
  expect(html).toContain("Tool unavailable");
  expect(html).toContain("could not be read");
  expect(html).toContain("does not mean its data is empty");
  expect(html).toContain("Try again");
  expect(html).toContain('href="/tools"');
  expect(html).not.toContain("Something went wrong");
});
