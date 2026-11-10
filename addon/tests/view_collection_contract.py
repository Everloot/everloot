"""Run with: uv run --with lupa python addon/tests/view_collection_contract.py

The window's Collection view (modules/view_collection.lua): achievements, reputation, titles, raid lockouts and quest
chains from the rows the completion tracker wrote. It reads and displays only; with the tracker off it says what the
tracker reads and offers the command that turns it on. This character's rows only, until Account is chosen: then
every character in the roster counts, the one that holds an item is named, and a key outside the roster never counts.
"""
import zlib
from pathlib import Path
from window_world import fresh

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\view_collection.lua" in toc, "the Collection view is in the TOC"
assert toc.index("modules\\view_gold.lua") < toc.index("modules\\view_collection.lua") < toc.index("modules\\minimap.lua"), \
    "the Collection view loads after the Gold view and before the minimap button"
source = (root / "modules" / "view_collection.lua").read_text(encoding="utf-8")
code = "\n".join(line.split("--")[0] for line in source.splitlines())
for word in ["RegisterEvent", "HookScript", "hooksecurefunc", "E:Store", "EverlootDB.records[", "SendAddonMessage"]:
    assert word not in code, f"the Collection view reads and displays only: {word} found"
assert "Coming soon" not in source

NOW = 1794052800  # 2026-11-07 12:00 UTC
ME = "%08x" % zlib.adler32(b"abcd-1234:Player-1-0001")
API = f"now = {NOW}\ndate = os.date\nUnitGUID = function() return 'Player-1-0001' end\n"
EXTRA = ("modules/completion.lua", "modules/owned.lua")

RECORDS = f"""{{
  achievement_catalog = {{
    {{ achievementId = 1, name = 'Level 10', categoryId = 92, category = 'General', points = 10, criteriaCount = 0 }},
    {{ achievementId = 2, name = 'Explore Durotar', categoryId = 97, category = 'Exploration', points = 10, criteriaCount = 6 }},
    {{ achievementId = 3, name = 'Journeyman Fisherman', categoryId = 169, category = 'Professions', points = 25, criteriaCount = 5 }},
    {{ achievementId = 4, name = 'Zul Farrak', categoryId = 168, category = 'Dungeons', points = 5, criteriaCount = 1 }},
  }},
  achievement_owned = {{
    {{ characterKey = '{ME}', achievementId = 1, completed = true, earnedByMe = true, earnedOn = '2026-10-01', criteriaMet = 0, criteriaTotal = 0 }},
    {{ characterKey = '{ME}', achievementId = 2, completed = true, earnedByMe = true, earnedOn = '2026-11-02', criteriaMet = 6, criteriaTotal = 6 }},
    {{ characterKey = '{ME}', achievementId = 3, completed = false, criteriaMet = 1, criteriaTotal = 5 }},
    {{ characterKey = 'zzzz9999', achievementId = 3, completed = true, earnedOn = '2026-09-01' }},
    {{ characterKey = 'zzzz9999', achievementId = 4, completed = true, earnedOn = '2026-09-02' }},
  }},
  reputation_catalog = {{
    {{ factionId = 76, name = 'Orgrimmar', header = 'Horde' }},
    {{ factionId = 530, name = 'Darkspear Trolls', header = 'Horde' }},
    {{ factionId = 2600, name = 'A Major Faction', major = true }},
  }},
  reputation_owned = {{
    {{ characterKey = '{ME}', factionId = 76, reaction = 8, standing = 42500, floor = 42000, ceiling = 42999 }},
    {{ characterKey = '{ME}', factionId = 530, reaction = 5, standing = 4500, floor = 3000, ceiling = 9000 }},
    {{ characterKey = 'zzzz9999', factionId = 530, reaction = 8, standing = 42999, floor = 42000, ceiling = 42999 }},
  }},
  title_catalog = {{ {{ titleId = 1, name = 'Private' }}, {{ titleId = 2, name = 'Corporal' }}, {{ titleId = 3, name = 'Scout' }} }},
  title_owned = {{ {{ characterKey = '{ME}', titleIds = {{ 2 }} }}, {{ characterKey = 'zzzz9999', titleIds = {{ 1, 3 }} }} }},
  lockout_owned = {{
    {{ characterKey = '{ME}', instance = 'Molten Core', bossesKilledCount = 3, bossesTotal = 10, resetAt = '2026-11-11T07:00:00Z' }},
    {{ characterKey = '{ME}', instance = 'Onyxia', bossesKilledCount = 1, bossesTotal = 1, resetAt = '2026-11-01T07:00:00Z' }},
    {{ characterKey = 'zzzz9999', instance = 'Zul Gurub', bossesKilledCount = 2, bossesTotal = 10, resetAt = '2026-11-09T07:00:00Z' }},
    {{ characterKey = 'yyyy0000', instance = 'Blackwing Lair', bossesKilledCount = 1, bossesTotal = 8, resetAt = '2026-11-11T07:00:00Z' }},
  }},
  quest_chain_catalog = {{
    {{ questLineId = 900, name = 'The Defias Brotherhood', questIds = {{ 101, 102, 103, 104 }} }},
    {{ questLineId = 901, name = 'Kolkar Raiders', questIds = {{ 201, 202 }} }},
    {{ questLineId = 902, name = 'The Long Road', questIds = {{ 301, 302 }}, truncated = true }},
    {{ questLineId = 903, name = 'Wayward Trail', questIds = {{ 401, 402, 403, 404 }} }},
  }},
  quest_owned = {{
    {{ characterKey = '{ME}', questIds = {{ 101, 102, 201 }} }},
    {{ characterKey = '{ME}', questIds = {{ 103, 104, 401, 402 }} }},
    {{ characterKey = 'zzzz9999', questIds = {{ 201, 202, 301, 302, 403, 404 }} }},
    {{ characterKey = 'yyyy0000', questIds = {{ 101, 102, 103, 104, 401, 402, 403, 404 }} }},
  }},
}}"""
# Two of this player's own characters; 'yyyy0000' has rows in the file but is not in the roster.
ROSTER = f"{{ ['{ME}'] = {{ name = 'Brakka', realm = 'Forever' }}, zzzz9999 = {{ name = 'Velda', realm = 'Forever' }} }}"

