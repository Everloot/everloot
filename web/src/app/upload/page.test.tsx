import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("./UploadClient", () => ({ default: () => null }));

import UploadPage from "./page";

test("the upload page says how uploaded observations are licensed", () => {
  expect(renderToStaticMarkup(<UploadPage />)).toContain(
    "Uploaded observations are published under CC BY-SA 4.0, credited to Everloot contributors.",
  );
});

test("the upload page links the downloads page", () => {
  expect(renderToStaticMarkup(<UploadPage />)).toContain('href="/addon"');
});

test("the upload page links the data policy on GitHub", () => {
  expect(renderToStaticMarkup(<UploadPage />)).toContain(
    'href="https://github.com/Everloot/everloot/blob/main/docs/DATA_POLICY.md"',
  );
});

test("a player with only the Polestar Recorder is told they can upload its file without installing anything else", () => {
  const html = renderToStaticMarkup(<UploadPage />);
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
  expect(text).toContain("Already recording with Polestar?");
  expect(text).toContain("You do not need Everloot's addon for this");
  expect(text).toContain("Polestar_Recorder.lua");
  expect(text).toContain("you do not need to install anything else");
  expect(html).toContain('href="https://github.com/fitzforge/polestar"');
});

test("the Recorder text keeps the disclosure: names stay local and a fact needs three characters from three addresses", () => {
  const text = renderToStaticMarkup(<UploadPage />).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
  expect(text).toContain("Character names, realms, session names and notes stay on your computer");
  expect(text).toContain("three different characters, uploading from three different addresses");
  expect(text).toContain("a report, not a fact");
  expect(text).not.toMatch(/guarantee|\bAI\b|Claude/);
});
