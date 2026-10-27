"""Run: python scripts/test_export_base_guides.py"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from export_base_guides import export_guides  # noqa: E402


def refused(*args) -> str:
    try:
        export_guides(*args)
    except (ValueError, subprocess.CalledProcessError) as e:
        return str(e)
    raise AssertionError(f"export_guides{args} was not refused")


with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    origin, clone = root / "origin", root / "clone"

    def git(repo: Path, *args: str) -> str:
        return subprocess.run(["git", "-C", str(repo), "-c", "user.name=Ana", "-c", "user.email=ana@example.com", "-c", "core.autocrlf=false", *args],
                              capture_output=True, text=True, check=True).stdout.strip()

    origin.mkdir()
    git(origin, "init", "-q")
    git(origin, "commit", "-q", "--allow-empty", "-m", "no guides yet")
    without = git(origin, "rev-parse", "HEAD")
    guides = origin / "kb" / "guides"
    (guides / "notes").mkdir(parents=True)
    (guides / "README.md").write_text("# how to write one\n", encoding="utf-8")
    (guides / "frost-leveling.md").write_bytes(b"---\nid: 1\n---\r\n\xc3\xa9\n")
    (guides / "run.sh").write_text("echo never run\n", encoding="utf-8")
    (guides / "notes" / "inner.md").write_text("not a guide\n", encoding="utf-8")
    git(origin, "add", "-A")
    git(origin, "commit", "-q", "-m", "guides")
    with_guides = git(origin, "rev-parse", "HEAD")
    (guides / "frost-leveling.md").write_text("changed since\n", encoding="utf-8")
    git(origin, "commit", "-q", "-am", "edit")

    # The checkout CI has: the newest commit only, so each base must be fetched.
    subprocess.run(["git", "clone", "-q", "--depth=1", origin.as_uri(), str(clone)], check=True)

    # The base's top-level Markdown files, byte for byte; not its other files, not its subfolders.
    out = root / "with"
    assert export_guides(with_guides, out, cwd=clone) == 2
    assert sorted(p.name for p in out.iterdir()) == ["README.md", "frost-leveling.md"]
    assert (out / "frost-leveling.md").read_bytes() == b"---\nid: 1\n---\r\n\xc3\xa9\n"

    # A base without the folder compares with an empty folder, made on purpose.
    out = root / "without"
    assert export_guides(without, out, cwd=clone) == 0
    assert out.is_dir() and not any(out.iterdir())

    # Anything else fails: a value that is not a commit id, a commit the remote does not have, a folder already in use.
    assert "not a commit id" in refused("main", root / "a", clone)
    assert "not a commit id" in refused("0" * 40, root / "b", clone)
    assert "not a commit id" in refused(with_guides[:12], root / "c", clone)
    refused("1" * 40, root / "d", clone)
    assert not (root / "d").exists()
    (root / "e").mkdir()
    (root / "e" / "x.md").write_text("x", encoding="utf-8")
    assert "new or empty" in refused(with_guides, root / "e", clone)

    # kb/guides as a file, or a guide that is a link, is not a folder of guides.
    git(origin, "rm", "-q", "-r", "kb/guides")
    (origin / "kb").mkdir(exist_ok=True)
    (origin / "kb" / "guides").write_text("a file\n", encoding="utf-8")
    git(origin, "add", "-A")
    git(origin, "commit", "-q", "-m", "a file")
    assert "not a folder" in refused(git(origin, "rev-parse", "HEAD"), root / "f", clone)
    git(origin, "rm", "-q", "kb/guides")
    link =subprocess.run(["git", "-C", str(origin), "hash-object", "-w", "--stdin"], input="README.md", capture_output=True, text=True, check=True).stdout.strip()
    git(origin, "update-index", "--add", "--cacheinfo", f"120000,{link},kb/guides/linked.md")
    git(origin, "commit", "-q", "-m", "a link")
    assert "not a regular file" in refused(git(origin, "rev-parse", "HEAD"), root / "g", clone)

print("export_base_guides: 10 cases pass")
