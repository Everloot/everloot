import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import DatabaseUnavailable from "./error";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

test("the database boundary names the database, says it could not be read, and offers a retry and the hub", () => {
  const html = renderToStaticMarkup(<DatabaseUnavailable error={new Error("x")} reset={() => {}} />);
  expect(html).toContain("Database unavailable");
  expect(html).toContain("could not be read");
  expect(html).toContain("does not mean it is empty");
  expect(html).toContain("Try again");
  expect(html).toContain('href="/database"');
  expect(html).not.toContain("Something went wrong");
});
