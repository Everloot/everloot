"""Write kb/guides as it was at a base commit into a new or empty folder, for `npm run kb -- guide-check --previous`.
The base is read from git as data: it is fetched, never checked out, and nothing from it runs. Only the folder's
top-level Markdown and YAML files are written: the guides, and the class chooser's files, which the check holds to
their review. A base without kb/guides gives an empty folder, on purpose; a commit id that
does not fetch, or a folder that does not list or read, fails, so the comparison is never skipped by accident.
Run from the repository root: python scripts/export_base_guides.py <base-commit-id> <folder>"""
import re
import subprocess
import sys
from pathlib import Path

GUIDES = "kb/guides"
COMMIT = re.compile(r"^[0-9a-f]{40}$")


def export_guides(sha: str, out: Path, cwd: str | Path | None = None) -> int:
    """Write the base's guide files into out and return how many."""
    def git(*args: str) -> bytes:
        return subprocess.run(["git", *args], cwd=cwd, capture_output=True, check=True).stdout

    # All zeros is what a push that created its branch reports: there is no base to compare with.
    if not COMMIT.fullmatch(sha) or not sha.strip("0"):
        raise ValueError(f"{sha!r} is not a commit id (40 lowercase hex digits)")
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        raise ValueError(f"{out} must be new or empty")
    # --depth keeps CI's shallow checkout small; in a full clone it would make the clone shallow, so it is left off.
    shallow = git("rev-parse", "--is-shallow-repository").strip() == b"true"
    git("fetch", "--quiet", "--no-tags", *(["--depth=1"] if shallow else []), "origin", sha)
    git("cat-file", "-e", f"{sha}^{{commit}}")
    entry = git("ls-tree", "-z", sha, "--", GUIDES)
    found = []
    if entry:
        if entry.split(b"\t", 1)[0].split(b" ")[1] != b"tree":
            raise ValueError(f"{GUIDES} at {sha} is not a folder")
        for item in filter(None, git("ls-tree", "-z", f"{sha}:{GUIDES}").split(b"\0")):
            meta, name = item.split(b"\t", 1)
            mode, kind, oid = meta.decode().split(" ")
            if not name.endswith((b".md", b".yaml")) or kind == "tree":
                continue
            if kind != "blob" or mode not in ("100644", "100755"):
                raise ValueError(f"{GUIDES}/{name.decode()} at {sha} is not a regular file")
            found.append((name.decode("utf-8"), git("cat-file", "blob", oid)))
    out.mkdir(parents=True, exist_ok=True)
    for name, data in found:
        (out / name).write_bytes(data)
    return len(found)


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    sha, out = sys.argv[1], Path(sys.argv[2])
    try:
        n = export_guides(sha, out)
    except ValueError as e:
        print(f"export_base_guides: {e}", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as e:
        print(f"export_base_guides: git {' '.join(e.cmd[1:])} failed: {e.stderr.decode(errors='replace').strip()}", file=sys.stderr)
        return 1
    print(f"{n} files from {GUIDES} at {sha} -> {out}" if n else f"{GUIDES} has no Markdown or YAML files at {sha}; comparing with none")
    return 0


if __name__ == "__main__":
    sys.exit(main())
