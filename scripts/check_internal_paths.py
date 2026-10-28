"""Fail when a tracked file names the maintainer's private workspace, secrets folder or a personal
machine path. Run from the repository root: python scripts/check_internal_paths.py"""
import re
import subprocess
import sys

# This file is the one place the patterns are written down, so it is the one file not checked.
PATTERN = re.compile(
    r"R21-Brain|_secrets|Users[\\/]+carli|\.t3[\\/]+worktrees|[\\/]\.r21[\\/]|projects[\\/]+everloot",
    re.IGNORECASE,
)
SKIP = {"scripts/check_internal_paths.py", "scripts/test_check_internal_paths.py"}


def skipped(path: str) -> bool:
    return not path or path in SKIP


def offending_lines(text: str) -> list[int]:
    return [n for n, line in enumerate(text.splitlines(), 1) if PATTERN.search(line)]


def main() -> int:
    files = subprocess.run(["git", "ls-files", "-z"], capture_output=True, text=True, check=True).stdout.split("\0")
    found = 0
    for path in files:
        if skipped(path):
            continue
        try:
            with open(path, encoding="utf-8") as f:
                text = f.read()
        except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
            continue  # binary or not checked out
        for n in offending_lines(text):
            print(f"{path}:{n}: names a private workspace path or secrets folder; use generic wording")
            found += 1
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
