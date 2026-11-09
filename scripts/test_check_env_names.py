"""Run: python scripts/test_check_env_names.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from check_env_names import (  # noqa: E402
    compare, names_in_code, names_in_doc, names_in_env_example, names_in_workflow, names_in_wrangler, read_names,
)

# Code reads: process.env.NAME and env.NAME, trimmed or not; lowercase members and other objects are not names.
assert names_in_code('const a = process.env.FOO_BAR?.trim();\nif (env.BAZ === "1") {}') == {"FOO_BAR", "BAZ"}
assert names_in_code("process.env.NODE_ENV === 'production'") == {"NODE_ENV"}
assert names_in_code("os.env.APPDATA ?? home") == {"APPDATA"}
assert names_in_code("env.lowercase; config.env; process.env[k]; myenv.FOO; env.X") == set()
assert names_in_code("env.NODE.something") == set()

# Workflow reads: secrets.NAME and vars.NAME, however they are combined.
assert names_in_workflow("GH_TOKEN: ${{ secrets.BUILD_TOKEN || github.token }}\nif: vars.DEPLOY == '1'") == {"BUILD_TOKEN", "DEPLOY"}
assert names_in_workflow("${{ secrets.A_KEY != '' }} ${{ github.token }}") == {"A_KEY"}

# The example file: the name before the equals sign, comments and the byte-order mark ignored.
assert names_in_env_example("﻿# Copy me\nFOO=\nBAR=https://example.invalid\n# BAZ=\n") == {"FOO", "BAR"}

# The Worker config: the keys under "vars", through the comments.
wrangler = '{\n  // a comment with env.NOT_THIS\n  "name": "x",\n  "vars": {\n    "NODE_ENV": "production", // trailing\n    "SWITCH": "1"\n  }\n}'
assert names_in_wrangler(wrangler) == {"NODE_ENV", "SWITCH"}

# The document: names in backticks only, and whole names only.
assert names_in_doc("| `FOO_BAR` | file | `/indexnow.txt` | `NEXT_PUBLIC_*` | `wrangler secret put` | `1` |") == {"FOO_BAR"}
assert names_in_doc("`A`, `B_C` and `d`") == {"B_C"}

# Only the scoped files count, read through the function handed in.
texts = {
    "web/src/lib/a.ts": "process.env.FROM_WEB",
    "kb/src/b.ts": "env.FROM_KB",
    "web/scripts/c.mjs": "process.env.NOT_SCOPED",
    "web/src/lib/d.test.ts.snap": "process.env.NOT_CODE",
    ".github/workflows/e.yml": "${{ secrets.FROM_WF }}",
    "web/wrangler.jsonc": '{"vars": {"FROM_WRANGLER": "1"}}',
    "web/.env.example": "FROM_EXAMPLE=\n",
    "docs/ENVIRONMENT.md": "`NOT_A_SOURCE`",
}
assert read_names(list(texts), texts.__getitem__) == {"FROM_WEB", "FROM_KB", "FROM_WF", "FROM_WRANGLER", "FROM_EXAMPLE"}

# Both directions are reported, sorted.
assert compare({"A", "B"}, {"B", "C"}) == (["A"], ["C"])
assert compare({"A"}, {"A"}) == ([], [])
print("ok")