HELPERS = """
local U = Everloot.Window
local function shown(rows) local n = 0; for _, r in ipairs(rows) do if r.shown then n = n + 1 end end; return n end
local function click(b) b.scripts.OnClick(b) end
"""

# --- Off: what the tracker reads, and the button that runs /everloot completion on ---
lua = fresh("{ installId = 'abcd-1234', toggles = {}, records = {} }", API, extra=EXTRA)
lua.execute(HELPERS + """
assert(U.Views.collection and U.Views.collection.build and U.Views.collection.refresh, 'the Collection view registers')
assert(U.Open('collection') == true)
local f = EverlootWindow
local c = f.collection
assert(f.views.collection.shown and f.subtitle.text == 'Collection' and not f.note.shown)
assert(EverlootDB.toggles.completion == false, 'the tracker starts off')
assert(c.offPage.shown and not c.onPage.shown, 'off shows the explanation only')
assert(c.offText.text:find('achievements') and c.offText.text:find('raid lockouts') and c.offText.text:find('never go in an upload'), c.offText.text)
assert(c.turnOn.shown and c.turnOn.text == 'Turn on')
click(c.turnOn)
assert(EverlootDB.toggles.completion == true, 'Turn on runs /everloot completion on')
assert(c.offText.text == 'Turned on. /reload to start reading.' and not c.turnOn.shown, c.offText.text)
assert(f.shown and not U.failed)
""")

