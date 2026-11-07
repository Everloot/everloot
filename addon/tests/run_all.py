"""Run with: python addon/tests/run_all.py (needs lupa and jsonschema)

The addon contract tests, in one list that checks.yml, release.yml and nightly.yml all run, so a release or a
nightly cannot skip a test the pull-request checks run. A test script in this folder that is neither listed here
nor in PLANNER (the workflows' separate "Connected planner contracts" step) fails the run.
"""
import subprocess
import sys
from pathlib import Path

TESTS = [
    "event_identity.py", "collection_contract.py", "map_positions_contract.py", "loot_types_contract.py",
    "item_facts_contract.py", "auction_contract.py", "auction_fallback_contract.py", "gold_contract.py",
    "ask_contract.py", "recipes_contract.py", "addons_contract.py", "mapbounds_contract.py", "market_contract.py",
    "drops_contract.py", "scan_prompt_contract.py", "auction_tab_contract.py", "options_contract.py",
    "gph_contract.py", "talents_contract.py", "plan_contract.py", "raid_contract.py", "completion_contract.py",
    "census_contract.py", "players_contract.py", "link_contract.py", "conveniences_contract.py",
    "protocol_contract.py", "no_ads_contract.py", "minimap_contract.py", "secret_values_contract.py",
    "ui_window_contract.py", "answers_contract.py", "pulls_contract.py",
    "drawer_contract.py", "owned_contract.py", "guild_contract.py", "charstats_contract.py", "pvp_contract.py",
    "roster_contract.py", "ledger_contract.py",
]
# Run by the workflows' own step; scripts/test_alpha_release.py checks that step names them.
PLANNER = ["raid_plan_contract.py", "planner_contract.py"]
# Imported by the tests, not a test itself.
HELPERS = ["protocol_schema.py", "gate_off_snapshot.py", Path(__file__).name]

here = Path(__file__).parent
unlisted = sorted({p.name for p in here.glob("*.py")} - set(TESTS) - set(PLANNER) - set(HELPERS))
assert not unlisted, f"addon/tests has test scripts no workflow runs; add them to run_all.py: {unlisted}"
for name in TESTS:
    print(f"== {name}", flush=True)
    subprocess.run([sys.executable, str(here / name)], cwd=here.parents[1], check=True)
print(f"Addon contract tests: {len(TESTS)} PASS")
