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

# Crafting costs. Recipes name their reagents; item_seen rows give the ids the price file is keyed by. The character
# has Mining, Fishing and Cooking: the Alchemy recipe and the recipe stored without reagents are not listed.
CRAFT_RECORDS = """{
  recipe_observed = {
    { profession = 'Mining', recipe = 'Smelt Copper', recipeId = 10, learned = true, productItemId = 2840,
      reagents = { { item = 'Copper Ore', count = 2 } } },
    { profession = 'Mining', recipe = 'Smelt Copper', recipeId = 10, learned = true, productItemId = 2840,
      reagents = { { item = 'Copper Ore', count = 1 } } },
    { profession = 'Cooking', recipe = 'Spiced Wolf Meat', recipeId = 11, learned = true, productItemId = 2680,
      reagents = { { item = 'Wolf Meat', count = 1 }, { item = 'Mild Spices', count = 1 } } },
    { profession = 'Cooking', recipe = 'Herb Baked Egg', recipeId = 12, learned = true, productItemId = 6888,
      reagents = { { item = 'Small Egg', count = 1 }, { item = 'Mild Spices', count = 1 } } },
    { profession = 'Cooking', recipe = 'Boiled Clams', recipeId = 13, learned = true, productItemId = 5525,
      reagents = { { item = 'Clam Meat', count = 1 }, { item = 'Refreshing Spring Water', count = 1 } } },
    { profession = 'Cooking', recipe = 'Mystery Stew', recipeId = 14, learned = true, productItemId = 12791,
      reagents = { { item = 'Goretusk Snout', count = 1 }, { item = 'Crag Boar Rib', count = 2 } } },
    { profession = 'Cooking', recipe = 'Any Fish', recipeId = 15, learned = true, productItemId = 6290, reagents = {} },
    { profession = 'Alchemy', recipe = 'Minor Healing Potion', recipeId = 16, learned = true, productItemId = 118,
      reagents = { { item = 'Peacebloom', count = 1 } } },
  },
  item_seen = {
    { itemId = 2770, name = 'Copper Ore' }, { itemId = 2672, name = 'Wolf Meat' }, { itemId = 2678, name = 'Mild Spices' },
    { itemId = 6889, name = 'Small Egg' }, { itemId = 159, name = 'Refreshing Spring Water' }, { itemId = 2447, name = 'Peacebloom' },
  },
  vendor = {
    { vendorNpcId = 1, items = { { itemId = 2678, priceCopper = 12 }, { itemId = 2770, priceCopper = 30 }, { itemId = 159, priceCopper = 25 } } },
    { vendorNpcId = 2, items = { { itemId = 2678, priceCopper = 10 }, { itemId = 6889, priceCopper = 0 } } },
  },
}"""
# itemId,market,min,historical,quantity,day,reporters. Mild Spices sells at a vendor for less than its market value;
# Copper Ore's vendor price is higher than its market value; Herb Baked Egg (6888) has no price.
PRICE_ROWS = ";".join([
    "2770,20,18,22,400,2026-10-29,5", "2840,150,140,160,90,2026-10-29,5", "2672,50,45,55,60,2026-10-29,4",
    "2678,40,35,45,30,2026-10-29,3", "6889,30,28,32,40,2026-10-29,3", "2680,45,40,50,25,2026-10-29,3",
    "5525,100,90,110,12,2026-10-29,3", "12791,500,450,550,9,2026-10-29,3",
])


def price_file(as_of: str) -> str:
    return (f"EverlootPricesDB = {{ realms = {{ forever = {{ data = '{PRICE_ROWS}', sum = {zlib.adler32(PRICE_ROWS.encode())}, "
            f"dataAsOf = '{as_of}' }} }} }}\n")


lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {CRAFT_RECORDS} }}", API + price_file("2026-10-29T06:00:00Z"))
lua.execute("""
local U, E = Everloot.Window, Everloot
local M = U.MoneyShort
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
assert(p.toggle.text == 'Crafting costs' and not p.craft.page.shown, 'the blocks show first')
assert(p.toggle.point[1] == 'BOTTOMRIGHT' and p.footer.width == 604 - 160, 'the button sits beside the footer')
-- Each item's price is looked up once per redraw, however many recipes use it.
local calls = {}
local real = E.CommunityPrice
E.CommunityPrice = function(self, realm, id) calls[id] = (calls[id] or 0) + 1; return real(self, realm, id) end
p.toggle.scripts.OnClick()
local c = p.craft
assert(c.page.shown and p.toggle.text == 'Ranks and trainers' and not p.blocks[1].shown and not p.others.shown)
for id, n in pairs(calls) do assert(n == 1, 'item ' .. id .. ' priced ' .. n .. ' times in one redraw') end
assert(calls[2678] == 1 and calls[2840] == 1)
assert(c.age.text == 'Market values from the price file built 2026-10-29 (1 day ago), all houses; a vendor price when it is lower.', c.age.text)
assert(c.note.text == 'Value and profit are per item: how many items a craft makes is not recorded.')
assert(c.head.value.text == 'Value per item')
local function row(i) local r = c.rows[i]; return r.shown and r.name.text or nil end
-- Sorted by profit: known profits highest first, then no product price, then unknown costs, by name.
assert(row(1) == 'Smelt Copper' and row(2) == 'Spiced Wolf Meat' and row(3) == 'Herb Baked Egg'
  and row(4) == 'Boiled Clams' and row(5) == 'Mystery Stew' and not c.rows[6].shown, tostring(row(1)))
local r1 = c.rows[1]
-- Priced: the newest row's reagents (one Copper Ore at its 20c market value, not the vendor's 30c).
assert(r1.cost.text == M(20) and r1.value.text == M(150) and r1.profit.text == M(130), r1.cost.text)
assert(r1.name.color[2] == U.COLORS.accent[2], 'the chosen recipe is lit')
-- A vendor sells Mild Spices for 10c, under its 40c market value: 50 + 10 against 45.
local r2 = c.rows[2]
assert(r2.cost.text == M(60) and r2.value.text == M(45) and r2.profit.text == M(-15), r2.profit.text)
-- No output price: the cost stands, the value says so, no profit.
local r3 = c.rows[3]
assert(r3.cost.text == M(40) and r3.value.shown and r3.value.text == 'no price' and r3.profit.text == '-', r3.value.text)
-- Partly unpriced: never a zero.
local r4 = c.rows[4]
assert(r4.cost.text == 'cost unknown (1 reagent unpriced)' and not r4.value.shown and r4.profit.text == '-', r4.cost.text)
assert(c.rows[5].cost.text == 'cost unknown (2 reagents unpriced)', c.rows[5].cost.text)
for i = 1, 5 do assert(not c.rows[i].cost.text:find('^0') and c.rows[i].cost.text ~= M(0)) end

-- What to buy for the first row by default.
local b = c.buy
assert(b.title.text == 'What to buy: 1 × Smelt Copper', b.title.text)
assert(b.lines[1].shown and b.lines[1].text == '1 × Copper Ore · ' .. M(20) .. ' each · ' .. M(20), b.lines[1].text)
assert(not b.lines[2].shown and b.total.text == 'Total: ' .. M(20), b.total.text)
-- Choose Spiced Wolf Meat and eleven crafts.
c.rows[2].scripts.OnClick()
b.steps[4].scripts.OnClick()
assert(b.title.text == 'What to buy: 11 × Spiced Wolf Meat', b.title.text)
assert(b.lines[1].text == '11 × Wolf Meat · ' .. M(50) .. ' each · ' .. M(550), b.lines[1].text)
assert(b.lines[2].text == '11 × Mild Spices · ' .. M(10) .. ' each (vendor) · ' .. M(110), b.lines[2].text)
assert(b.total.text == 'Total: ' .. M(660), b.total.text)
assert(c.rows[2].name.color[2] == U.COLORS.accent[2] and c.rows[1].name.color[2] == U.COLORS.text[2])
-- The count stays between 1 and 999.
for _ = 1, 3 do b.steps[1].scripts.OnClick() end
assert(c.count == 1 and b.title.text == 'What to buy: 1 × Spiced Wolf Meat', b.title.text)
for _ = 1, 120 do b.steps[4].scripts.OnClick() end
assert(c.count == 999, c.count)
for _ = 1, 100 do b.steps[1].scripts.OnClick() end
b.steps[3].scripts.OnClick()
assert(c.count == 2, c.count)
-- Partly unpriced totals say what is missing and what the priced reagents cost.
c.rows[4].scripts.OnClick()
assert(b.lines[1].text == '2 × Clam Meat · no price', b.lines[1].text)
assert(b.lines[2].text == '2 × Refreshing Spring Water · ' .. M(25) .. ' each (vendor) · ' .. M(50), b.lines[2].text)
assert(b.total.text == 'Total unknown: 1 reagent unpriced · the priced ones ' .. M(50), b.total.text)
c.rows[5].scripts.OnClick()
assert(b.total.text == 'Total unknown: 2 reagents unpriced', b.total.text)

-- Sort by name, then only the profitable ones; the chosen recipe keeps its what-to-buy list while filtered out.
c.sortButton.scripts.OnClick()
assert(c.sortButton.text == 'Sort: name')
assert(row(1) == 'Boiled Clams' and row(2) == 'Herb Baked Egg' and row(3) == 'Mystery Stew' and row(4) == 'Smelt Copper'
  and row(5) == 'Spiced Wolf Meat', tostring(row(1)))
c.filterButton.scripts.OnClick()
assert(c.filterButton.text == 'Show all' and row(1) == 'Smelt Copper' and not c.rows[2].shown)
assert(b.title.text == 'What to buy: 2 × Mystery Stew', b.title.text)
c.sortButton.scripts.OnClick()
c.filterButton.scripts.OnClick()

-- A row stored since the last redraw is read without reading the others again.
table.insert(EverlootDB.records.recipe_observed, { profession = 'Mining', recipe = 'Smelt Tin', recipeId = 17, learned = true,
  productItemId = 3576, reagents = { { item = 'Copper Ore', count = 3 } } })
c.sortButton.scripts.OnClick()
c.sortButton.scripts.OnClick()
-- No product price: after Herb Baked Egg by name.
assert(row(4) == 'Smelt Tin' and c.rows[4].cost.text == M(60) and c.rows[4].value.text == 'no price', tostring(row(4)))
-- Back to the blocks.
p.toggle.scripts.OnClick()
assert(not c.page.shown and p.blocks[1].shown and p.toggle.text == 'Crafting costs')
assert(EverlootWindow.shown and not U.failed)
""")