# --- On: this character's rows, joined with the catalog ---
lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{ completion = true }}, records = {RECORDS} }}", API, extra=EXTRA)
lua.execute(HELPERS + f"""
assert(Everloot.CharacterKey() == '{ME}', 'the seeded key is this character')
assert(U.Open('collection') == true)
local f = EverlootWindow
local c = f.collection
local rows = c.rows
assert(c.onPage.shown and not c.offPage.shown and c.section == 'achievements' and c.missing == false and c.scope == 'character')
assert(#rows == 12 and c.sections.achievements and c.sections.reputation and c.sections.titles and c.sections.raids and c.sections.quests)
assert(c.scopes.character.text == 'This character' and c.scopes.account.text == 'Account', 'the scope buttons of the Gold tab')

-- Achievements: earned newest first, then the rest by name; the other character's do not count.
assert(c.summary.text == 'Achievements: 2 of 4 · 20 points', c.summary.text)
assert(shown(rows) == 4)
assert(rows[1].name.text == 'Explore Durotar' and rows[1].detail.text == '10 pts · Exploration · 2026-11-02' and rows[1].done.text == 'done', rows[1].detail.text)
assert(rows[2].name.text == 'Level 10' and rows[2].done.text == 'done')
assert(rows[3].name.text == 'Journeyman Fisherman' and rows[3].detail.text == '25 pts · Professions' and rows[3].done.text == '', rows[3].detail.text)
assert(rows[4].name.text == 'Zul Farrak' and rows[4].done.text == '')
assert(not rows[1].bar.shown, 'bars are for reputation')
assert(c.missingOnly.text == 'Missing only')
click(c.missingOnly)
assert(c.missing == true and c.missingOnly.text == 'Show all')
assert(shown(rows) == 2 and rows[1].name.text == 'Journeyman Fisherman' and rows[2].name.text == 'Zul Farrak', 'missing only hides earned rows')
click(c.missingOnly)
assert(c.missing == false and shown(rows) == 4)

-- Reputation: major factions left out, a standing bar from floor to ceiling.
click(c.sections.reputation)
assert(c.section == 'reputation' and c.summary.text == 'Reputation: 2 factions · 1 exalted', c.summary.text)
assert(shown(rows) == 2 and rows[1].name.text == 'Darkspear Trolls' and rows[2].name.text == 'Orgrimmar')
local bar = rows[1].bar
assert(bar.shown and bar.lo == 3000 and bar.hi == 9000 and bar.value == 4500, 'the bar runs floor to ceiling')
assert(rows[1].detail.text == '4500 / 9000' and rows[1].done.text == '' and rows[2].done.text == 'done', rows[1].detail.text)
click(c.missingOnly)
assert(shown(rows) == 1 and rows[1].name.text == 'Darkspear Trolls', 'exalted is done')
click(c.missingOnly)

-- Titles: known of total, the missing ones listed.
click(c.sections.titles)
assert(c.summary.text == 'Titles: 1 of 3', c.summary.text)
assert(shown(rows) == 3 and rows[1].name.text == 'Corporal' and rows[1].done.text == 'done' and rows[2].done.text == '')
click(c.missingOnly)
assert(shown(rows) == 2 and rows[1].name.text == 'Private' and rows[2].name.text == 'Scout', 'the missing titles')
click(c.missingOnly)

-- Instances are covered by instances_contract.py, including scope and live lockouts.
click(c.sections.raids)
assert(c.sections.raids.text == 'Dungeons & raids')

-- Quests: one row per chain, this character's quests done of its total; a chain cut at the tracker's limit is never complete.
click(c.sections.quests)
assert(c.section == 'quests' and c.summary.text == 'Quests: 1 of 4 chains complete', c.summary.text)
assert(shown(rows) == 4)
assert(rows[4].name.text == 'Wayward Trail' and rows[4].detail.text == '2 of 4' and rows[4].done.text == '', rows[4].detail.text)
assert(rows[1].name.text == 'Kolkar Raiders' and rows[1].detail.text == '1 of 2' and rows[1].done.text == '', rows[1].detail.text)
assert(rows[1].bar.shown and rows[1].bar.lo == 0 and rows[1].bar.hi == 2 and rows[1].bar.value == 1, 'the bar runs to the chain total')
assert(rows[1].detail.width == 180, 'the detail leaves room for the bar')
assert(rows[2].name.text == 'The Defias Brotherhood' and rows[2].detail.text == '4 of 4' and rows[2].done.text == 'done', 'quests from two rows count')
assert(rows[3].name.text == 'The Long Road' and rows[3].detail.text == '0 of 2+' and rows[3].done.text == '', rows[3].detail.text)
click(c.missingOnly)
assert(shown(rows) == 3 and rows[1].name.text == 'Kolkar Raiders' and rows[2].name.text == 'The Long Road', 'missing only hides complete chains')
click(c.missingOnly)

-- Account with no roster: this character alone, named as such.
click(c.scopes.account)
assert(c.scope == 'account' and c.summary.text == 'Quests: 1 of 4 chains complete', c.summary.text)
assert(rows[2].detail.text == '4 of 4 · This character', rows[2].detail.text)
click(c.scopes.character)
assert(c.scope == 'character' and rows[2].detail.text == '4 of 4', rows[2].detail.text)

-- Missing only over a section where everything is done says so.
EverlootDB.records.title_owned[1].titleIds = {{ 1, 2, 3 }}
click(c.sections.titles)
click(c.missingOnly)
assert(shown(rows) == 0 and rows.empty.shown and rows.empty.text == 'Nothing missing here.', rows.empty.text)
assert(f.shown and not U.failed)
""")

# --- On with nothing read yet ---
lua = fresh("{ installId = 'abcd-1234', toggles = { completion = true }, records = {} }", API, extra=EXTRA)
lua.execute(HELPERS + """
assert(U.Open('collection') == true)
local c = EverlootWindow.collection
local NOTHING = 'Nothing read yet. Open the achievements, reputation or titles window, then /reload.'
for _, key in ipairs({ 'achievements', 'reputation', 'titles' }) do
  click(c.sections[key])
  assert(shown(c.rows) == 0 and c.rows.empty.shown and c.rows.empty.text == NOTHING, key .. ': ' .. c.rows.empty.text)
end
click(c.sections.quests)
assert(c.summary.text == 'Quests: 0 of 0 chains complete', c.summary.text)
assert(shown(c.rows) == 0 and c.rows.empty.text == 'No quest chains read yet. They are read at login and each time you turn in a quest.', c.rows.empty.text)
click(c.sections.raids)
assert(c.summary.text:find('Dungeons & raids', 1, true))
assert(EverlootWindow.shown and not U.failed)
""")

