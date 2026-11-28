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
# Every character the window draws is one the game's fonts have: the Scan column's arrows drew as empty boxes.
# Comments aside, the file's only non-ASCII characters are the middle dot, the times sign and the em dash.
for ch in set(code):
    assert ord(ch) < 128 or ch in "·×—", f"a character the font may not draw: {ch!r} (U+{ord(ch):04X})"

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
-- One line for the trainer: the lowest recipe at or above rank 112. The addon cannot tell whether this character
-- already trained it, so it says "At your rank" in the text colour, never "Learn now" in the accent; the full list is
-- on Ranks and trainers.
assert(m.next.shown and m.next.text == 'At your rank: Copper Bar · ' .. U.MoneyShort(1000) .. ' · Brock Stonebrow', m.next.text)
assert(m.next.color[2] == U.COLORS.text[2] and m.next.color[1] == U.COLORS.text[1], 'a recipe at your rank is plain, not lit')
assert(rawget(m, 'trainer') == nil, 'no wall of trainer lines in the list')
assert(m.height == 60, m.height)
assert(m.point[1] == 'TOPLEFT' and m.point[3] == 0)
local fi = p.blocks[2]
assert(fi.name.text == 'Fishing' and fi.rank.text == '20 / 75')
assert(fi.next.text == "Nothing from a trainer yet. Open a trainer's window.", fi.next.text)
assert(fi.next.color[2] == U.COLORS.muted[2])
assert(fi.height == 60 and fi.point[3] == -64, 'the next block sits under the previous one: ' .. fi.point[3])
local c = p.blocks[3]
assert(c.name.text == 'Cooking' and c.rank.text == '1 / 75')
-- Each colour's count in the game's own difficulty colour; colours with no recipe are left out.
assert(c.recipes.text == '2 recipes: |cffff80401 orange|r · |cffffff001 yellow|r', c.recipes.text)
assert(c.last.shown and c.last.text == 'Last read: 2026-11-07', c.last.text)
assert(c.point[3] == -128, c.point[3])
-- Nothing truncates: every line fits its width (the stub world's 6 px a character).
for i = 1, 3 do
  local b = p.blocks[i]
  for _, s in ipairs({ b.name, b.recipes, b.next }) do
    local plain = s.text:gsub('|c%x%x%x%x%x%x%x%x', ''):gsub('|r', ''):gsub('|T.-|t', 'xx')
    assert(#plain * 6 <= s.width, 'fits: ' .. plain .. ' in ' .. s.width)
  end
end
assert(not p.blocks[4].shown, 'only the learned professions show')
assert(p.empty.shown == false)
-- Other characters, by realm then name, this character left out, professions with ranks.
assert(p.others.shown and p.others.text == 'Other characters')
assert(p.others.point[1] == 'TOPLEFT' and p.others.point[3] == -(3 * 64 + 4), p.others.point[3])
assert(p.other[1].shown and p.other[1].text == 'Alt · Forever: Cooking 40, Fishing 5', p.other[1].text)
assert(p.other[2].shown and p.other[2].text == 'Mage · Nightfall: no professions read yet', p.other[2].text)
assert(not p.other[3].shown)
assert(p.footer.text == 'Planner: everloot.app/tools/profession-planner')
assert(p.footer.point[1] == 'BOTTOMLEFT' and p.footer.point[2] == 8 and p.footer.point[3] == 8, 'the footer sits at the bottom of the view')
assert(#p.footer.text * 6 <= p.footer.width, 'the footer fits beside the two buttons')
-- Two buttons name the other two screens.
assert(p.nav.text == 'Ranks and trainers' and p.toggle.text == 'Crafting costs', p.nav.text)
assert(p.toggle.point[1] == 'BOTTOMRIGHT' and p.nav.point[1] == 'BOTTOMRIGHT')
assert(8 + p.footer.width <= 604 + p.nav.point[2] - p.nav.width, 'the footer ends before the buttons')
assert(#p.blocks == 5, 'one block per profession book slot')
assert(f.shown and not U.failed)
""")

# Five professions share the view: every block above the footer, other characters only as they fit.
lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {RECORDS}, roster = {ROSTER} }}",
            API + "GetProfessions = function() return 1, 4, 5, 1, 4 end\n")
lua.execute("""
local U = Everloot.Window
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
local last = p.blocks[5]
assert(last.shown and -last.point[3] + last.height <= 390 - 24, 'the last block ends above the footer')
-- 320 of the view's 366 are blocks; one other-character row fits above the footer, the second is left out.
assert(p.others.shown and p.others.point[3] == -(5 * 64 + 4), p.others.point[3])
assert(p.other[1].shown and p.other[1].text == 'Alt · Forever: Cooking 40, Fishing 5' and not p.other[2].shown, 'only the rows that fit')
assert(EverlootWindow.shown and not U.failed)
""")

# Ranks and trainers: per profession, what a trainer teaches next, at what rank, for how much and where. Grouped
# under each profession's heading, the trainer named once for a run of its recipes, the zone from its sighting.
TRAINER_API = API + "C_Map = { GetMapInfo = function(id) if id == 1 then return { name = 'Elwynn Forest' } end end }\n"
lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {RECORDS}, roster = {ROSTER} }}", TRAINER_API)
lua.execute("""
local U = Everloot.Window
local M = U.MoneyShort
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
p.nav.scripts.OnClick()
local t = p.trainers
assert(t.page.shown and not p.craft.page.shown and not p.blocks[1].shown and not p.others.shown and not p.other[1].shown)
assert(p.nav.text == 'Professions' and p.toggle.text == 'Crafting costs', p.nav.text)
assert(t.head.rank.text == 'Rank' and t.head.recipe.text == 'Recipe' and t.head.cost.text == 'Cost'
  and t.head.where.text == 'Trainer', t.head.where.text)
-- The columns never run together, and each heading fits its column.
local order = { 'rank', 'recipe', 'cost', 'where' }
for i, k in ipairs(order) do
  local s = t.head[k]
  assert(#s.text * 6 <= s.width, k)
  if order[i + 1] then assert(s.point[2] + s.width <= t.head[order[i + 1]].point[2], k .. ' overlaps') end
end
local s = t.sections[1]
assert(s.shown and s.name.text == 'Mining', s.name.text)
assert(s.summary.text == '112 / 150 · 1 at your rank', s.summary.text)
-- Lowest rank first. The row at 100 is below the character's rank and left out; Copper Bar, listed by two trainers,
-- is one row. A rank at the character's rank is in the text colour (it may already be trained), a later one muted.
local r = s.rows
assert(r[1].shown and r[1].rank.text == '112' and r[1].rank.color[1] == U.COLORS.text[1], r[1].rank.text)
assert(r[1].recipe.text == 'Copper Bar' and r[1].cost.text == M(1000), r[1].recipe.text)
assert(r[1].where.text == 'Brock Stonebrow · Elwynn Forest', r[1].where.text)
assert(r[2].rank.text == '125' and r[2].rank.color[2] == U.COLORS.muted[2] and r[2].recipe.text == 'Smelt Silver')
assert(r[2].cost.text == '-' and r[2].where.text == 'Trainer not seen', r[2].where.text)
assert(r[3].rank.text == '150' and r[3].cost.text == M(2500) and r[3].where.text == 'Brock Stonebrow · Elwynn Forest')
-- The same trainer as the row above is not named again.
assert(r[4].shown and r[4].rank.text == '175' and r[4].recipe.text == 'Smelt Iron' and r[4].where.text == '', r[4].where.text)
assert(not r[5].shown)
assert(s.point[3] == -20, s.point[3])
local fish = t.sections[2]
assert(fish.name.text == 'Fishing' and fish.summary.text == '20 / 75 · no trainer seen', fish.summary.text)
assert(fish.rows[1].shown and fish.rows[1].recipe.text == "Nothing from a trainer yet. Open a trainer's window.")
assert(fish.rows[1].rank.text == '' and fish.rows[1].cost.text == '' and not fish.rows[2].shown)
-- Each section is as tall as its rows and sits under the one before.
assert(fish.point[3] == s.point[3] - s.height - 4, fish.point[3])
assert(t.sections[3].shown and t.sections[3].name.text == 'Cooking' and not t.sections[4].shown)
for _, sec in ipairs(t.sections) do
  if sec.shown then assert(-sec.point[3] + sec.height <= 366, 'above the footer') end
end
-- Back to the list.
p.nav.scripts.OnClick()
assert(not t.page.shown and p.blocks[1].shown and p.nav.text == 'Ranks and trainers' and not U.failed)
""")
# Task 7: a trainer row's hover estimates its profit and training payback from the recorded recipe spell ID and the
# schematic the client can read for it, priced like every other estimate. Same-name recipes stay separate rows, each
# with its own spell; an item ID is never used as the spell; a row without a spell ID makes no claim.
PAYBACK_RECORDS = """{
  trainer_seen = {
    { profession = 'Mining', recipe = 'Smelt Bronze', requiredRank = 120, costCopper = 1001, trainerNpcId = 1234, spellId = 3001 },
    { profession = 'Mining', recipe = 'Smelt Bronze', requiredRank = 120, costCopper = 1001, trainerNpcId = 1234, spellId = 3002 },
    { profession = 'Mining', recipe = 'Smelt Bronze', requiredRank = 120, costCopper = 1001, trainerNpcId = 1234 },
    { profession = 'Mining', recipe = 'Smelt Brass', requiredRank = 121, costCopper = 1001, trainerNpcId = 1234, productItemId = 3001 },
  },
}"""
PAYBACK_API = API + """
GameTooltip = { lines = {} }
function GameTooltip:SetOwner(owner) self.owner, self.lines = owner, {} end
function GameTooltip:IsOwned(owner) return self.owner == owner end
function GameTooltip:AddLine(text) table.insert(self.lines, text) end
function GameTooltip:Show() self.shown = true end
function GameTooltip:Hide() self.shown = false; self.owner = nil end
local function slot(id) return { required = true, dataSlotType = 1, reagentType = 1, quantityRequired = 1, reagents = { { itemID = id } } } end
schematics = {
  [3001] = { recipeID = 3001, outputItemID = 12, quantityMin = 1, quantityMax = 1, reagentSlotSchematics = { slot(11) } },
  [3002] = { recipeID = 3002, outputItemID = 12, quantityMin = 1, quantityMax = 1, reagentSlotSchematics = { slot(13) } },
}
C_TradeSkillUI = { GetRecipeSchematic = function(id, recraft) return schematics[id] end }
"""
lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {PAYBACK_RECORDS}, roster = {ROSTER} }}", PAYBACK_API)
# The schematic reader the trainer estimate shares with the profession window loads after this view, as in the TOC.
lua.execute((root / "modules" / "native_crafting.lua").read_text(encoding="utf-8"))
lua.execute("""
local prices = { [11] = 450, [12] = 1000, [13] = 950 }
function Everloot:CommunityPrice(realm, id) if prices[id] then return { market = prices[id], day = '2026-10-30' } end end
function Everloot:PriceFile(realm) return { status = 'ready', house = 'Alliance', asOf = '2026-10-30' } end
local U = Everloot.Window
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
p.nav.scripts.OnClick()
local r = p.trainers.sections[1].rows
local function hover(line) line.scripts.OnEnter(line); return table.concat(GameTooltip.lines, '\\n') end
assert(r[1].recipe.text == 'Smelt Bronze' and r[2].recipe.text == 'Smelt Bronze' and r[3].recipe.text == 'Smelt Brass',
  'two same-name recipes with their own spell IDs are two rows; the name-only copy is not a third')
assert(not r[4].shown, tostring(r[4].recipe.text))
local said = hover(r[1])
assert(said:find('Repays ' .. U.Money(1001) .. ' training after 3 profitable crafts', 1, true), said)
said = hover(r[2])
assert(said:find('No payback', 1, true) and not said:find('Repays', 1, true), 'the other spell breaks even: ' .. said)
said = hover(r[3])
assert(said:find('No payback estimate', 1, true) and not said:find('Repays', 1, true), 'an item ID is not a recipe spell: ' .. said)
r[3].scripts.OnLeave(r[3])
assert(not GameTooltip.shown and not U.failed)
""")

# Five professions: two rows each, the rest counted in the heading, every section above the footer.
lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {RECORDS} }}",
            TRAINER_API + "GetProfessions = function() return 1, 4, 5, 1, 4 end\n")
lua.execute("""
local U = Everloot.Window
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
p.nav.scripts.OnClick()
local t = p.trainers
local s = t.sections[1]
assert(s.rows[2].shown and not s.rows[3].shown, 'two rows with five professions')
assert(s.summary.text == '112 / 150 · 1 at your rank · 2 more', s.summary.text)
local last = t.sections[5]
assert(last.shown and -last.point[3] + last.height <= 366, 'the last section ends above the footer')
assert(not U.failed)
""")
# No profession book: the trainers screen says so.
lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {RECORDS} }}", "GetProfessions = nil\n")
lua.execute("""
local U = Everloot.Window
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
p.nav.scripts.OnClick()
assert(p.empty.shown and p.empty.text == 'No profession book in this client.' and not p.trainers.sections[1].shown)
assert(not U.failed)
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
assert(b.recipes.text == '1 recipe: |cffffff001 yellow|r', b.recipes.text)
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
# The public vendor rows above are offers, not unit prices; this install's merchant windows proved these lowest unit
# prices for one item with no extra cost, as this character, now, on this build (openworld.lua keeps them beside the
# records, never in them; window_world's unitEvidence writes them).
UNITS = "{ [2678] = 10, [2770] = 30, [159] = 25 }"
# What each crafting recipe makes, as this install recorded it from the profession window (recipeOutput): a stored row
# has a sale only with a recorded output, never an assumed one.
CRAFT_OUTPUTS = ("[11] = { itemId = 2680, minimum = 1, maximum = 1 }, [12] = { itemId = 6888, minimum = 1, maximum = 1 }, "
                 "[13] = { itemId = 5525, minimum = 1, maximum = 1 }, [14] = { itemId = 12791, minimum = 1, maximum = 1 }")
# itemId,market,min,historical,quantity,day,reporters. Mild Spices sells at a vendor for less than its market value;
# Copper Ore's vendor price is higher than its market value; Herb Baked Egg (6888) has no price.
PRICE_ROWS = ";".join([
    "2770,20,18,22,400,2026-10-29,5", "2840,150,140,160,90,2026-10-29,5", "2672,50,45,55,60,2026-10-29,4",
    "2678,40,35,45,30,2026-10-29,3", "6889,30,28,32,40,2026-10-29,3", "2680,45,40,50,25,2026-10-29,3",
    "5525,100,90,110,12,2026-10-29,3", "12791,500,450,550,9,2026-10-29,3",
])


def price_file(as_of: str) -> str:
    return (f"EverlootPricesDB = {{ realms = {{ ['forever|alliance'] = {{ data = '{PRICE_ROWS}', sum = {zlib.adler32(PRICE_ROWS.encode())}, "
            f"dataAsOf = '{as_of}' }} }} }}\n")


lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {CRAFT_RECORDS}, "
            "recipeOutput = { [10] = { itemId = 2840, minimum = 2, maximum = 2 }, " + CRAFT_OUTPUTS + " } }",
            API + price_file("2026-10-29T06:00:00Z"), extra=("modules/sellcheck.lua",))
lua.execute("unitEvidence(" + UNITS + ")")
lua.execute("""
local U, E = Everloot.Window, Everloot
local M = U.MoneyShort
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
assert(p.toggle.text == 'Crafting costs' and not p.craft.page.shown, 'the blocks show first')
-- Each item's price is looked up once per redraw, however many recipes use it.
local calls = {}
local real = E.CommunityPrice
E.CommunityPrice = function(self, realm, id) calls[id] = (calls[id] or 0) + 1; return real(self, realm, id) end
p.toggle.scripts.OnClick()
local c = p.craft
assert(c.page.shown and p.toggle.text == 'Ranks and trainers' and p.nav.text == 'Professions' and not p.blocks[1].shown and not p.others.shown)
for id, n in pairs(calls) do assert(n == 1, 'item ' .. id .. ' priced ' .. n .. ' times in one redraw') end
assert(calls[2678] == 1 and calls[2840] == 1)
-- One dedicated source line below the buttons; the full sentence is in its hover.
assert(c.age.text == 'Alliance AH prices, 2026-10-29 (1 day ago)', c.age.text)
assert(c.ageDetail == 'Market values from the price file built 2026-10-29 (1 day ago), Alliance auction house; a vendor price when it is lower.', c.ageDetail)
assert(#c.age.text * 6 <= c.age.width, 'the source line fits on one line')
assert(c.age.point[1] == 'TOPLEFT' and -c.age.point[3] > -c.filterButton.point[3] + c.filterButton.height,
  'the source line starts below the buttons')
-- Nothing is drawn over it: the list box starts under the line, and the note sits inside the list box.
assert(-c.age.point[3] + 12 <= -c.list.point[3], 'the list box starts under the source line')
assert(c.note.point[1] == 'BOTTOMLEFT', 'the note sits at the bottom of the list box')
assert(c.note.text == 'Select a recipe for the cost and profit breakdown.', c.note.text)
assert(#c.note.text * 6 <= c.note.width, 'the note fits on one line')
GameTooltip = { lines = {}, SetOwner = function(self) self.lines = {} end,
  AddLine = function(self, s) self.lines[#self.lines + 1] = s end,
  Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end }
c.source.scripts.OnEnter(c.source)
local help = table.concat(GameTooltip.lines, '|')
assert(help:find(c.ageDetail, 1, true) and help:find('the estimate assumes one', 1, true), help)
assert(help:find('Green profit is a gain, red is a loss', 1, true) and help:find('listings, not sales', 1, true), help)
c.source.scripts.OnLeave(); assert(not GameTooltip.shown)
GameTooltip = nil
-- The column headings: readable words, each fitting its column, never running together.
assert(c.head.name.text == 'Recipe' and c.head.cost.text == 'Craft cost' and c.head.value.text == 'Item value'
  and c.head.profit.text == 'Profit / craft' and c.head.change.text == 'Your scans', c.head.profit.text)
local order = { 'name', 'cost', 'value', 'profit', 'change' }
for i, k in ipairs(order) do
  local h = c.head[k]
  assert(#h.text * 6 <= h.width, k .. ' fits')
  local nxt = order[i + 1] and c.head[order[i + 1]]
  if nxt then assert(h.point[2] + h.width < nxt.point[2], k .. ' runs into ' .. order[i + 1]) end
end
assert(c.sortButton.text == 'Sort: est. profit' and c.filterButton.text == 'Est. profitable only', c.filterButton.text)
local function row(i) local r = c.rows[i]; return r.shown and r.name.text or nil end
-- Sorted by profit: known profits highest first, then no product price, then unknown costs, by name.
assert(row(1) == 'Smelt Copper' and row(2) == 'Spiced Wolf Meat' and row(3) == 'Herb Baked Egg'
  and row(4) == 'Boiled Clams' and row(5) == 'Mystery Stew' and not c.rows[6].shown, tostring(row(1)))
local r1 = c.rows[1]
-- Priced: the newest row's reagents (one Copper Ore at its 20c market value, not the vendor's 30c). A gain is signed
-- and green.
assert(r1.cost.text == M(20) and r1.value.text == M(150) and r1.profit.text == '+' .. M(265), r1.profit.text)
assert(r1.profit.color[1] == U.COLORS.accent[1] and r1.profit.color[2] == U.COLORS.accent[2], 'a gain is green')
assert(r1.name.color[2] == U.COLORS.accent[2], 'the chosen recipe is lit')
-- A vendor sells Mild Spices for 10c, under its 40c market value: 50 + 10 against 45. A loss is red.
local r2 = c.rows[2]
assert(r2.cost.text == M(60) and r2.value.text == M(45) and r2.profit.text == M(-18), r2.profit.text)
assert(r2.profit.color[1] == 1 and r2.profit.color[2] == 0.4 and r2.profit.color[3] == 0.4, 'a loss is red')
-- No output price: the cost stands, the value says so, no profit.
local r3 = c.rows[3]
assert(r3.cost.text == M(40) and r3.value.shown and r3.value.text == 'no price' and r3.profit.text == '-', r3.value.text)
assert(r3.profit.color[2] == U.COLORS.muted[2], 'no profit is muted')
-- Partly unpriced: never a zero, and the product's value still shows.
local r4 = c.rows[4]
assert(r4.cost.text == '1 unpriced' and r4.value.shown and r4.value.text == M(100) and r4.profit.text == '-', r4.cost.text)
assert(c.rows[5].cost.text == '2 unpriced' and c.rows[5].value.text == M(500), c.rows[5].cost.text)
assert(#c.rows[5].cost.text * 6 <= c.rows[5].cost.width, 'an unknown cost fits its column')
for i = 1, 5 do assert(not c.rows[i].cost.text:find('^0') and c.rows[i].cost.text ~= M(0)) end

-- What to buy for the first row by default.
local b = c.buy
assert(b.title.text == 'What to buy: 1 × Smelt Copper', b.title.text)
assert(not b.route.shown, 'without the planner there is no route choice')
assert(b.lines[1].shown and b.lines[1].text == '1 × Copper Ore · ' .. M(20) .. ' each · ' .. M(20), b.lines[1].text)
assert(not b.lines[2].shown and b.total.text == 'Total: ' .. M(20), b.total.text)
assert(not b.up.shown and not b.down.shown, 'one reagent needs no paging')
assert(b.output.text == 'Makes 2 items per craft · ' .. U.Money(10) .. ' materials per item', b.output.text)
assert(not b.math.shown)
b.details.scripts.OnClick()
assert(b.math.shown and b.math.text == 'Sale: ' .. U.Money(300) .. ' - 5% AH cut: ' .. U.Money(15)
  .. ' - materials: ' .. U.Money(20) .. ' = ' .. U.Money(265) .. ' profit', b.math.text)
b.details.scripts.OnClick()
assert(not b.math.shown and b.lines[1].shown)
EverlootDB.recipeOutput[10].maximum = 3
r1.scripts.OnClick()
assert(b.output.text == 'Makes 2-3 items per craft · ' .. U.Money(8) .. ' materials per item (avg.)', b.output.text)
assert(r1.profit.text == '+' .. M(336), r1.profit.text)
-- Choose Spiced Wolf Meat and eleven crafts.
c.rows[2].scripts.OnClick()
IsShiftKeyDown = function() return true end
b.steps[2].scripts.OnClick()
assert(b.title.text == 'What to buy: 11 × Spiced Wolf Meat', b.title.text)
assert(b.lines[1].text == '11 × Wolf Meat · ' .. M(50) .. ' each · ' .. M(550), b.lines[1].text)
assert(b.lines[2].text == '11 × Mild Spices · ' .. M(10) .. ' each (vendor) · ' .. M(110), b.lines[2].text)
assert(b.total.text == 'Total: ' .. M(660), b.total.text)
assert(b.output.text == 'Makes 1 item per craft · ' .. U.Money(60) .. ' materials per item', b.output.text)
assert(b.math.text == 'Sale: ' .. U.Money(495) .. ' - 5% AH cut: ' .. U.Money(25)
  .. ' - materials: ' .. U.Money(660) .. ' = ' .. U.Money(-190) .. ' profit', b.math.text)
assert(c.rows[2].name.color[2] == U.COLORS.accent[2] and c.rows[1].name.color[2] == U.COLORS.text[2])
-- The count stays between 1 and 999.
for _ = 1, 3 do b.steps[1].scripts.OnClick() end
assert(c.count == 1 and b.title.text == 'What to buy: 1 × Spiced Wolf Meat', b.title.text)
for _ = 1, 120 do b.steps[2].scripts.OnClick() end
assert(c.count == 999, c.count)
for _ = 1, 100 do b.steps[1].scripts.OnClick() end
IsShiftKeyDown = nil
b.steps[2].scripts.OnClick()
assert(c.count == 2, c.count)
-- Partly unpriced totals say what is missing and what the priced reagents cost.
c.rows[4].scripts.OnClick()
assert(b.lines[1].text == '2 × Clam Meat · no price', b.lines[1].text)
assert(b.lines[2].text == '2 × Refreshing Spring Water · ' .. M(25) .. ' each (vendor) · ' .. M(50), b.lines[2].text)
assert(b.total.text == 'Total unknown: 1 reagent unpriced · the priced ones ' .. M(50), b.total.text)
assert(b.math.text == 'Profit unknown: missing material prices.', b.math.text)
c.rows[5].scripts.OnClick()
assert(b.total.text == 'Total unknown: 2 reagents unpriced', b.total.text)
-- Without a recorded output a stored row keeps its material cost but has no sale: one item is never assumed.
local chosen = c.rows[5].name.text
EverlootDB.recipeOutput[11] = nil
U.RefreshCrafting()
local wolf
for i = 1, 6 do if c.rows[i].shown and c.rows[i].name.text == 'Spiced Wolf Meat' then wolf = c.rows[i] end end
assert(wolf and wolf.cost.text == M(60) and wolf.value.text == M(45) and wolf.profit.text == '-', wolf and wolf.profit.text)
wolf.scripts.OnClick()
assert(b.output.text == 'Output unknown · no sale estimate until the profession window shows what it makes', b.output.text)
assert(b.total.text == 'Total: ' .. M(120), b.total.text)
assert(b.math.text == 'Profit unknown: recipe yield unavailable.', b.math.text)
EverlootDB.recipeOutput[11] = { itemId = 2680, minimum = 1, maximum = 1 }
U.RefreshCrafting()
for i = 1, 6 do if c.rows[i].shown and c.rows[i].name.text == chosen then c.rows[i].scripts.OnClick() end end

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
-- On to Ranks and trainers, then back to the blocks.
p.toggle.scripts.OnClick()
assert(not c.page.shown and p.trainers.page.shown and p.toggle.text == 'Crafting costs')
p.nav.scripts.OnClick()
assert(not c.page.shown and p.blocks[1].shown and p.toggle.text == 'Crafting costs')
assert(EverlootWindow.shown and not U.failed)
assert(U.Open('gold'))
EverlootWindow.gold.crafting.scripts.OnClick()
assert(U.view == 'professions' and p.craft.page.shown and not p.blocks[1].shown)
""")

# Without a price file only vendor prices count; an old file says so in the warning red.
lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {CRAFT_RECORDS}, recipeOutput = {{ {CRAFT_OUTPUTS} }} }}", API)
lua.execute("unitEvidence(" + UNITS + ")")
lua.execute("""
local U = Everloot.Window
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
p.toggle.scripts.OnClick()
local c = p.craft
assert(c.age.text == 'No price file: vendor prices only', c.age.text)
assert(c.ageDetail:find('^No price file in the game yet'), c.ageDetail)
local names = {}
for i = 1, 5 do names[c.rows[i].name.text] = c.rows[i] end
assert(names['Spiced Wolf Meat'].cost.text == '1 unpriced')
assert(names['Smelt Copper'].cost.text == U.MoneyShort(30) and names['Smelt Copper'].value.text == 'no price')
assert(not U.failed)
""")
lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {CRAFT_RECORDS}, recipeOutput = {{ {CRAFT_OUTPUTS} }} }}", API + price_file("2026-10-20T06:00:00Z"))
lua.execute("unitEvidence(" + UNITS + ")")
lua.execute("""
local U = Everloot.Window
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
p.toggle.scripts.OnClick()
local c = p.craft
assert(c.age.text == 'Old price file: 2026-10-20 (10 days ago)', c.age.text)
assert(c.ageDetail == 'OLD FILE: market values from 2026-10-20 (10 days ago). The Everloot Desktop App refreshes it, then /reload.', c.ageDetail)
assert(#c.age.text * 6 <= c.age.width)
assert(c.age.color[1] == 1 and c.age.color[2] == 0.4)
assert(not U.failed)
""")
# A reagent name this install saw with two item ids is ambiguous: unpriced, never the last id's price, and the
# client's lookup by name does not settle it. Before, a second Copper Ore id at 50c turned Smelt Copper's 20c into 50c.
AMBIGUOUS_RECORDS = CRAFT_RECORDS.replace("{ itemId = 2770, name = 'Copper Ore' },",
                                          "{ itemId = 2770, name = 'Copper Ore' }, { itemId = 99001, name = 'Copper Ore' },"
                                          " { itemId = 2672, name = 'Wolf Meat' },")
