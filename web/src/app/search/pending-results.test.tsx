// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import PendingResults from "./PendingResults";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

// The page's search box: a GET form whose text field is `q`. The submit is cancelled so jsdom does not navigate.
function render(q: string) {
  act(() => root.render(<>
    <form data-search-bar onSubmit={(e) => e.preventDefault()}><input name="q" defaultValue={q} /></form>
    <PendingResults q={q}><p>No results for “{q}”</p></PendingResults>
  </>));
  const input = container.querySelector("input")!;
  const submit = (text: string) => act(() => { input.value = text; container.querySelector("form")!.requestSubmit(); });
  return submit;
}

test("a new query in the search box replaces the old results with the searching line at once", () => {
  const submit = render("zzz");
  expect(container.textContent).toContain("No results for “zzz”");
  submit("defias");
  expect(container.querySelector('[role="status"]')!.textContent).toBe("Searching…");
  expect(container.textContent).not.toContain("No results for");
});

test("submitting the same query, or a blank one, keeps the results", () => {
  const submit = render("zzz");
  submit(" zzz ");
  submit("");
  expect(container.textContent).toContain("No results for “zzz”");
  expect(container.querySelector('[role="status"]')).toBeNull();
});

test("coming back to the page from the history shows its results again", () => {
  const submit = render("zzz");
  submit("defias");
  act(() => { window.dispatchEvent(new Event("pageshow")); });
  expect(container.textContent).toContain("No results for “zzz”");
});