# --- On, but the client gives no player id yet ---
lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{ completion = true }}, records = {RECORDS} }}",
            f"now = {NOW}\ndate = os.date\nUnitGUID = function() return nil end\n", extra=EXTRA)
lua.execute(HELPERS + """
assert(Everloot.CharacterKey() == nil)
assert(U.Open('collection') == true)
local c = EverlootWindow.collection
for _, key in ipairs({ 'achievements', 'reputation', 'titles', 'raids', 'quests' }) do
  click(c.sections[key])
  assert(shown(c.rows) == 0 and c.rows.empty.text == 'This character cannot be identified yet.', key)
  assert(c.summary.text == '', key .. ' has no summary')
end
assert(EverlootWindow.shown and not U.failed)
""")
# --- Account: every character in the roster, the holder named; a key outside the roster never counts ---
lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{ completion = true }}, records = {RECORDS}, roster = {ROSTER} }}", API, extra=EXTRA)
lua.execute(HELPERS + """
assert(U.Open('collection') == true)
local c = EverlootWindow.collection
local rows = c.rows
assert(c.summary.text == 'Achievements: 2 of 4 · 20 points', 'This character is the default: ' .. c.summary.text)
click(c.scopes.account)
assert(c.scope == 'account')

-- An achievement either character earned counts; this character is named first when both have it.
assert(c.summary.text == 'Achievements: 4 of 4 · 50 points', c.summary.text)
assert(rows[1].name.text == 'Explore Durotar' and rows[1].detail.text == '10 pts · Exploration · 2026-11-02 · Brakka', rows[1].detail.text)
assert(rows[3].name.text == 'Zul Farrak' and rows[3].detail.text == '5 pts · Dungeons · 2026-09-02 · Velda', rows[3].detail.text)
assert(rows[4].name.text == 'Journeyman Fisherman' and rows[4].detail.text == '25 pts · Professions · 2026-09-01 · Velda', 'not finished here, finished on the alt')
click(c.missingOnly)
assert(shown(rows) == 0 and rows.empty.text == 'Nothing missing here.')
click(c.missingOnly)

-- Reputation: the highest standing across the characters, and whose it is.
click(c.sections.reputation)
assert(c.summary.text == 'Reputation: 2 factions · 2 exalted', c.summary.text)
assert(rows[1].name.text == 'Darkspear Trolls' and rows[1].detail.text == '42999 / 42999 · Velda' and rows[1].done.text == 'done', rows[1].detail.text)
assert(rows[2].name.text == 'Orgrimmar' and rows[2].detail.text == '42500 / 42999 · Brakka', rows[2].detail.text)

-- Titles: known on any character, named.
click(c.sections.titles)
assert(c.summary.text == 'Titles: 3 of 3', c.summary.text)
assert(rows[1].name.text == 'Corporal' and rows[1].detail.text == 'Brakka' and rows[2].name.text == 'Private' and rows[2].detail.text == 'Velda')

-- Quests: the character furthest along each chain; quests done on different characters are not added together.
click(c.sections.quests)
assert(c.summary.text == 'Quests: 2 of 4 chains complete', c.summary.text)
assert(rows[4].name.text == 'Wayward Trail' and rows[4].detail.text == '2 of 4 · Brakka' and rows[4].done.text == '', 'furthest character, not a union: ' .. rows[4].detail.text)
assert(rows[4].bar.value == 2)
assert(rows[1].name.text == 'Kolkar Raiders' and rows[1].detail.text == '2 of 2 · Velda' and rows[1].done.text == 'done', rows[1].detail.text)
assert(rows[1].bar.value == 2)
assert(rows[2].name.text == 'The Defias Brotherhood' and rows[2].detail.text == '4 of 4 · Brakka', rows[2].detail.text)
assert(rows[3].name.text == 'The Long Road' and rows[3].detail.text == '2 of 2+ · Velda' and rows[3].done.text == '', rows[3].detail.text)
click(c.missingOnly)
assert(shown(rows) == 2 and rows[1].name.text == 'The Long Road' and rows[2].name.text == 'Wayward Trail', 'missing only over the account')
click(c.missingOnly)

-- Back to this character: the alt's rows stop counting.
click(c.scopes.character)
assert(c.summary.text == 'Quests: 1 of 4 chains complete' and rows[1].detail.text == '1 of 2', c.summary.text)
assert(rows[4].detail.text == '2 of 4', rows[4].detail.text)
assert(EverlootWindow.shown and not U.failed)
""")
print("Lua 5.1 Collection view: off says what the tracker reads and turns it on; achievements newest first, standing bars, "
      "missing titles, this week's raids, quest chains done of total; this character's rows only, or the roster's with the "
      "holder named; empty lines when nothing is read or no key")
