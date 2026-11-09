"""Run with: uv run --with lupa python addon/tests/view_professions_contract.py

The window's Professions view (modules/view_professions.lua): each profession from the game's profession book with
its rank bar, how many recipes the addon has recorded for it by difficulty colour, when they were last read, and the
next recipes a trainer teaches at or above the current rank with cost and trainer name; under the blocks, the other
characters' professions from the roster. It reads and displays only.
"""
import zlib
from pathlib import Path
from window_world import fresh

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\view_professions.lua" in toc, "the Professions view is in the TOC"
assert toc.index("modules\\view_collection.lua") < toc.index("modules\\view_professions.lua") < toc.index("modules\\minimap.lua"), \
    "the Professions view loads after the Collection view and before the minimap button"
source = (root / "modules" / "view_professions.lua").read_text(encoding="utf-8")
code = "\n".join(line.split("--")[0] for line in source.splitlines())
for word in ["RegisterEvent", "HookScript", "hooksecurefunc", "E:Store", "EverlootDB.records[", "SendAddonMessage"]:
    assert word not in code, f"the Professions view reads and displays only: {word} found"
assert "Coming soon" not in source

# The key core.lua's E.CharacterKey gives this install and player GUID.
ME = "%08x" % zlib.adler32(b"abcd-1234:Player-1-0001")
API = "UnitGUID = function() return 'Player-1-0001' end\n"
# Mining is at rank 112: one trainer row below it, one at it, three above it (the fourth is past the three lines).
# Cooking has no trainer row. Two trainers list Copper Bar at 112; one of them has no sighting row.
RECORDS = """{
  recipe_observed = {
    { profession = 'Cooking', recipeId = 1, difficulty = 'optimal', kindLoggedAt = '2026-11-06T09:00:00Z' },
    { profession = 'Cooking', recipeId = 2, difficulty = 'medium', kindLoggedAt = '2026-11-07T10:30:00Z' },
    { profession = 'Cooking', recipeId = 2, difficulty = 'optimal', kindLoggedAt = '2026-11-03T10:30:00Z' },
    { profession = 'Alchemy', recipeId = 3, difficulty = 'optimal', kindLoggedAt = '2026-11-08T10:30:00Z' },
  },
  trainer_seen = {
    { profession = 'Mining', recipe = 'Smelt Tin', requiredRank = 100, costCopper = 500, trainerNpcId = 1234 },
    { profession = 'Mining', recipe = 'Smelt Gold', requiredRank = 150, costCopper = 2500, trainerNpcId = 1234 },
    { profession = 'Mining', recipe = 'Copper Bar', requiredRank = 112, costCopper = 1000, trainerNpcId = 1234 },
    { profession = 'Mining', recipe = 'Copper Bar', requiredRank = 112, costCopper = 1000, trainerNpcId = 9999 },
    { profession = 'Mining', recipe = 'Smelt Silver', requiredRank = 125, trainerNpcId = 9999 },
    { profession = 'Mining', recipe = 'Smelt Iron', requiredRank = 175, costCopper = 5000, trainerNpcId = 1234 },
    { profession = 'Blacksmithing', recipe = 'Rough Grinding Stone', requiredRank = 1, costCopper = 100 },
  },
  npc_sighting = {
    { npcId = 1234, name = 'Brock Stonebrow', mapId = 1 },
  },
}"""
ROSTER = f"""{{
  ['{ME}'] = {{ name = 'Samplechar', realm = 'Forever', class = 'SHAMAN', level = 24,
    professions = {{ {{ name = 'Mining', rank = 112, maxRank = 150 }} }} }},
  aaaa0001 = {{ name = 'Alt', realm = 'Forever', class = 'ROGUE', level = 12,
    professions = {{ {{ name = 'Cooking', rank = 40, maxRank = 75 }}, {{ name = 'Fishing', rank = 5 }} }} }},
  bbbb0002 = {{ name = 'Mage', realm = 'Nightfall', class = 'MAGE', level = 30 }},
}}"""

lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {RECORDS}, roster = {ROSTER} }}", API)
lua.execute("""
local U = Everloot.Window
assert(U.Views.professions and U.Views.professions.build and U.Views.professions.refresh, 'the Professions view registers')
assert(U.Open('professions') == true)
local f = EverlootWindow
local p = f.professions
assert(f.views.professions.shown and f.subtitle.text == 'Professions' and not f.note.shown)
local m = p.blocks[1]
assert(m.name.text == 'Mining' and m.rank.text == '112 / 150', m.rank.text)
assert(m.bar.lo == 0 and m.bar.hi == 150 and m.bar.value == 112)
assert(m.recipes.text == 'Open the profession window to read its recipes.', m.recipes.text)
assert(not m.last.shown, 'no Last read without recipes')
-- Trainer recipes at or above rank 112, lowest first, with cost and the trainer's name; the row at 100 and the
-- fourth row are left out, and the recipe two trainers list is one line.
assert(#m.trainer == 3, 'three trainer lines per block')
assert(m.trainer[1].shown and m.trainer[1].text == 'Rank 112: Copper Bar · ' .. U.MoneyShort(1000) .. ' · Brock Stonebrow', m.trainer[1].text)
assert(m.trainer[2].shown and m.trainer[2].text == 'Rank 125: Smelt Silver', m.trainer[2].text)
assert(m.trainer[3].shown and m.trainer[3].text == 'Rank 150: Smelt Gold · ' .. U.MoneyShort(2500) .. ' · Brock Stonebrow', m.trainer[3].text)
assert(m.height == 44 + 3 * 13, m.height)
assert(m.point[1] == 'TOPLEFT' and m.point[3] == 0)
local fi = p.blocks[2]
assert(fi.name.text == 'Fishing' and fi.rank.text == '20 / 75')
assert(fi.trainer[1].shown and fi.trainer[1].text == "Nothing from a trainer yet. Open a trainer's window.", fi.trainer[1].text)
assert(not fi.trainer[2].shown and not fi.trainer[3].shown)
assert(fi.height == 44 + 13 and fi.point[3] == -(83 + 4), 'the next block sits under the previous one: ' .. fi.point[3])
local c = p.blocks[3]
assert(c.name.text == 'Cooking' and c.rank.text == '1 / 75')
assert(c.recipes.text == '2 recipes recorded: 1 orange · 1 yellow · 0 green · 0 grey', c.recipes.text)
assert(c.last.shown and c.last.text == 'Last read: 2026-11-07', c.last.text)
assert(c.trainer[1].text == "Nothing from a trainer yet. Open a trainer's window.")
assert(c.point[3] == -(83 + 4 + 57 + 4), c.point[3])
assert(not p.blocks[4].shown, 'only the learned professions show')
assert(p.empty.shown == false)
-- Other characters, by realm then name, this character left out, professions with ranks.
assert(p.others.shown and p.others.text == 'Other characters')
assert(p.others.point[1] == 'TOPLEFT' and p.others.point[3] == -(83 + 4 + 57 + 4 + 57 + 4 + 4), p.others.point[3])
assert(p.other[1].shown and p.other[1].text == 'Alt · Forever: Cooking 40, Fishing 5', p.other[1].text)
assert(p.other[2].shown and p.other[2].text == 'Mage · Nightfall: no professions read yet', p.other[2].text)
assert(not p.other[3].shown)
assert(p.footer.text == 'Full planner: everloot.app/tools/profession-planner')
assert(p.footer.point[1] == 'BOTTOMLEFT' and p.footer.point[2] == 8 and p.footer.point[3] == 8, 'the footer sits at the bottom of the view')
assert(#p.blocks == 5, 'one block per profession book slot')
assert(f.shown and not U.failed)
""")

# Five professions share the view: two trainer lines each, every block above the footer, other characters only as they fit.
lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {RECORDS}, roster = {ROSTER} }}",
            API + "GetProfessions = function() return 1, 4, 5, 1, 4 end\n")
lua.execute("""
local U = Everloot.Window
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
local m = p.blocks[1]
assert(m.trainer[1].shown and m.trainer[2].shown and not m.trainer[3].shown, 'two trainer lines with five professions')
assert(m.trainer[2].text == 'Rank 125: Smelt Silver', m.trainer[2].text)
assert(m.height == 44 + 2 * 13)
local last = p.blocks[5]
assert(last.shown and -last.point[3] + last.height <= 390 - 24, 'the last block ends above the footer')
-- 331 of the view's 366 are blocks; one other-character row fits above the footer, the second is left out.
assert(p.others.shown and p.others.point[3] == -(70 + 57 + 57 + 70 + 57 + 5 * 4 + 4), p.others.point[3])
assert(p.other[1].shown and p.other[1].text == 'Alt · Forever: Cooking 40, Fishing 5' and not p.other[2].shown, 'only the rows that fit')
assert(EverlootWindow.shown and not U.failed)
""")

lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {RECORDS} }}", "GetProfessions = nil\n")
lua.execute("""
local U = Everloot.Window
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
assert(p.empty.shown and p.empty.text == 'No profession book in this client.', p.empty.text)
assert(not p.blocks[1].shown)
assert(p.others.shown and p.other[1].text == 'No other characters seen by this install yet.', p.other[1].text)
assert(EverlootWindow.shown and not U.failed)
""")

lua = fresh("{ installId = 'abcd-1234', toggles = {}, records = {} }", "GetProfessions = function() end\n")
lua.execute("""
local U = Everloot.Window
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
assert(p.empty.shown and p.empty.text == 'No professions learned yet.', p.empty.text)
assert(not p.blocks[1].shown and not U.failed)
""")
# A recipe whose colour changed has a row per colour: only the newest counts. A missing max rank shows the rank alone.
lua = fresh("{ installId = 'abcd-1234', toggles = {}, records = { recipe_observed = { "
            "{ profession = 'Cooking', recipeId = 9, difficulty = 'optimal', kindLoggedAt = '2026-11-01T10:00:00Z' }, "
            "{ profession = 'Cooking', recipeId = 9, difficulty = 'medium', kindLoggedAt = '2026-11-05T10:00:00Z' } } } }",
            "GetProfessionInfo = function(i) if i == 1 then return 'Cooking', 'x', 5, nil end end; "
            "GetProfessions = function() return 1 end")
lua.execute("""
local U = Everloot.Window
assert(U.Open('professions') == true)
local b = EverlootWindow.professions.blocks[1]
assert(b.recipes.text == '1 recipe recorded: 0 orange · 1 yellow · 0 green · 0 grey', b.recipes.text)
assert(b.last.text == 'Last read: 2026-11-05', b.last.text)
assert(b.rank.text == '5' and not U.failed, b.rank.text)
""")
print("Lua 5.1 Professions view: book ranks with bars, recipe counts by colour and the newest read date, next trainer "
      "recipes with cost and trainer, other characters' professions, the open-the-window line, no book, no professions")
