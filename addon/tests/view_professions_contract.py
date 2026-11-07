"""Run with: uv run --with lupa python addon/tests/view_professions_contract.py

The window's Professions view (modules/view_professions.lua): each profession from the game's profession book with
its rank bar, how many recipes the addon has recorded for it by difficulty colour, and when they were last read.
It reads and displays only.
"""
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

RECORDS = """{
  recipe_observed = {
    { profession = 'Cooking', recipeId = 1, difficulty = 'optimal', kindLoggedAt = '2026-11-06T09:00:00Z' },
    { profession = 'Cooking', recipeId = 2, difficulty = 'medium', kindLoggedAt = '2026-11-07T10:30:00Z' },
    { profession = 'Cooking', recipeId = 2, difficulty = 'optimal', kindLoggedAt = '2026-11-03T10:30:00Z' },
    { profession = 'Alchemy', recipeId = 3, difficulty = 'optimal', kindLoggedAt = '2026-11-08T10:30:00Z' },
  },
}"""

lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {RECORDS} }}")
lua.execute("""
local U = Everloot.Window
assert(U.Views.professions and U.Views.professions.build and U.Views.professions.refresh, 'the Professions view registers')
assert(U.Open('professions') == true)
local f = EverlootWindow
local p = f.professions
assert(f.views.professions.shown and f.subtitle.text == 'Professions' and not f.note.shown)
assert(p.blocks[1].name.text == 'Mining' and p.blocks[1].rank.text == '112 / 150', p.blocks[1].rank.text)
assert(p.blocks[1].bar.lo == 0 and p.blocks[1].bar.hi == 150 and p.blocks[1].bar.value == 112)
assert(p.blocks[1].recipes.text == 'Open the profession window to read its recipes.', p.blocks[1].recipes.text)
assert(not p.blocks[1].last.shown, 'no Last read without recipes')
assert(p.blocks[2].name.text == 'Fishing' and p.blocks[2].rank.text == '20 / 75')
local c = p.blocks[3]
assert(c.name.text == 'Cooking' and c.rank.text == '1 / 75')
assert(c.recipes.text == '2 recipes recorded: 1 orange · 1 yellow · 0 green · 0 grey', c.recipes.text)
assert(c.last.shown and c.last.text == 'Last read: 2026-11-07', c.last.text)
assert(not p.blocks[4].shown, 'only the learned professions show')
assert(p.empty.shown == false)
assert(p.footer.text == 'Full planner: everloot.app/tools/profession-planner')
assert(f.shown and not U.failed)
""")

lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {RECORDS} }}", "GetProfessions = nil\n")
lua.execute("""
local U = Everloot.Window
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
assert(p.empty.shown and p.empty.text == 'No profession book in this client.', p.empty.text)
assert(not p.blocks[1].shown)
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
# A recipe whose colour changed has a row per colour: only the newest counts. A missing max rank reads as a dash.
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
assert(b.rank.text == '-' and not U.failed)
""")
print("Lua 5.1 Professions view: book ranks with bars, recipe counts by colour and the newest read date, "
      "the open-the-window line, no book, no professions")
