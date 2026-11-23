"""Run with: uv run --with lupa --with jsonschema python addon/tests/protocol_contract.py

Every record kind the addon can write has a schema in the protocol package. The kinds are the string
literals in `Store("<kind>"` across the addon's Lua, plus the five completion kinds that
addon/modules/completion.lua stores through a variable. The local-only kinds (LOCAL_ONLY_KINDS) are the exception:
they must have no intake schema, so the site could never take them.

The kinds the addon no longer writes (core.lua E.RETIRED_KINDS) keep their schemas, so older addons still upload them
(docs/design/specs/2026-11-17-blizzard-api-first.md), and no module stores them any more.
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
    "achievement_catalog", "reputation_catalog", "title_catalog", "quest_chain_catalog", "title_owned",
}
completion_lua = (root / "modules" / "completion.lua").read_text(encoding="utf-8")
for kind in completion:
    assert kind in completion_lua, f"completion.lua no longer names {kind}; update this list"
kinds |= completion

assert SCHEMA_DIR.exists(), f"protocol schema folder missing: {SCHEMA_DIR} (run npm run build in packages/protocol)"
assert len(kinds) >= 25, f"only {len(kinds)} kinds found in the addon; the scan is broken"
owned_lua = "".join((root / "modules" / name).read_text(encoding="utf-8") for name in ("owned.lua", "boss_kills.lua", "wealth.lua"))
for kind in LOCAL_ONLY_KINDS:
    assert kind in owned_lua, f"owned.lua, boss_kills.lua and wealth.lua no longer name {kind}; update LOCAL_ONLY_KINDS"
    assert not (SCHEMA_DIR / "records" / f"{kind}.json").exists(), f"{kind} stays on the computer; the intake must have no schema for it"
# The addon's own list (core.lua E.LOCAL_ONLY_KINDS, which the Settings turn-off question reads) is the same set.
core_lua = (root / "core.lua").read_text(encoding="utf-8")
assert "E.LOCAL_ONLY_KINDS = {" in core_lua, "core.lua lists the kinds that never leave the computer"
start = core_lua.index("E.LOCAL_ONLY_KINDS = {")
assert set(re.findall(r'"([a-z_]+)"', core_lua[start:core_lua.index("}", start)])) == LOCAL_ONLY_KINDS, "core.lua E.LOCAL_ONLY_KINDS"
kinds -= LOCAL_ONLY_KINDS
for kind in sorted(kinds):
    schema_for(kind)

# The retired kinds: nothing stores them, and the ones the intake took keep their schema for older addons.
core = (root / "core.lua").read_text(encoding="utf-8")
retired = set(re.findall(r'"([a-z_]+)"', core[core.index("E.RETIRED_KINDS = {"):core.index("}", core.index("E.RETIRED_KINDS = {"))]))
assert retired == {"gear_snapshot", "talent_snapshot", "achievement_owned", "reputation_owned", "quest_owned",
                   "profession_owned", "talent_owned", "stats_owned", "pvp_owned"}, retired
assert not (retired & kinds), f"the addon still writes a retired kind: {sorted(retired & kinds)}"
for kind in ("gear_snapshot", "talent_snapshot", "achievement_owned", "reputation_owned", "quest_owned"):
    schema_for(kind)
print(f"Lua 5.1 protocol: {len(kinds)} record kinds the addon writes all have a schema in {SCHEMA_DIR.relative_to(root.parent)}")
