"""Fail when a relative link or image in a tracked Markdown file points at a file that does not exist.
Anchors and web links are not followed. Run from the repository root: python scripts/check_md_links.py"""
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote

# Site content, not documentation: a wiki page, news post or guide links site addresses such as /database/items,
# which are pages, not files. Their links are checked by `npm run kb -- wiki-check`, `news-check` and `guide-check`;
# each folder's README is documentation and stays checked here.
CONTENT_DIRS = ("kb/wiki/", "kb/news/", "kb/guides/", "web/src/test/wiki/", "web/src/test/news/")


def is_content_page(name: str) -> bool:
    return name.startswith(CONTENT_DIRS) and not name.endswith("README.md")


LINK = re.compile(r"!?\[[^\]]*\]\(<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\)")
FENCE = re.compile(r"^\s*(```|~~~)")


def broken_links(path: Path, root: Path) -> list[tuple[int, str]]:
    found = []
    in_fence = False
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if FENCE.match(line):
            in_fence = not in_fence
        if in_fence:
            continue
        for target in LINK.findall(re.sub(r"`[^`]*`", "", line)):
            if re.match(r"^([a-z][a-z0-9+.-]*:|#|//)", target, re.I):
                continue
            rel = unquote(target.split("#", 1)[0].split("?", 1)[0])
            if not rel:
                continue
            base = root if rel.startswith("/") else path.parent
            if not (base / rel.lstrip("/")).resolve().exists():
                found.append((n, target))
    return found


def main() -> int:
    root = Path.cwd()
    files = subprocess.run(["git", "ls-files", "-z", "*.md"], capture_output=True, text=True, check=True).stdout.split("\0")
    bad = 0
    for name in filter(None, files):
        path = root / name
        if not path.is_file() or is_content_page(name):
            continue
        for n, target in broken_links(path, root):
            print(f"{name}:{n}: broken link {target}")
            bad += 1
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
