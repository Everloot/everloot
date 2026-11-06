"""Run with: uv run --with lupa --with jsonschema python addon/tests/protocol_contract.py

Every record kind the addon can write has a schema in the protocol package. The kinds are the string
literals in `Store("<kind>"` across the addon's Lua, plus the eight completion kinds that
addon/modules/completion.lua stores through a variable. The local-only kinds (LOCAL_ONLY_KINDS) are the exception:
they must have no intake schema, so the site could never take them.
"""
import re
from pathlib import Path

from protocol_schema import LOCAL_ONLY_KINDS, SCHEMA_DIR, schema_for

root = Path(__file__).parents[1]
kinds = set()
for source in sorted(root.rglob("*.lua")):
    if "tests" in source.parts:
        continue
    code = "\n".join(line.split("--")[0] for line in source.read_text(encoding="utf-8").splitlines())
    kinds.update(re.findall(r"""Store\(\s*["']([a-z_]+)["']""", code))
completion = {
    "achievement_catalog", "reputation_catalog", "title_catalog", "quest_chain_catalog",
    "achievement_owned", "reputation_owned", "title_owned", "quest_owned",
}
completion_lua = (root / "modules" / "completion.lua").read_text(encoding="utf-8")
for kind in completion:
    assert kind in completion_lua, f"completion.lua no longer names {kind}; update this list"
kinds |= completion

assert SCHEMA_DIR.exists(), f"protocol schema folder missing: {SCHEMA_DIR} (run npm run build in packages/protocol)"
assert len(kinds) >= 25, f"only {len(kinds)} kinds found in the addon; the scan is broken"
owned_lua = (root / "modules" / "owned.lua").read_text(encoding="utf-8") + (root / "modules" / "charstats.lua").read_text(encoding="utf-8")
for kind in LOCAL_ONLY_KINDS:
    assert kind in owned_lua, f"owned.lua and charstats.lua no longer name {kind}; update LOCAL_ONLY_KINDS"
    assert not (SCHEMA_DIR / "records" / f"{kind}.json").exists(), f"{kind} stays on the computer; the intake must have no schema for it"
kinds -= LOCAL_ONLY_KINDS
for kind in sorted(kinds):
    schema_for(kind)
print(f"Lua 5.1 protocol: {len(kinds)} record kinds the addon writes all have a schema in {SCHEMA_DIR.relative_to(root.parent)}")