# Without a price file only vendor prices count; an old file says so in the warning red.
lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {CRAFT_RECORDS} }}", API)
lua.execute("""
local U = Everloot.Window
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
p.toggle.scripts.OnClick()
local c = p.craft
assert(c.age.text:find('^No price file in the game yet'), c.age.text)
local names = {}
for i = 1, 5 do names[c.rows[i].name.text] = c.rows[i] end
assert(names['Spiced Wolf Meat'].cost.text == 'cost unknown (1 reagent unpriced)')
assert(names['Smelt Copper'].cost.text == U.MoneyShort(30) and names['Smelt Copper'].value.text == 'no price')
assert(not U.failed)
""")
lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {CRAFT_RECORDS} }}", API + price_file("2026-10-20T06:00:00Z"))
lua.execute("""
local U = Everloot.Window
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
p.toggle.scripts.OnClick()
local c = p.craft
assert(c.age.text == 'OLD FILE: market values from 2026-10-20 (10 days ago). The Everloot Desktop App refreshes it, then /reload.', c.age.text)
assert(c.age.color[1] == 1 and c.age.color[2] == 0.4)
assert(not U.failed)
""")
# No recipes recorded: the page says how to read them, and the what-to-buy box asks for a recipe.
lua = fresh("{ installId = 'abcd-1234', toggles = {}, records = {} }", API)
lua.execute("""
local U = Everloot.Window
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
p.toggle.scripts.OnClick()
local c = p.craft
assert(c.rows.empty.shown and c.rows.empty.text:find('^No recipes with reagents recorded'), c.rows.empty.text)
assert(not c.rows[1].shown and c.buy.total.text == 'Choose a recipe in the list.' and not U.failed)
""")
print("Lua 5.1 Professions view: book ranks with bars, recipe counts by colour and the newest read date, next trainer "
      "recipes with cost and trainer, other characters' professions, the open-the-window line, no book, no professions; "
      "crafting costs with vendor-cheaper reagents, unpriced reagents and products, profit and name sort, the profitable "
      "filter, what-to-buy totals and the price file's age")
