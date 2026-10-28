"""Run: python scripts/test_check_internal_paths.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from check_internal_paths import offending_lines, skipped  # noqa: E402

# Private: the maintainer's workspace, secrets folder, user folder and agent worktrees.
assert offending_lines("cd D:\\R21-Brain\\projects\\everloot") == [1]
assert offending_lines("ok\nsee C:/Users/carli/file") == [2]
assert offending_lines("C:\\Users\\carli\\.t3\\worktrees\\x") == [1]
assert offending_lines("the old client in _secrets/2026 was rotated") == [1]
assert offending_lines("c:\\users\\carli\\x and C:/Users/Carli/y") == [1]
assert offending_lines("d:/r21-brain/projects") == [1]
assert offending_lines("e.g. from %USERPROFILE%\\.r21\\everloot-r2-backup.env") == [1]
assert offending_lines("cd projects/everloot/web") == [1]
# Generic example paths in docs and tests are fine.
assert offending_lines('{ "apiKeyFile": "C:/Users/<you>/keys/anthropic.txt" }') == []
assert offending_lines('parseArgs(["watch", "--game", "C:/Games/WoW"]) and "C:\\\\Users\\\\p\\\\AppData"') == []
# Lockfiles are checked: a file: dependency would leak a local path there.
assert not skipped("web/package-lock.json")
assert not skipped("package-lock.json")
assert skipped("scripts/check_internal_paths.py")
print("check_internal_paths: 13 cases pass")
