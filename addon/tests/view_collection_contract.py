"""Run with: uv run --with lupa python addon/tests/view_collection_contract.py

The window's Collection view (modules/view_collection.lua): achievements, reputation, titles, raid lockouts and quest
chains. The lists are the catalog rows the completion tracker wrote; this character's achievements, reputation and
completed quests are read from the game as the view draws (no row holds them any more); titles and lockouts are rows.
It reads and displays only; with the tracker off it says what the tracker reads and offers the command that turns it
on. This character only, until Account is chosen: then every character in the roster counts for titles and lockouts,
the one that holds an item is named, and a key outside the roster never counts. The sections read from the game stay
this character's in either scope, and say so.
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
# What the game says about this character: achievements 1 and 2 earned, two standings, seven completed quests.
GAME = """
earned = { [1] = { 10, 1, 26 }, [2] = { 11, 2, 26 } }
GetAchievementInfo = function(id)
 if id < 1 or id > 4 then return nil end
 local e = earned[id]
 return id, 'Name', 10, e ~= nil, e and e[1], e and e[2], e and e[3]
end
factions = {
 { name = 'Horde', isHeader = true },
 { factionID = 76, reaction = 8, currentStanding = 42500, currentReactionThreshold = 42000, nextReactionThreshold = 42999 },
 { factionID = 530, reaction = 5, currentStanding = 4500, currentReactionThreshold = 3000, nextReactionThreshold = 9000 },
}
C_Reputation = { GetNumFactions = function() return #factions end, GetFactionDataByIndex = function(i) return factions[i] end }
FACTION_STANDING_LABEL5 = 'Amistoso'
completedQuests = { 101, 102, 201, 103, 104, 401, 402 }
questTitles = { [401] = 'A Wayward Start', [402] = 'The Middle Road' }
questLoads = {}
C_QuestLog = { GetAllCompletedQuestIDs = function() return completedQuests end,
  GetTitleForQuestID = function(id) return questTitles[id] end,
  RequestLoadQuestByID = function(id) questLoads[#questLoads + 1] = id end }
"""
API = f"now = {NOW}\ndate = os.date\nUnitGUID = function() return 'Player-1-0001' end\n" + GAME
EXTRA = ("modules/completion.lua", "modules/owned.lua")

RECORDS = f"""{{
  achievement_catalog = {{
    {{ achievementId = 1, name = 'Level 10', categoryId = 92, category = 'General', points = 10, criteriaCount = 0 }},
    {{ achievementId = 2, name = 'Explore Durotar', categoryId = 14864, category = 'Kalimdor', parentCategory = 'Exploration', points = 10, criteriaCount = 6 }},
    {{ achievementId = 3, name = 'Journeyman Fisherman', categoryId = 169, category = 'Professions', points = 0, criteriaCount = 5 }},
    {{ achievementId = 4, name = 'Zul Farrak', categoryId = 14808, category = 'Classic', parentCategory = 'Dungeons & Raids', points = 5, criteriaCount = 1 }},
  }},
  -- A row an older addon wrote is deleted at load and never read: the alt's earned achievement does not count.
  achievement_owned = {{ {{ characterKey = 'zzzz9999', achievementId = 4, completed = true, earnedOn = '2026-09-02' }} }},
  reputation_catalog = {{
    {{ factionId = 76, name = 'Orgrimmar', header = 'Horde' }},
    {{ factionId = 530, name = 'Darkspear Trolls', header = 'Horde' }},
    {{ factionId = 69, name = 'Darnassus', header = 'Alliance' }},
    {{ factionId = 2600, name = 'A Major Faction', major = true }},
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
}}"""
# Two of this player's own characters; 'yyyy0000' has rows in the file but is not in the roster.
ROSTER = f"{{ ['{ME}'] = {{ name = 'Brakka', realm = 'Forever' }}, zzzz9999 = {{ name = 'Velda', realm = 'Forever' }} }}"

HELPERS = """
local U = Everloot.Window
local function shown(rows) local n = 0; for _, r in ipairs(rows) do if r.shown then n = n + 1 end end; return n end
local function click(b) b.scripts.OnClick(b) end
local function names(rows) local t = {}; for _, r in ipairs(rows) do if r.shown then t[#t + 1] = r.name.text end end; return table.concat(t, ' | ') end
local function mark(row) if not row.done.shown then return '' end; return row.done.path:find('NotReady', 1, true) and 'missing' or (row.done.path:find('Ready', 1, true) and 'done') end
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
assert(c.offText.text:find('achievement') and c.offText.text:find('raid lockouts') and c.offText.text:find('never go in an upload')
  and c.offText.text:find('not recorded'), c.offText.text)
assert(not c.offText.text:find('talent') and not c.offText.text:find('PvP') and not c.offText.text:find('professions'), c.offText.text)
assert(c.turnOn.shown and c.turnOn.text == 'Turn on')
click(c.turnOn)
assert(EverlootDB.toggles.completion == true, 'Turn on runs /everloot completion on')
assert(c.offText.text == 'Turned on. /reload to start reading.' and not c.turnOn.shown, c.offText.text)
assert(f.shown and not U.failed)
""")

# --- On: this character's progress from the game, joined with the catalog ---
lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{ completion = true }}, records = {RECORDS} }}", API, extra=EXTRA)
lua.execute(HELPERS + f"""
assert(Everloot.CharacterKey() == '{ME}', 'the seeded key is this character')
assert(EverlootDB.records.achievement_owned == nil, 'the old row was deleted at load')
assert(U.Open('collection') == true)
local f = EverlootWindow
local c = f.collection
local rows = c.rows
assert(c.onPage.shown and not c.offPage.shown and c.missing == false and c.scope == 'character')
assert(#rows == 12 and c.sections.achievements and c.sections.reputation and c.sections.titles and c.sections.raids and c.sections.quests)
assert(c.scopes.character.text == 'This character' and c.scopes.account.text == 'Account', 'the scope buttons of the Gold tab')

-- The landing screen is the overview: one row per area with its icon, done / total, percent and a bar, the overall
-- total in the summary. An area with nothing to count shows a dash and no bar.
assert(c.section == 'overview' and c.sections.overview.text == 'Overview', 'Collection opens on the overview')
assert(c.summary.text == 'Overall: 5 of 15 (33%)', c.summary.text)
local AREAS = 'Achievements | Reputation | Titles | Quests | Dungeons & raids | Mounts | Pets | Toys | Flight paths'
assert(names(rows) == AREAS, names(rows))
-- Quests count chains, as the Quests summary does: one of four complete (the cut chain never is).
assert(rows[1].detail.text == '2 / 4 (50%)' and rows[2].detail.text == '1 / 3 (33%)' and rows[3].detail.text == '1 / 3 (33%)'
  and rows[4].detail.text == '1 / 4 (25%)', rows[4].detail.text)
assert(rows[1].bar.shown and rows[1].bar.lo == 0 and rows[1].bar.hi == 4 and rows[1].bar.value == 2, 'a bar per area')
-- Dungeons & raids counts this week's live lockout in Molten Core, not cleared.
assert(rows[5].detail.text == '0 / 1 (0%)' and rows[6].detail.text == '-' and not rows[6].bar.shown, 'nothing to count: a dash')
for i = 1, 9 do assert(rows[i].icon.shown and rows[i].icon.path:find('Interface', 1, true), 'an icon per area ' .. i) end
assert(mark(rows[1]) == '' and not rows[1].toggle.shown, 'an area row is a link, not a heading')
-- Missing only on the overview keeps the areas with something missing.
click(c.missingOnly)
assert(names(rows) == 'Achievements | Reputation | Titles | Quests | Dungeons & raids', names(rows))
click(c.missingOnly)

-- A row opens its area.
click(rows[1])
assert(c.section == 'achievements', c.section)

-- Achievements: one heading per category, the parent category above its own, closed until clicked, each with the
-- count of what is under it. Points show only when an achievement has some.
assert(c.summary.text == 'Achievements: 2 of 4 (50%) · 20 points', c.summary.text)
assert(names(rows) == 'Dungeons & Raids | Exploration | General | Professions', names(rows))
assert(rows[1].detail.text == '0 / 1 (0%)' and rows[2].detail.text == '1 / 1 (100%)', rows[1].detail.text)
assert(rows[1].toggle.shown and rows[1].toggle.path == 'Interface\\\\Buttons\\\\UI-PlusButton-Up', 'closed headings')
click(rows[2])
assert(names(rows) == 'Dungeons & Raids | Exploration | Kalimdor | Explore Durotar | General | Professions', names(rows))
assert(rows[3].detail.text == '1 / 1 (100%)', 'the sub-category counts too: ' .. rows[3].detail.text)
assert(rows[4].detail.text == '10 pts · 2026-11-02' and mark(rows[4]) == 'done', rows[4].detail.text)
assert(rows[4].name.point[2] > rows[3].name.point[2] and rows[3].name.point[2] > rows[2].name.point[2], 'each level is indented')
click(rows[6])
assert(rows[7].name.text == 'Journeyman Fisherman' and rows[7].detail.text == '' and mark(rows[7]) == 'missing',
  'no "0 pts": ' .. rows[7].detail.text)
for _, r in ipairs(rows) do assert(not (r.shown and (' ' .. r.detail.text):find('[^%d]0 pts')), 'never 0 pts') end
assert(not rows[1].bar.shown, 'bars are for reputation and quest chains')
-- Missing only, at every level: finished headings leave with everything under them; a nested missing one stays.
assert(c.missingOnly.text == 'Missing only')
click(c.missingOnly)
assert(c.missing == true and c.missingOnly.text == 'Show all')
assert(names(rows) == 'Dungeons & Raids | Professions | Journeyman Fisherman', names(rows))
click(rows[1])
assert(names(rows) == 'Dungeons & Raids | Classic | Zul Farrak | Professions | Journeyman Fisherman', names(rows))
assert(rows[3].detail.text == '5 pts', rows[3].detail.text)
click(c.missingOnly)
assert(c.missing == false and shown(rows) == 9, names(rows))

-- Reputation: one heading per header the reputation window gives, open; major factions left out, a standing bar.
click(c.sections.reputation)
assert(c.section == 'reputation' and c.summary.text == 'Reputation: 3 factions · 1 exalted', c.summary.text)
assert(names(rows) == 'Alliance | Darnassus | Horde | Darkspear Trolls | Orgrimmar', names(rows))
assert(rows[1].detail.text == '0 / 1 (0%)' and rows[3].detail.text == '1 / 2 (50%)', rows[3].detail.text)
local bar = rows[4].bar
assert(bar.shown and bar.lo == 3000 and bar.hi == 9000 and bar.value == 4500, 'the bar runs floor to ceiling')
assert(rows[4].detail.text == 'Amistoso · 4500 / 9000' and mark(rows[4]) == 'missing', rows[4].detail.text)
assert(rows[5].detail.text == 'Exalted · 42500 / 42999' and mark(rows[5]) == 'done', rows[5].detail.text)
assert(rows[2].detail.text == '-', 'a faction not listed now')
click(c.missingOnly)
assert(names(rows) == 'Alliance | Darnassus | Horde | Darkspear Trolls', 'exalted is done: ' .. names(rows))
click(c.missingOnly)

-- Titles: known of total, the missing ones listed.
click(c.sections.titles)
assert(c.summary.text == 'Titles: 1 of 3 (33%)', c.summary.text)
assert(shown(rows) == 3 and rows[1].name.text == 'Corporal' and mark(rows[1]) == 'done' and mark(rows[2]) == 'missing')
click(c.missingOnly)
assert(shown(rows) == 2 and rows[1].name.text == 'Private' and rows[2].name.text == 'Scout', 'the missing titles')
click(c.missingOnly)

-- Instances are covered by instances_contract.py, including scope and live lockouts.
click(c.sections.raids)
assert(c.sections.raids.text == 'Dungeons & raids')

-- Quests: one heading per chain, closed, with this character's quests done of its total and a bar; opened, each quest
-- with a check or a cross. A chain cut at the tracker's limit is never complete.
click(c.sections.quests)
assert(c.section == 'quests' and c.summary.text == 'Quests: 1 of 4 chains complete (25%)', c.summary.text)
-- The overview's Quests row counts the same unit as this summary.
do
  local done, total = c.summary.text:match('^Quests: (%d+) of (%d+) chains')
  click(c.sections.overview)
  assert(rows[4].name.text == 'Quests' and rows[4].detail.text:find('^' .. done .. ' / ' .. total .. ' '), rows[4].detail.text)
  click(c.sections.quests)
end
assert(names(rows) == 'Kolkar Raiders | The Defias Brotherhood | The Long Road | Wayward Trail', names(rows))
assert(rows[4].detail.text == '2 / 4 (50%)' and rows[1].detail.text == '1 / 2 (50%)', rows[4].detail.text)
assert(rows[1].bar.shown and rows[1].bar.lo == 0 and rows[1].bar.hi == 2 and rows[1].bar.value == 1, 'the bar runs to the chain total')
assert(rows[1].detail.width == 140 and rows[1].detail.point[2] + rows[1].detail.width <= rows[1].bar.point[2],
  'the detail stops before the bar')
assert(rows[1].name.point[2] + rows[1].name.width <= rows[1].detail.point[2], 'the name stops before the detail')
assert(rows[2].detail.text == '4 / 4 (100%)', 'quests from two rows count')
assert(rows[3].detail.text == 'Partly listed · 0 / 2 (0%)', rows[3].detail.text)
click(rows[4])
assert(names(rows) == 'Kolkar Raiders | The Defias Brotherhood | The Long Road | Wayward Trail | A Wayward Start | The Middle Road | Quest 403 | Quest 404', names(rows))
assert(mark(rows[5]) == 'done' and mark(rows[7]) == 'missing', 'each quest marked')
-- A quest title the client has not loaded is asked for once, and shows when the client has it.
assert(#questLoads == 2 and questLoads[1] == 403, #questLoads)
questTitles[403] = 'Into the Thicket'
drain()
assert(rows[7].name.text == 'Into the Thicket', rows[7].name.text)
assert(#questLoads == 2, 'asked once')
click(c.missingOnly)
assert(names(rows) == 'Kolkar Raiders | The Long Road | Wayward Trail | Into the Thicket | Quest 404', 'missing only hides complete chains and quests: ' .. names(rows))
-- Every listed quest of the cut chain done: it still stays, as it is never complete.
completedQuests[#completedQuests + 1] = 301; completedQuests[#completedQuests + 1] = 302
click(c.sections.quests)
assert(names(rows) == 'Kolkar Raiders | The Long Road | Wayward Trail | Into the Thicket | Quest 404', names(rows))
assert(rows[2].detail.text == 'Partly listed · 2 / 2 (100%)' and mark(rows[2]) == 'missing', rows[2].detail.text)
click(c.missingOnly)
table.remove(completedQuests); table.remove(completedQuests)
click(c.sections.quests)

-- Account with no roster: this character alone, named as such.
click(c.scopes.account)
assert(c.scope == 'account' and c.summary.text == 'Quests: 1 of 4 chains complete (25%) · this character', c.summary.text)
assert(rows[5].detail.text == 'This character', rows[5].detail.text)
click(c.scopes.character)
assert(c.scope == 'character' and rows[5].detail.text == '', rows[5].detail.text)

-- Missing only over a section where everything is done says so; the overview drops that area.
EverlootDB.records.title_owned[1].titleIds = {{ 1, 2, 3 }}
click(c.sections.titles)
click(c.missingOnly)
assert(shown(rows) == 0 and rows.empty.shown and rows.empty.text == 'Nothing missing here.', rows.empty.text)
click(c.sections.overview)
assert(names(rows) == 'Achievements | Reputation | Quests | Dungeons & raids', names(rows))
click(c.missingOnly)
assert(rows[3].detail.text == '3 / 3 (100%)' and mark(rows[3]) == 'done', 'a finished area is checked')
assert(f.shown and not U.failed)
""")

# --- On with nothing read yet ---
lua = fresh("{ installId = 'abcd-1234', toggles = { completion = true }, records = {} }", API, extra=EXTRA)
lua.execute(HELPERS + """
assert(U.Open('collection') == true)
local c = EverlootWindow.collection
-- The overview lists every area with a dash until something is read.
assert(c.summary.text == 'Overall: 0 of 0' and shown(c.rows) == 9 and c.rows[1].detail.text == '-', c.summary.text)
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
            f"now = {NOW}\ndate = os.date\nUnitGUID = function() return nil end\n" + GAME, extra=EXTRA)
lua.execute(HELPERS + """
assert(Everloot.CharacterKey() == nil)
assert(U.Open('collection') == true)
local c = EverlootWindow.collection
for _, key in ipairs({ 'overview', 'achievements', 'reputation', 'titles', 'raids', 'quests' }) do
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
click(c.sections.achievements)
assert(c.summary.text == 'Achievements: 2 of 4 (50%) · 20 points', 'This character is the default: ' .. c.summary.text)
click(c.scopes.account)
assert(c.scope == 'account')

-- Achievements are read from the game: this character's, named, and the summary says so.
assert(c.summary.text == 'Achievements: 2 of 4 (50%) · 20 points · this character', c.summary.text)
click(rows[2])
assert(rows[4].name.text == 'Explore Durotar' and rows[4].detail.text == '10 pts · 2026-11-02 · Brakka', rows[4].detail.text)
click(rows[1])
assert(rows[3].name.text == 'Zul Farrak' and mark(rows[3]) == 'missing' and rows[3].detail.text == '5 pts', 'an old row of the alt does not count')

-- Reputation: this character's standing, named.
click(c.sections.reputation)
assert(c.summary.text == 'Reputation: 3 factions · 1 exalted · this character', c.summary.text)
assert(rows[4].name.text == 'Darkspear Trolls' and rows[4].detail.text == 'Amistoso · 4500 / 9000 · Brakka' and mark(rows[4]) == 'missing', rows[4].detail.text)
assert(rows[5].name.text == 'Orgrimmar' and rows[5].detail.text == 'Exalted · 42500 / 42999 · Brakka', rows[5].detail.text)
for _, row in ipairs({rows[4], rows[5]}) do
  assert(#row.detail.text * 6 <= row.detail.width, 'standing, progress and holder fit in the detail column')
  assert(row.detail.point[2] + row.detail.width < row.bar.point[2], 'the progress bar starts after the text')
  assert(row.bar.point[2] + row.bar.width <= row.width + row.done.point[2] - row.done.width, 'the bar stops before the mark')
end

-- Titles: known on any character, named.
click(c.sections.titles)
assert(c.summary.text == 'Titles: 3 of 3 (100%)', c.summary.text)
assert(rows[1].name.text == 'Corporal' and rows[1].detail.text == 'Brakka' and rows[2].name.text == 'Private' and rows[2].detail.text == 'Velda')

-- Quests: this character's, from the game; a done quest names the character.
click(c.sections.quests)
assert(c.summary.text == 'Quests: 1 of 4 chains complete (25%) · this character', c.summary.text)
click(rows[4])
assert(rows[5].name.text == 'A Wayward Start' and rows[5].detail.text == 'Brakka' and mark(rows[5]) == 'done', rows[5].detail.text)
assert(rows[7].detail.text == '' and mark(rows[7]) == 'missing', rows[7].detail.text)
assert(rows[4].detail.text == '2 / 4 (50%)', 'the heading counts, unnamed: ' .. rows[4].detail.text)

-- The overview in the account scope: titles held by any character count, and Velda's live Zul Gurub lockout.
-- The summary stays on one line beside the scope buttons; what the account scope joins is in its hover.
click(c.sections.overview)
assert(c.summary.text == 'Overall: 7 of 16 (43%)', c.summary.text)
assert(#c.summary.text * 6 <= c.summary.width, 'the summary fits on one line: ' .. c.summary.text)
assert(c.summaryTip and c.summaryTip:find('across your characters', 1, true), tostring(c.summaryTip))

-- Back to this character: the same progress, without the names.
click(c.scopes.character)
assert(c.summary.text == 'Overall: 5 of 15 (33%)', c.summary.text)
click(c.sections.quests)
assert(rows[5].detail.text == '', rows[5].detail.text)
assert(EverlootWindow.shown and not U.failed)
""")
print("Lua 5.1 Collection view: off says what the tracker reads and turns it on; an overview of every area with totals; "
      "achievements under their categories, points only when non-zero, reputation under its headers, standing bars, "
      "missing titles, this week's raids, quest chains that open on their quests; Missing only at every level; achievements, reputation and quests read from the game "
      "for this character, titles and lockouts from rows, the roster's with the holder named; empty lines when nothing is "
      "read or no key")