assert AMBIGUOUS_RECORDS != CRAFT_RECORDS
AMBIGUOUS_ROWS = PRICE_ROWS + ";99001,50,45,55,10,2026-10-29,3"
lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {AMBIGUOUS_RECORDS}, recipeOutput = {{ {CRAFT_OUTPUTS} }} }}",
            API + price_file("2026-10-29T06:00:00Z").replace(PRICE_ROWS, AMBIGUOUS_ROWS).replace(
                str(zlib.adler32(PRICE_ROWS.encode())), str(zlib.adler32(AMBIGUOUS_ROWS.encode())))
            + "GetItemInfo = function(name) if name == 'Copper Ore' then return name, '|Hitem:2770::|h[Copper Ore]|h' end end\n")
lua.execute("unitEvidence(" + UNITS + ")")
lua.execute("""
local U = Everloot.Window
local M = U.MoneyShort
assert(Everloot.ItemIdFrom('Copper Ore') == 2770, 'the client would name one id')
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
p.toggle.scripts.OnClick()
local c = p.craft
local smelt
for i = 1, 6 do if c.rows[i].shown and c.rows[i].name.text == 'Smelt Copper' then smelt = c.rows[i] end end
assert(smelt and smelt.cost.text == '1 unpriced' and smelt.value.text == M(150) and smelt.profit.text == '-',
  smelt and smelt.cost.text)
smelt.scripts.OnClick()
assert(c.buy.lines[1].text == '1 × Copper Ore · unpriced (ambiguous name)', c.buy.lines[1].text)
assert(c.buy.total.text == 'Total unknown: 1 reagent unpriced', c.buy.total.text)
-- The same id seen twice is not ambiguous: Wolf Meat stays priced.
c.rows[1].scripts.OnClick()
assert(c.rows[1].name.text == 'Spiced Wolf Meat' and c.rows[1].cost.text == M(60), c.rows[1].name.text)
assert(not U.failed)
""")

