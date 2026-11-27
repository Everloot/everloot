import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

const repo = join(__dirname, "..", "..", "..");

/** Each regular expression literal in `text` that holds a character above U+00FF, with its line. */
function wideRegexes(name: string, text: string): string[] {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, false, name.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral && /[^\u0000-ÿ]/.test(node.getText(source))) {
      found.push(`${name}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The shipped (non-test) TypeScript files under `dir`. */
function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$|(^|[\\/])__tests__[\\/]/.test(f))
    .map((f) => join(dir, f));
}

// The Worker runs as one ~50 MB script, and V8 keeps its source in memory for as long as the isolate lives. A source
// string holds one byte per character only while every character is at most U+00FF; a single character above that
// makes V8 store the whole script two bytes per character. The bundler writes non-ASCII characters in strings and
// templates as \u escapes, but copies regular expressions as written, so a raw ’ or “ in one regex costs a fresh
// isolate about 50 MB of its 128 MB. Write such characters as ’-style escapes inside regular expressions.
test("no shipped regular expression holds a character above U+00FF", () => {
  const found = ["web/src", "kb/src", "packages/protocol/src"].flatMap((dir) =>
    sources(join(repo, dir)).flatMap((file) => wideRegexes(relative(repo, file).replaceAll("\\", "/"), readFileSync(file, "utf8"))));
  expect(found).toEqual([]);
});

test("the scan finds a wide character in a regular expression, and only there", () => {
  expect(wideRegexes("a.ts", "const a = /[’']/g;\nconst b = \"’\";\nconst c = /[\\u2019']/g; // ’")).toEqual(["a.ts:1"]);
  expect(wideRegexes("a.tsx", "const a = <p title=\"“\">{x.replace(/…$/, \"\")}</p>;")).toEqual(["a.tsx:1"]);
});
