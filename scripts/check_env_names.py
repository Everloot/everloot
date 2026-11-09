"""Fail when docs/ENVIRONMENT.md and the names the project reads disagree.

A name counts as read when code under web/src, kb/src, companion/src or desktop/src reads it from the
environment, a workflow under .github/workflows names it as a secret or a repository variable,
web/wrangler.jsonc sets it as a var, or web/.env.example lists it. Every such name must appear in
docs/ENVIRONMENT.md, and every name the file lists must come from one of those places.
Run from the repository root: python scripts/check_env_names.py"""
import json
import re
import subprocess
import sys
from pathlib import Path

DOC = "docs/ENVIRONMENT.md"
CODE_DIRS = ("web/src/", "kb/src/", "companion/src/", "desktop/src/")
CODE_SUFFIXES = (".ts", ".tsx", ".mts", ".mjs", ".js")
WORKFLOW_DIR = ".github/workflows/"
WRANGLER = "web/wrangler.jsonc"
ENV_EXAMPLE = "web/.env.example"

NAME = r"[A-Z][A-Z0-9_]*[A-Z0-9]"
# process.env.NAME, or env.NAME where `env` is the environment record the code was handed.
CODE_READ = re.compile(rf"\b(?:process\.)?env\.({NAME})\b")
WORKFLOW_READ = re.compile(rf"\b(?:secrets|vars)\.({NAME})\b")
ENV_EXAMPLE_LINE = re.compile(rf"^({NAME})=")
DOC_NAME = re.compile(rf"`({NAME})`")
# A bare word on the standard library's or the runtime's side, not a variable someone sets.
NOT_A_VARIABLE = {"NODE"}


def names_in_code(text: str) -> set[str]:
    return {m for m in CODE_READ.findall(text) if m not in NOT_A_VARIABLE}


def names_in_workflow(text: str) -> set[str]:
    return set(WORKFLOW_READ.findall(text))


def names_in_env_example(text: str) -> set[str]:
    return {m.group(1) for line in text.splitlines() if (m := ENV_EXAMPLE_LINE.match(line.lstrip("﻿")))}


def strip_jsonc_comments(text: str) -> str:
    return re.sub(r"//[^\n]*", "", text)


def names_in_wrangler(text: str) -> set[str]:
    config = json.loads(strip_jsonc_comments(text))
    return {name for name in config.get("vars", {}) if re.fullmatch(NAME, name)}


def names_in_doc(text: str) -> set[str]:
    return set(DOC_NAME.findall(text))


def read_names(files: list[str], read=lambda path: Path(path).read_text(encoding="utf-8")) -> set[str]:
    found: set[str] = set()
    for path in files:
        if path.startswith(CODE_DIRS) and path.endswith(CODE_SUFFIXES):
            found |= names_in_code(read(path))
        elif path.startswith(WORKFLOW_DIR) and path.endswith((".yml", ".yaml")):
            found |= names_in_workflow(read(path))
        elif path == WRANGLER:
            found |= names_in_wrangler(read(path))
        elif path == ENV_EXAMPLE:
            found |= names_in_env_example(read(path))
    return found


def compare(read: set[str], documented: set[str]) -> tuple[list[str], list[str]]:
    """(names read but not documented, names documented but read nowhere), both sorted."""
    return sorted(read - documented), sorted(documented - read)


def main() -> int:
    files = subprocess.run(["git", "ls-files", "-z"], capture_output=True, text=True, check=True).stdout.split("\0")
    missing, stale = compare(read_names([f for f in files if f]), names_in_doc(Path(DOC).read_text(encoding="utf-8")))
    for name in missing:
        print(f"{DOC}: {name} is read in code, a workflow, {WRANGLER} or {ENV_EXAMPLE} but is not listed")
    for name in stale:
        print(f"{DOC}: {name} is listed but nothing reads it; remove the row or the reference")
    return 1 if missing or stale else 0


if __name__ == "__main__":
    sys.exit(main())