# Seven reagents: five lines, then Down for the other two; every reagent and quantity is reachable, the total counts
# them all, and choosing another recipe starts it at its first page.
SEVEN = "{ profession = 'Mining', recipe = 'Seven Ores', recipeId = 30, learned = true, productItemId = 2840, reagents = { " + \
    ", ".join(f"{{ item = 'Ore {i}', count = {i} }}" for i in range(1, 8)) + " } }"
SEVEN_ITEMS = ", ".join(f"{{ itemId = {3000 + i}, name = 'Ore {i}' }}" for i in range(1, 8))
SEVEN_RECORDS = CRAFT_RECORDS.replace("  recipe_observed = {\n", "  recipe_observed = {\n    " + SEVEN + ",\n", 1) \
    .replace("  item_seen = {\n", "  item_seen = {\n    " + SEVEN_ITEMS + ",\n", 1) \
    .replace("{ vendorNpcId = 1, items = { ", "{ vendorNpcId = 1, items = { "
             + ", ".join(f"{{ itemId = {3000 + i}, priceCopper = {i} }}" for i in range(1, 8)) + ", ", 1)
assert SEVEN_RECORDS.count("Ore 7") == 2 and "itemId = 3007, priceCopper = 7" in SEVEN_RECORDS
SEVEN_UNITS = UNITS.replace("{ ", "{ " + ", ".join(f"[{3000 + i}] = {i}" for i in range(1, 8)) + ", ", 1)
lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {SEVEN_RECORDS}, recipeOutput = {{ [30] = {{ itemId = 2840, minimum = 1, maximum = 1 }}, {CRAFT_OUTPUTS} }} }}", API + price_file("2026-10-29T06:00:00Z"))
lua.execute("unitEvidence(" + SEVEN_UNITS + ")")
lua.execute("""
local U = Everloot.Window
local M = U.MoneyShort
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
p.toggle.scripts.OnClick()
local c = p.craft
c.sortButton.scripts.OnClick()
local seven
for i = 1, 8 do if c.rows[i].shown and c.rows[i].name.text == 'Seven Ores' then seven = c.rows[i] end end
assert(seven, 'the seven-reagent recipe is listed')
seven.scripts.OnClick()
c.buy.steps[2].scripts.OnClick()
local b = c.buy
assert(b.title.text == 'What to buy: 2 × Seven Ores', b.title.text)
for i = 1, 5 do
  assert(b.lines[i].shown and b.lines[i].text == (2 * i) .. ' × Ore ' .. i .. ' · ' .. M(i) .. ' each (vendor) · ' .. M(2 * i * i),
    b.lines[i].text)
end
assert(not b.up.shown and b.down.shown, 'Down for the rest')
-- 2 × (1 + 4 + 9 + 16 + 25 + 36 + 49)
assert(b.total.text == 'Total: ' .. M(280), b.total.text)
b.down.scripts.OnClick()
assert(b.lines[1].text == '12 × Ore 6 · ' .. M(6) .. ' each (vendor) · ' .. M(72), b.lines[1].text)
assert(b.lines[2].text == '14 × Ore 7 · ' .. M(7) .. ' each (vendor) · ' .. M(98), b.lines[2].text)
assert(not b.lines[3].shown and b.up.shown and not b.down.shown)
assert(b.total.text == 'Total: ' .. M(280), b.total.text)
-- The page holds while the count changes, and Up goes back.
b.steps[2].scripts.OnClick()
assert(b.lines[2].text == '21 × Ore 7 · ' .. M(7) .. ' each (vendor) · ' .. M(147), b.lines[2].text)
b.up.scripts.OnClick()
assert(b.lines[1].text == '3 × Ore 1 · ' .. M(1) .. ' each (vendor) · ' .. M(3) and b.down.shown, b.lines[1].text)
-- Another recipe starts at its first page.
b.down.scripts.OnClick()
c.rows[1].scripts.OnClick()
assert(b.lines[1].shown and b.lines[1].text:find(' × ') and not b.up.shown and not b.down.shown, b.lines[1].text)
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
      "crafting costs with vendor-cheaper reagents, unpriced reagents and products, ambiguous reagent names, estimated "
      "profit and name sort, the profitable filter, what-to-buy totals with reagent paging and the price file's age")

# Listing changes are not sales. Synthetic products and scans exercise the row and its hover.
CHANGE_RECORDS = """{
 recipe_observed = { { profession = 'Mining', recipe = 'Shape Glimmerdust', recipeId = 990101,
   productItemId = 990102, reagents = { { item = 'Glimmerdust', count = 2 } } } },
 item_seen = { { itemId = 990103, name = 'Glimmerdust' } },
 vendor = { { vendorNpcId = 990104, items = { { itemId = 990103, priceCopper = 10 } } } },
 auction_snapshot = {
   { realm = 'Forever', house = 'Alliance', scanId = 'older', capturedAt = '2026-10-30T06:00:00Z',
     part = 1, parts = 1, items = { { 990102, 4, 20, 100, 110 } } },
   { realm = 'Forever', house = 'Alliance', scanId = 'latest', capturedAt = '2026-10-30T09:00:00Z',
     part = 1, parts = 1, items = { { 990102, 3, 12, 120, 130 } } },
   { realm = 'Forever', house = 'Horde', scanId = 'other-house', capturedAt = '2026-10-30T08:00:00Z',
     part = 1, parts = 1, items = { { 990102, 1, 999, 999, 999 } } },
 } }"""
CHANGE_API = API + """
now = 1793354400 -- 2026-10-30 10:00 UTC
GameTooltip = { lines = {}, SetOwner = function(self) self.lines = {} end,
 AddLine = function(self, s) self.lines[#self.lines + 1] = s end,
 Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end }
"""
CHANGE_ROWS = '990102,150,140,100,40,2026-10-30,3'
CHANGE_FILE = ("EverlootPricesDB = { realms = { ['forever|alliance'] = { data = '" + CHANGE_ROWS
               + "', sum = " + str(zlib.adler32(CHANGE_ROWS.encode())) + ", dataAsOf = '2026-10-30T09:00:00Z' } } }")


def change_world(records=CHANGE_RECORDS, prices=CHANGE_FILE):
    # Glimmerdust's 10c vendor offer was one item for money alone: this install keeps it as a unit price. The profession
    # window recorded that one craft makes one Glimmerdust shape.
    world = fresh("{ installId = 'abcd-1234', toggles = {}, records = " + records
                  + ", recipeOutput = { [990101] = { itemId = 990102, minimum = 1, maximum = 1 } }"
                  + ", houseScans = { Forever = { Alliance = { scanId = 'latest', at = 1793350800 } } } }",
                  CHANGE_API + prices)
    world.execute("unitEvidence({ [990103] = 10 })")
    world.execute("assert(Everloot.Window.Open('professions')); EverlootWindow.professions.toggle.scripts.OnClick(); "
                  "r = EverlootWindow.professions.craft.rows[1]; assert(not Everloot.Window.failed)")
    return world


lua = change_world()
lua.execute(r"""
assert(r.cost.text == Everloot.Window.MoneyShort(20))
-- One quote policy with the native window: this house's scan from today (130c, after the community day) beats the
-- price file's 150c: 130c less the 5% cut is 123c, less 20c of materials.
assert(r.value.text == Everloot.Window.MoneyShort(130) and r.profit.text == '+' .. Everloot.Window.MoneyShort(103),
  r.value.text .. ' / ' .. r.profit.text)
assert(EverlootWindow.professions.craft.age.text:find('^Your Alliance scan: 1 h ago', 1), EverlootWindow.professions.craft.age.text)
r.scripts.OnEnter(r)
local said = table.concat(GameTooltip.lines, '|')
assert(said:find('Item value: ' .. Everloot.Window.Money(130) .. ' each (your Alliance scan)', 1, true), said)
assert(said:find('Min buyout: +20.0%', 1, true), said)
assert(said:find('Units listed: -8', 1, true), said)
assert(said:find('over the last 3 h', 1, true) and said:find('4 h ago', 1, true), said)
assert(said:find('+50.0% vs 60-day median', 1, true), said)
-- 100,110,120,130 from scans, 150,100 from file: spread / mean = 42.3%.
assert(said:find('42.3% swing', 1, true), said)
assert(said:find('not sales', 1, true), said)
-- The product's lowest buyout rose 20% since the previous scan: said in figures the font draws, green.
assert(r.change.text == '+20%' and r.change.color[2] == Everloot.Window.COLORS.accent[2], r.change.text)
assert(r.bars[1].shown and r.bars[2].shown and not r.bars[3].shown)
assert(r.bars[1].path == 'Interface\\Buttons\\WHITE8X8')
assert(math.abs(r.bars[1].height - 10) < 0.01 and r.bars[2].height == 12)
assert(r.bars[2].point[2] + r.bars[2].width <= r.width and r.bars[2].height <= r.height)
r.scripts.OnLeave(); assert(not GameTooltip.shown)
-- A downward move changes both sign and palette; redraw also clears old bars.
EverlootDB.records.auction_snapshot[2].items[1][4] = 80
Everloot.ownScanCache = nil
Everloot.Window.Views.professions.refresh(EverlootWindow)
r.scripts.OnEnter(r)
assert(table.concat(GameTooltip.lines, '|'):find('Min buyout: -20.0%', 1, true))
assert(r.change.text == '-20%' and r.change.color[1] == Everloot.Window.COLORS.gold[1], r.change.text)
-- A change that rounds to nothing (+0.4%, then -0.4%) is "0%" in the muted colour, never a green "+0%".
local items = EverlootDB.records.auction_snapshot
items[1].items[1][4], items[2].items[1][4] = 1000, 1004
Everloot.ownScanCache = nil
Everloot.Window.Views.professions.refresh(EverlootWindow)
assert(r.change.text == '0%' and r.change.color[1] == Everloot.Window.COLORS.muted[1], r.change.text)
items[2].items[1][4] = 996
Everloot.ownScanCache = nil
Everloot.Window.Views.professions.refresh(EverlootWindow)
assert(r.change.text == '0%' and r.change.color[1] == Everloot.Window.COLORS.muted[1], r.change.text)
""")
lua = change_world(prices='')
lua.execute("""
r.scripts.OnEnter(r)
local said = table.concat(GameTooltip.lines, '|')
assert(said:find('— vs 60-day median', 1, true), said)
assert(said:find('26.1% swing', 1, true), said)
-- Without a price file, the fresh scan of this house still prices the item, and says it is the scan.
assert(r.value.text == Everloot.Window.MoneyShort(130) and said:find('(your Alliance scan)', 1, true),
  'the page uses the same fresh same-house scan as the native window')
""")
# A fresh scan while the price file is still being checked: the page keeps asking, then shows the file's day.
lua = change_world()
lua.execute(r"""
local c = EverlootWindow.professions.craft
local file = Everloot.PriceFile
Everloot.PriceFile = function(self, realm) return { status = 'verifying' } end
timers = {}
Everloot.Window.Open('professions')
assert(c.age.text:find('^Your Alliance scan: 1 h ago', 1) and c.age.text:find('Checking the price file...', 1, true), c.age.text)
assert(#timers > 0, 'a scan line does not stop the page from asking again while the file is checked')
Everloot.PriceFile = file
drain()
assert(not c.age.text:find('Checking', 1, true) and c.age.text:find('Alliance AH prices', 1, true), c.age.text)
""")
lua = change_world(CHANGE_RECORDS.replace("house = 'Alliance', scanId = 'older'", "house = 'Neutral', scanId = 'older'"), '')
lua.execute("""
r.scripts.OnEnter(r)
local said = table.concat(GameTooltip.lines, '|')
assert(said:find('one scan so far: scan again later to see change', 1, true), said)
assert(r.change.text == '' and r.bars[1].shown and not r.bars[2].shown, r.change.text)
""")
lua = change_world(CHANGE_RECORDS.replace('990102, 4, 20, 100, 110', '990105, 4, 20, 100, 110')
                   .replace('990102, 3, 12, 120, 130', '990105, 3, 12, 120, 130'), '')
lua.execute("""
r.scripts.OnEnter(r)
local said = table.concat(GameTooltip.lines, '|')
assert(said:find('Min buyout: —', 1, true) and said:find('Units listed: —', 1, true), said)
assert(said:find('— swing', 1, true) and not r.bars[1].shown, said)
""")
print('Professions market changes: signed price and listing changes, age, history, swing, missing data, glyph and bars PASS')

# All three scans draw oldest first, regardless of record order; multipart scans count once.
third = """{ realm = 'Forever', house = 'Alliance', scanId = 'third', capturedAt = '2026-10-29T06:00:00Z',
 part = 1, parts = 2, items = { { 990102, 5, 30, 60, 70 } } },
 { realm = 'Forever', house = 'Alliance', scanId = 'third', capturedAt = '2026-10-29T06:00:00Z',
 part = 2, parts = 2, items = { { 990106, 1, 1, 900, 900 } } },"""
three = CHANGE_RECORDS.replace(' auction_snapshot = {', ' auction_snapshot = { ' + third)
lua = change_world(three, '')
lua.execute("""
assert(r.bars[1].height == 6 and r.bars[2].height == 10 and r.bars[3].height == 12)
r.scripts.OnEnter(r)
local said = table.concat(GameTooltip.lines, '|')
assert(said:find('Min buyout: +20.0%', 1, true), 'compare the previous scan, not the oldest')
-- An incomplete older scan must not affect swing or the bars.
table.remove(EverlootDB.records.auction_snapshot, 2)
Everloot.Window.Views.professions.refresh(EverlootWindow)
assert(r.bars[1].height == 10 and r.bars[2].height == 12 and not r.bars[3].shown)
""")
lua = change_world(CHANGE_RECORDS.replace('2026-10-30T06:00:00Z', '2026-10-29T06:00:00Z'))
lua.execute("""
r.scripts.OnEnter(r)
local said = table.concat(GameTooltip.lines, '|')
assert(said:find('over the last 27 h', 1, true) and said:find('28 h ago', 1, true), said)
""")
# A single usable price point cannot describe a spread, and missing history cannot be a percentage.
lua = change_world(CHANGE_RECORDS.replace("house = 'Alliance', scanId = 'older'", "house = 'Neutral', scanId = 'older'")
                  .replace('990102, 3, 12, 120, 130', '990102, 3, 12, 120'), '')
lua.execute("""
r.scripts.OnEnter(r)
assert(table.concat(GameTooltip.lines, '|'):find('— swing', 1, true))
""")
lua = change_world(CHANGE_RECORDS.replace("house = 'Alliance'", "house = 'Neutral'"), '')
lua.execute("""
r.scripts.OnEnter(r)
assert(table.concat(GameTooltip.lines, '|'):find('No own scan of this house yet.', 1, true))
assert(r.change.text == '' and not r.bars[1].shown and not Everloot.Window.failed)
""")
print('Professions market changes: three scans, multipart completeness, long intervals and sparse prices PASS')

# A destination changed outside this view redraws it, and delayed sell prices fill in without another click.
lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {CRAFT_RECORDS}, "
            "recipeOutput = { [10] = { itemId = 2840, minimum = 2, maximum = 2 }, " + CRAFT_OUTPUTS + " } }",
            API + price_file("2026-10-29T06:00:00Z"), extra=("modules/sellcheck.lua",))
lua.execute("unitEvidence(" + UNITS + ")")
lua.execute("""
local E, U = Everloot, Everloot.Window
U.OpenCrafting()
local c = EverlootWindow.professions.craft
local sells = {}
C_Item = C_Item or {}
C_Item.GetItemInfo = function(id)
  if id == 2840 and not sells[id] then return end
  return 'Item '..id, 'link', 1, 10, 1, 'Trade Goods', 'Metal', 20, '', 1, sells[id] or 0
end
E.Options.SetCraftDestination('vendor')
assert(c.destButton.text == 'Sell: vendor' and c.head.value.text == 'Vendor price',
  'external destination changes refresh the visible professions page')
local function copper()
  for _, line in ipairs(c.rows) do if line.row and line.row.id == 10 then return line end end
end
assert(copper() and copper().value.text == 'checking' and #timers > 0, 'pending vendor value schedules a redraw')
sells[2840] = 60
drain()
assert(copper().value.text == U.MoneyShort(60), 'loaded vendor price appears without a user click')
assert(U.CraftComparison(copper().row, 'vendor', 3):find('3 crafts', 1, true), 'comparison states its craft count')
E.Options.SetCraftDestination('ah')
assert(c.destButton.text == 'Sell: AH' and c.head.value.text == 'Item value', 'AH switch also redraws externally')
sells[2840] = nil
U.RefreshCrafting()
assert(#timers > 0, 'the secondary vendor comparison also refreshes while AH is selected')
sells[2840] = 60
drain()
assert(not U.failed)
""")
print('Professions destinations: cross-surface refresh and delayed vendor prices PASS')

# Route choice on the Crafting costs page: buy every reagent, or the cheapest route with this character's own recipes,
# for the selected count. The real default: the generated client cooldown data at a matching build, no injected
# evidence. Recipe 2963 (covered, no cooldown recorded) makes two Wolf Meat from one Small Egg (30c) here.
lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {CRAFT_RECORDS}, "
            "recipeOutput = { [10] = { itemId = 2840, minimum = 2, maximum = 2 }, " + CRAFT_OUTPUTS + " } }",
            API + price_file("2026-10-29T06:00:00Z") + "GetBuildInfo = function() return '1.60.1', '71139' end\n",
            extra=("modules/sellcheck.lua", "modules/shopping.lua", "modules/recipe_cooldown_data.lua",
                   "modules/crafting_plan.lua"))
lua.execute("unitEvidence(" + UNITS + ")")
lua.execute(f"ME = '{ME}'")
lua.execute("""
local U, E = Everloot.Window, Everloot
local M, Money = U.MoneyShort, U.Money
local function proven(recipeId)
  EverlootDB.craftingKnown = { [ME] = { [185] = { complete = false, recipes = { [recipeId] = { recipeId = recipeId,
    learned = true, itemId = 2672, minimum = 2, maximum = 2, reagents = { { itemId = 6889, count = 1 } },
    cooldownReturned = false, cooldownCheckedAt = time() - 60 } } } } }
end
proven(2963)
assert(E.CharacterKey() == ME)
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
p.toggle.scripts.OnClick()
local c, b = p.craft, p.craft.buy
c.rows[2].scripts.OnClick()
assert(b.title.text == 'What to buy: 1 × Spiced Wolf Meat', b.title.text)
assert(b.route.shown and b.route.text == 'Route: buy all', 'the route choice shows with the planner loaded')
assert(b.route.point[2] + b.route.width <= b.receipt.point[2] and b.details.point[2] + b.details.width <= b.route.point[2],
  'the route button sits between Cost details and the receipt')
assert(b.lines[1].text == '1 × Wolf Meat · ' .. M(50) .. ' each · ' .. M(50), 'buy all is unchanged: ' .. b.lines[1].text)
b.route.scripts.OnClick()
assert(b.route.text == 'Route: cheapest', b.route.text)
assert(b.lines[1].text == 'Make 1 × Wolf Meat: 1 craft', b.lines[1].text)
assert(b.lines[2].text == '1 × Mild Spices · ' .. M(10) .. ' each (vendor) · ' .. M(10), b.lines[2].text)
assert(b.lines[3].text == '1 × Small Egg · ' .. M(30) .. ' each · ' .. M(30), b.lines[3].text)
assert(b.total.text == 'Total: ' .. M(40) .. ' · buying all: ' .. M(60), b.total.text)
b.details.scripts.OnClick()
assert(b.math.text == 'Sale: ' .. Money(45) .. ' - 5% AH cut: ' .. Money(3) .. ' - materials: ' .. Money(40) .. ' = '
  .. Money(2) .. ' profit for 1 craft', b.math.text)
assert(b.alt.text == 'Left over: 1 × Wolf Meat · Assumes: no cooldown recorded in client data, build 1.60.1.71139', b.alt.text)
b.details.scripts.OnClick()
-- The route's hover says what the client data can and cannot show; it never says unlimited.
GameTooltip = { lines = {}, SetOwner = function(self) self.lines = {} end,
  AddLine = function(self, s) self.lines[#self.lines + 1] = s end,
  Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end }
b.route.scripts.OnEnter(b.route)
local said = table.concat(GameTooltip.lines, '|')
assert(said:find('No cooldown recorded in client data, build 1.60.1.71139', 1, true)
  and said:find('could not be read', 1, true) and said:find('server changes', 1, true) and not said:lower():find('unlimited'), said)
b.route.scripts.OnLeave()
-- Three crafts: two crafts make four Wolf Meat for three. 135c sale, 7c cut, 90c materials.
b.steps[2].scripts.OnClick(); b.steps[2].scripts.OnClick()
assert(c.count == 3 and b.lines[1].text == 'Make 3 × Wolf Meat: 2 crafts', b.lines[1].text)
assert(b.total.text == 'Total: ' .. M(90) .. ' · buying all: ' .. M(180), b.total.text)
assert(b.plan.cost == 90 and b.plan.steps[1].recipeId == 2963 and b.plan.steps[1].crafts == 2)
b.details.scripts.OnClick()
assert(b.math.text == 'Sale: ' .. Money(135) .. ' - 5% AH cut: ' .. Money(7) .. ' - materials: ' .. Money(90) .. ' = '
  .. Money(38) .. ' profit for 3 crafts', b.math.text)
b.details.scripts.OnClick()
-- The list's per-craft row is untouched by the selected count's route.
assert(c.rows[2].cost.text == M(60) and c.rows[2].profit.text == M(-18), c.rows[2].profit.text)
-- A complete route goes to the shopping list as bought, for every craft.
b.add.scripts.OnClick()
assert(b.receipt.text:find('^Added 2 reagents'), b.receipt.text)
-- Another build: the data does not count, the route buys everything and says why.
GetBuildInfo = function() return '1.60.2', '72000' end
U.Views.professions.refresh(EverlootWindow)
assert(b.total.text == 'Total: ' .. M(180), b.total.text)
assert(b.alt.text == 'Recipes not used: no cooldown evidence (data for another build)', b.alt.text)
GetBuildInfo = function() return '1.60.1', '71139' end
-- A recorded cooldown (Mooncloth's recipe ID) needs a current read in its own open window: none on this page.
proven(18560)
U.Views.professions.refresh(EverlootWindow)
assert(b.total.text == 'Total: ' .. M(180), b.total.text)
assert(b.alt.text == 'Recipes not used: cooldown not ready now (no current read)', b.alt.text)
-- An incomplete route is not added; the receipt says why (Clam Meat has no known item ID).
proven(2963)
c.rows[4].scripts.OnClick()
assert(b.title.text:find('Boiled Clams', 1, true) and b.plan and not b.plan.complete, b.title.text)
b.add.scripts.OnClick()
assert(b.receipt.text == "Not added: this route is incomplete (the recipe's reagents are not all known).", b.receipt.text)
-- A route over the 50-item limit is not added either: item 51 is never dropped silently.
c.rows[2].scripts.OnClick()
b.plan = { complete = false, unpriced = {}, limits = {}, cost = 51, purchases = {}, omitted = { { id = 1050, item = 'Item 1050', count = 1 } } }
b.add.scripts.OnClick()
assert(b.receipt.text == 'Not added: this route is incomplete (1 item over the 50-item limit).', b.receipt.text)
-- Back to buying all.
c.rows[2].scripts.OnClick()
b.route.scripts.OnClick()
assert(b.route.text == 'Route: buy all' and b.plan == nil and b.lines[1].text == '3 × Wolf Meat · ' .. M(50) .. ' each · '
  .. M(150), b.lines[1].text)
assert(not U.failed)
""")
# Plan notes explain every exclusion, cycles included.
lua.execute("""
local note = Everloot.Window.PlanNote({ decisions = {}, leftovers = {}, limits = {},
  exclusions = { { recipeId = 211, itemId = 115, reason = 'cycle' } } })
assert(note == 'Recipes not used: recipe loops back to its own product', note)
-- A cooldown root that cannot be read says why, not only the zero (the Crafting costs page has no open window).
note = Everloot.Window.PlanNote({ decisions = {}, leftovers = {}, exclusions = {},
  limits = { { kind = 'cooldown', recipeId = 18560, crafts = 1, capacity = 0, reason = 'cooldown', detail = 'profession window closed' } } })
assert(note == 'Cooldown allows 0 now (profession window closed)', note)
local U = Everloot.Window
local b = EverlootWindow.professions.craft.buy
b.plan = { complete = false, unpriced = {}, omitted = {}, cost = 40,
  limits = { { kind = 'cooldown', recipeId = 18560, crafts = 1, capacity = 0, reason = 'cooldown', detail = 'profession window closed' } } }
b.add.scripts.OnClick()
assert(b.receipt.text == "Not added: this route is incomplete (the recipe's cooldown allows 0 now: profession window closed).",
  b.receipt.text)
""")
print('Professions route choice: buy all or the cheapest route for the selected count PASS')
