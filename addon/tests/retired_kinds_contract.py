"""Run with: uv run --with lupa --with jsonschema python addon/tests/retired_kinds_contract.py

Blizzard's character API supplies gear, talents, professions, stats, PvP, achievements, reputation and completed
quests (docs/design/specs/2026-11-17-blizzard-api-first.md), so the addon no longer records them. A saved file from an
older addon may still hold their rows: the first load of this release deletes them, with the state only their modules
used, and leaves every other row alone. A load after that finds nothing to delete.
"""
from pathlib import Path

from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
for gone in ("gear", "charstats", "pvp"):
    assert f"modules\\{gone}.lua" not in toc and not (root / "modules" / f"{gone}.lua").exists(), f"{gone}.lua is removed"

RETIRED = ["gear_snapshot", "talent_snapshot", "achievement_owned", "reputation_owned", "quest_owned",
           "profession_owned", "talent_owned", "stats_owned", "pvp_owned"]
KEPT = ["title_owned", "lockout_owned", "boss_kill_owned", "achievement_catalog", "reputation_catalog", "title_catalog",
        "quest_chain_catalog", "guild_snapshot", "gold_snapshot", "money_event", "census_self", "census_seen", "player_seen",
        "loot", "npc_sighting", "auction_scan"]

WORLD = """
date = function() return '2026-11-17T00:00:00Z' end
time = function() return 123456 end
printed = {}
print = function(...) printed[#printed + 1] = table.concat({ ... }, ' ') end
SlashCmdList = {}
CreateFrame = function() return { RegisterEvent=function() end, SetScript=function(self, _, f) self.onEvent=f end,
  HookScript=function() end } end
"""


def rows(kinds):
    return "{ " + ", ".join(f"{k} = {{ {{ eventId = '{k}:1' }}, {{ eventId = '{k}:2' }} }}" for k in kinds) + " }"


def load(saved):
    lua = LuaRuntime()
    lua.execute(WORLD)
    lua.execute(f"EverlootDB = {saved}")
    lua.execute((root / "core.lua").read_text(encoding="utf-8"))
    lua.execute("Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')")
    return lua


paused = ", ".join(f"{k} = true" for k in RETIRED[:3] + ["loot"])
saved = (f"{{ installId = 'abcd-1234', version = '0.3.22', toggles = {{ openworld = true, gear = true, talents = false, completion = true, "
         f"players = false }}, gearSampledAt = {{ abcd = 1 }}, talentsSeen = {{ ['abcd:1'] = 'x' }}, completionSeen = {{ own = {{}} }}, "
         f"paused = {{ {paused} }}, records = {rows(RETIRED + KEPT)} }}")
lua = load(saved)
g = lua.globals()
db = g.EverlootDB
for kind in RETIRED:
    assert db.records[kind] is None, f"{kind} rows are deleted at load"
    assert db.paused[kind] is None, f"{kind} is no longer paused"
for kind in KEPT:
    assert len(list(db.records[kind].values())) == 2, f"{kind} rows are kept"
assert db.paused["loot"] is True, "another kind's paused flag is kept"
assert db.gearSampledAt is None and db.talentsSeen is None, "the gear and talents modules' state is deleted"
assert db.toggles["gear"] is None and db.toggles["talents"] is None, "their switches are deleted"
assert db.toggles["completion"] is True and db.toggles["players"] is False and db.completionSeen is not None, "every other choice is kept"
status = g.Everloot.Status(g.Everloot)
for kind in RETIRED:
    assert f"rows {kind}:" not in status, status

# A load after that finds nothing to delete and changes nothing.
lua.execute("before = 0; for _ in pairs(EverlootDB.records) do before = before + 1 end")
lua.execute("Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')")
lua.execute("after = 0; for _ in pairs(EverlootDB.records) do after = after + 1 end")
assert lua.eval("before") == lua.eval("after") == len(KEPT)

# A new install starts with no retired switch or state at all.
lua = load("nil")
db = lua.globals().EverlootDB
assert db.toggles["gear"] is None and db.toggles["talents"] is None and db.gearSampledAt is None and db.talentsSeen is None

print(f"Lua 5.1 retired kinds: the first load deletes {len(RETIRED)} kinds the addon no longer records, their paused flags, "
      "switches and module state, and keeps every other row and choice")
