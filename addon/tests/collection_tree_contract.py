"""Run with: uv run --with lupa python addon/tests/collection_tree_contract.py

Collection drawn as completionist addons draw it (modules/view_collection.lua): headings that open and close with a
count of the marks under them, an icon and the item's quality colour on each row, the game's ready-check marks, and
the game's tooltip on hover. Under each boss, the drops the Desktop App's price file holds for it (drops.lua, three
installs), from the creatures this install saw in that fight or else from the NPCs the file names as the boss is
named; whether a drop's mount or appearance is collected is read from the game, and a drop that is neither has no
mark. Mounts, battle pets and toys are read from the game's own journals, the pets and toys under their filters.
"""
import zlib
from window_world import fresh

DROPS = "2001,n,500,10,100,4;2002,n,500,50,100,3;2003,n,500,10,100,5;2003,n,501,5,50,5;2004,n,500,90,100,2"
NAMES = "n500=Ghamoo-ra\\nn501=Aku'mai Snapjaw"
SUM = zlib.adler32(DROPS.encode())

API = f"""
date = os.date
UnitGUID = function() return 'Player-1-0001' end
EverlootPricesDB = {{ drops = {{ data = '{DROPS}', sum = {SUM}, dataAsOf = '2026-11-16T06:00:00.000Z', names = "{NAMES}" }} }}
ITEM_QUALITY_COLORS = {{ [2] = {{ r = 0.12, g = 1, b = 0 }}, [4] = {{ r = 0.64, g = 0.21, b = 0.93 }} }}
local items = {{ [2001] = {{ 'Reins of the Deep Horse', 4, 'iconHorse' }}, [2002] = {{ 'Shiny Robe', 2, 'iconRobe' }},
  [2003] = {{ 'Murky Scale', 1, 'iconScale' }}, [3001] = {{ 'Toy 01', 3, 'iconToy' }} }}
GetItemInfo = function(id)
  local i = items[id]
  if i then return i[1], 'link', i[2], 1, 1, 'Type', 'Sub', 1, '', i[3] end
end
GetItemInfoInstant = function(id) return id, 'Type', 'Sub', '', 'instant' .. id end
-- Item 2001 teaches mount 77, not collected; item 2002 is an appearance this character has.
mountsCollected = {{ [78] = true }}
C_MountJournal = {{
  GetMountFromItem = function(id) if id == 2001 then return 77 end end,
  GetMountIDs = function() return {{ 77, 78, 79 }} end,
  GetMountInfoByID = function(id)
    local names = {{ [77] = 'Deep Horse', [78] = 'Red Wolf', [79] = 'Other Faction Ram' }}
    return names[id], 1000 + id, 'mount' .. id, false, true, 1, false, id == 79, 0, id == 79, mountsCollected[id] == true
  end,
  GetMountInfoExtraByID = function(id) return 1, 'desc', '|cFFFFD200Drop:|r Ghamoo-ra|nBlackfathom Deeps' end,
}}
C_TransmogCollection = {{
  GetItemInfo = function(id) if id == 2002 then return 10, 20 end end,
  PlayerHasTransmogItemModifiedAppearance = function(source) return source == 20 end,
}}
pets = {{ {{ 'BattlePet-1', 1, true, nil, 1, false, false, 'Cat', 'petCat', 1, 1, 'Vendor' }},
  {{ nil, 1, false, nil, 1, false, false, 'Cat', 'petCat', 1, 1, 'Vendor' }},
  {{ nil, 2, false, nil, 1, false, false, 'Frog', 'petFrog', 1, 1, '|cFFFFD200Zone:|r Swamp' }} }}
C_PetJournal = {{ GetNumPets = function() return #pets, 1 end, GetPetInfoByIndex = function(i) return unpack(pets[i]) end }}
toys = {{}}
for i = 1, 20 do toys[i] = 3000 + i end
C_ToyBox = {{
  GetNumFilteredToys = function() return #toys end,
  GetToyFromIndex = function(i) return toys[i] end,
  GetToyInfo = function(id) if id > 3000 and id <= 3020 then return id, string.format('Toy %02d', id - 3000), 'toy' .. id end end,
}}
PlayerHasToy = function(id) return id == 3001 end
UnitFactionGroup = function() return 'Horde', 'Horde' end
Enum.UIMapType = {{ Cosmic = 0, World = 1, Continent = 2, Zone = 3 }}
Enum.FlightPathFaction = {{ Neutral = 0, Horde = 1, Alliance = 2 }}
local maps = {{ [1411] = {{ mapID = 1411, name = 'Durotar', mapType = 3, parentMapID = 1414 }},
  [1414] = {{ mapID = 1414, name = 'Kalimdor', mapType = 2, parentMapID = 947 }},
  [947] = {{ mapID = 947, name = 'Azeroth', mapType = 1, parentMapID = 946 }} }}
C_Map = {{
  GetBestMapForUnit = function(unit) if unit == 'player' then return 1411 end end,
  GetMapInfo = function(id) return maps[id] end,
  GetMapChildrenInfo = function(id, kind)
    if id == 947 and kind == 2 then
      return {{ {{ mapID = 1414, name = 'Kalimdor', mapType = 2 }}, {{ mapID = 1415, name = 'Eastern Kingdoms', mapType = 2 }} }}
    end
  end,
}}
taxiNodes = {{
  [1414] = {{ {{ nodeID = 23, name = 'Orgrimmar, Durotar', faction = 1, isUndiscovered = false }},
    {{ nodeID = 25, name = 'Crossroads, The Barrens', faction = 0, isUndiscovered = true }},
    {{ nodeID = 26, name = 'Auberdine, Darkshore', faction = 2, isUndiscovered = true }} }},
  [1415] = {{ {{ nodeID = 11, name = 'Undercity, Tirisfal', faction = 1, isUndiscovered = true }} }},
}}
C_TaxiMap = {{ GetTaxiNodesForMap = function(id) return taxiNodes[id] or {{}} end }}
GameTooltip = {{ lines = {{}} }}
function GameTooltip:SetOwner(owner) self.owner, self.item, self.spell, self.lines = owner, nil, nil, {{}} end
function GameTooltip:SetItemByID(id) self.item = id end
function GameTooltip:SetSpellByID(id) self.spell = id end
function GameTooltip:AddLine(t) table.insert(self.lines, t) end
function GameTooltip:Show() self.shown = true end
function GameTooltip:Hide() self.shown = false end
"""

HELPERS = r"""
local U = Everloot.Window
local function shown(rows) local n = 0; for _, r in ipairs(rows) do if r.shown then n = n + 1 end end; return n end
local function click(b) b.scripts.OnClick(b) end
local function mark(row) if not row.done.shown then return '' end; return row.done.path end
local READY, NOT_READY = 'Interface\\RaidFrame\\ReadyCheck-Ready', 'Interface\\RaidFrame\\ReadyCheck-NotReady'
local TAIL = ' | Raids | No agreed instances yet | World bosses | No agreed instances yet'
local function names(rows) local t = {}; for _, r in ipairs(rows) do if r.shown then t[#t + 1] = r.name.text end end; return table.concat(t, ' | ') end
EverlootDB.toggles.completion = true
Everloot.InstanceData = { asOf = '2026-11-17', instances = {
  { id = 48, name = 'Blackfathom Deeps', group = 'Dungeons', bosses = { { id = 2916, name = 'Ghamoo-ra' } } } } }
"""

lua = fresh("{ installId = 'abcd-1234', toggles = { completion = true }, records = {} }", API,
            extra=("modules/completion.lua", "modules/owned.lua"))
lua.execute(HELPERS + r"""
assert(U.Open('collection') == true)
local c = EverlootWindow.collection
local rows = c.rows
-- Two rows of sections: the overview and the words, then the lists the game keeps.
assert(c.sections.overview.point[2] == 0 and c.sections.overview.point[3] == -8, 'Overview first')
assert(c.sections.achievements.point[3] == -8 and c.sections.raids.point[3] == -32 and c.sections.raids.point[2] == 0, 'two rows')
for _, key in ipairs({ 'mounts', 'pets', 'toys', 'flights' }) do assert(c.sections[key].point[3] == -32, key) end
assert(c.sections.flights.point[2] + c.sections.flights.width <= 604, 'the second row fits the view')
assert(c.sections.quests.point[2] + c.sections.quests.width <= 604 - 100 - 4, 'the first row clears Missing only')

-- The overview counts the journals and the flight map: mounts 1 of 2, pets 1 of 2, toys 1 of 20, flight paths 1 of 3.
assert(c.section == 'overview', c.section)
local area = {}
for _, r in ipairs(rows) do if r.shown then area[r.name.text] = r end end
assert(area['Mounts'].detail.text == '1 / 2 (50%)' and area['Pets'].detail.text == '1 / 2 (50%)', area['Mounts'].detail.text)
assert(area['Toys'].detail.text == '1 / 20 (5%)' and area['Flight paths'].detail.text == '1 / 3 (33%)', area['Flight paths'].detail.text)
assert(area['Dungeons & raids'].detail.text == '1 / 3 (33%)', 'a boss and its collectible drops: ' .. area['Dungeons & raids'].detail.text)

-- The price file's checksum holds (a block this small is checked within the call), so the drops are read.
click(c.sections.raids)
assert(not c.summary.text:find('drops:', 1, true), c.summary.text)

-- The boss opens on its drops; until then it shows how many of its collectible drops this character has.
assert(names(rows) == 'Dungeons | Blackfathom Deeps | Ghamoo-ra' .. TAIL, names(rows))
local boss = rows[3]
assert(boss.toggle.shown and boss.toggle.path == 'Interface\\Buttons\\UI-PlusButton-Up', 'a closed heading')
assert(boss.detail.text == 'No kill recorded · 1 / 2 (50%)', boss.detail.text)
assert(mark(boss) == NOT_READY, 'no kill yet')
assert(rows[2].detail.text == '1 / 3 (33%)' and rows[1].detail.text == 'Agreed by players · 1 / 3 (33%)', rows[2].detail.text)
assert(rows[1].toggle.path == 'Interface\\Buttons\\UI-MinusButton-Up' and rows[1].name.color[2] == 0.82, 'an open gold heading')
click(boss)
assert(names(rows) == 'Dungeons | Blackfathom Deeps | Ghamoo-ra | Shiny Robe | Reins of the Deep Horse | Murky Scale' .. TAIL, names(rows))
-- Best rate first; an item two installs looted (2004) is not public and is left out.
local robe, horse, scale = rows[4], rows[5], rows[6]
assert(robe.detail.text == '50.0% · 50 of 100 loot windows' and mark(robe) == READY, 'the appearance is collected')
assert(robe.icon.shown and robe.icon.path == 'iconRobe' and robe.name.color[1] == 0.12, 'icon and quality colour')
assert(mark(horse) == NOT_READY and horse.name.color[3] == 0.93, 'the mount is not')
assert(mark(scale) == '' and scale.detail.text == '10.0% · 10 of 100 loot windows', 'neither: no mark')
assert(robe.name.point[2] > rows[3].name.point[2] and rows[3].name.point[2] > rows[2].name.point[2], 'each level is indented')
assert(boss.toggle.path == 'Interface\\Buttons\\UI-MinusButton-Up', 'now open')

-- Hover: the game's item tooltip, with Everloot's own lines; a heading says where its drops come from.
robe.scripts.OnEnter(robe)
assert(GameTooltip.owner == robe and GameTooltip.item == 2002 and GameTooltip.shown, 'the item tooltip')
boss.scripts.OnEnter(boss)
assert(table.concat(GameTooltip.lines, ' | '):find('an NPC named Ghamoo-ra', 1, true), table.concat(GameTooltip.lines, ' | '))
boss.scripts.OnLeave(boss)
assert(not GameTooltip.shown)

-- Missing only hides what is done, and a heading whose marks are all done.
click(c.missingOnly)
assert(names(rows) == 'Dungeons | Blackfathom Deeps | Ghamoo-ra | Reins of the Deep Horse | Murky Scale' .. TAIL, names(rows))
click(c.missingOnly)
click(rows[3])
assert(names(rows) == 'Dungeons | Blackfathom Deeps | Ghamoo-ra' .. TAIL, 'closed again: ' .. names(rows))
click(rows[2])
assert(names(rows) == 'Dungeons | Blackfathom Deeps' .. TAIL, 'the instance closes too')
click(rows[2])

-- A boss not yet killed stays in Missing only when every drop under it is collected: its own cross is missing.
mountsCollected[77] = true
click(c.sections.raids)
click(rows[3])
click(c.missingOnly)
assert(names(rows) == 'Dungeons | Blackfathom Deeps | Ghamoo-ra | Murky Scale' .. TAIL, names(rows))
assert(rows[3].detail.text == 'No kill recorded · 2 / 2 (100%)' and mark(rows[3]) == NOT_READY, rows[3].detail.text)
click(c.missingOnly)
click(rows[3])
mountsCollected[77] = nil

-- The creatures this install saw in the fight come first: then only their drops are listed.
EverlootDB.records.encounter = { { encounterId = 2916, instanceMapId = 48, npcIds = { 501 }, success = true } }
click(c.sections.raids)
click(rows[3])
assert(names(rows) == 'Dungeons | Blackfathom Deeps | Ghamoo-ra | Murky Scale' .. TAIL, names(rows))
assert(rows[4].detail.text == '10.0% · 5 of 50 loot windows', rows[4].detail.text)
assert(rows[3].detail.text == 'No kill recorded', 'nothing collectible under it: ' .. rows[3].detail.text)
rows[3].scripts.OnEnter(rows[3])
assert(table.concat(GameTooltip.lines, ' | '):find('creatures you saw in this fight', 1, true))

-- Mounts: every mount the game lists, the other faction's left out unless collected, with its source on one line.
click(c.sections.mounts)
assert(c.summary.text == 'Mounts: 1 of 2 (50%)', c.summary.text)
assert(names(rows) == 'Drop' and rows[1].detail.text == '1 / 2 (50%)' and rows[1].toggle.shown, names(rows))
click(rows[1])
assert(names(rows) == 'Drop | Deep Horse | Red Wolf', names(rows))
assert(rows[2].detail.text == 'Ghamoo-ra Blackfathom Deeps' and mark(rows[2]) == NOT_READY and mark(rows[3]) == READY, rows[2].detail.text)
assert(rows[2].icon.path == 'mount77', 'the mount icon')
rows[3].scripts.OnEnter(rows[3])
assert(GameTooltip.spell == 1078, 'the mount spell tooltip')
click(c.missingOnly)
assert(names(rows) == 'Drop | Deep Horse', 'missing only: ' .. names(rows))
click(c.missingOnly)

-- Pets: one row per species, owned when any pet of it is.
click(c.sections.pets)
assert(c.summary.text == "Pets: 1 of 2 species (50%) · as the Pet Journal's filters list them", c.summary.text)
assert(names(rows) == 'Vendor | Zone', names(rows))
click(rows[1]); click(rows[3])
assert(names(rows) == 'Vendor | Cat | Zone | Frog' and mark(rows[2]) == READY and mark(rows[4]) == NOT_READY and rows[4].detail.text == 'Swamp', names(rows))
click(c.missingOnly)
assert(names(rows) == 'Zone | Frog', 'a source group with nothing missing leaves: ' .. names(rows))
click(c.missingOnly)

-- A short list has no scroll thumb.
assert(not c.rows.thumb.shown and not c.rows.track.shown, 'nothing to scroll')
-- Toys: the mouse wheel scrolls three rows, and the list stops with its last row at the bottom.
click(c.sections.toys)
assert(c.summary.text == "Toys: 1 of 20 (5%) · as the Toy Box's filters list them", c.summary.text)
assert(rows[1].name.text == 'Toy 01' and mark(rows[1]) == READY and rows[1].icon.path == 'toy3001')
local list = rows[1].parent
-- Scrolling redraws from the list as last read: the Toy Box is not asked again.
local asks, ask = 0, C_ToyBox.GetNumFilteredToys
C_ToyBox.GetNumFilteredToys = function() asks = asks + 1; return ask() end
list.scripts.OnMouseWheel(list, -1)
assert(asks == 0, 'a scroll reads nothing again')
C_ToyBox.GetNumFilteredToys = ask
assert(c.rows.offset == 3 and rows[1].name.text == 'Toy 04', rows[1].name.text)
-- The thumb: as tall as the share of the list on screen, as far down as the list is scrolled.
local track, thumb = rows.track, rows.thumb
assert(track.shown and thumb.shown and thumb.height == math.floor(track.height * 12 / 20), thumb.height)
local room = track.height - thumb.height
assert(thumb.point[5] == -math.floor(room * 3 / 8 + 0.5), thumb.point[5])
for _ = 1, 5 do list.scripts.OnMouseWheel(list, -1) end
assert(c.rows.offset == 8 and rows[12].name.text == 'Toy 20', 'the last row stays at the bottom')
assert(thumb.point[5] == -room, 'the thumb at the bottom')
list.scripts.OnMouseWheel(list, 1)
assert(c.rows.offset == 5)
for _ = 1, 4 do list.scripts.OnMouseWheel(list, 1) end
assert(c.rows.offset == 0 and rows[1].name.text == 'Toy 01' and thumb.point[5] == 0, 'the top holds')
assert(rows.up == nil and rows.down == nil, 'the wheel and the thumb replace the paging buttons')

-- Flight paths: each continent the world map lists, the nodes this character's faction can use, discovered or not.
click(c.sections.flights)
assert(c.summary.text == 'Flight paths: 1 of 3 (33%)', c.summary.text)
assert(names(rows) == 'Eastern Kingdoms | Undercity, Tirisfal | Kalimdor | Crossroads, The Barrens | Orgrimmar, Durotar', names(rows))
assert(rows[3].detail.text == '1 / 2 (50%)' and mark(rows[5]) == READY and mark(rows[4]) == NOT_READY, rows[3].detail.text)
click(c.missingOnly)
assert(names(rows) == 'Eastern Kingdoms | Undercity, Tirisfal | Kalimdor | Crossroads, The Barrens', names(rows))
click(c.missingOnly)
-- An overview row opens its area.
click(c.sections.overview)
for _, r in ipairs(rows) do if r.shown and r.name.text == 'Mounts' then click(r) end end
assert(c.section == 'mounts' and c.summary.text == 'Mounts: 1 of 2 (50%)', c.section)

-- Nothing listed: the journal says how to fill it.
pets = {}
click(c.sections.pets)
assert(shown(rows) == 0 and rows.empty.text:find('Pet Journal lists no pets', 1, true), rows.empty.text)
assert(EverlootWindow.shown and not U.failed)
""")

# --- A large price file is checked a slice per frame: the page says so, then draws the drops once the check ends ---
BIG = DROPS + "".join(f";{9000 + i},n,9999,1,10,3" for i in range(1500))
assert len(BIG) > 20000, "more than one checksum slice"
lua = fresh("{ installId = 'abcd-1234', toggles = { completion = true }, records = {} }",
            API.replace(DROPS, BIG).replace(str(SUM), str(zlib.adler32(BIG.encode()))),
            extra=("modules/completion.lua", "modules/owned.lua"))
lua.execute(HELPERS + r"""
assert(U.Open('collection') == true)
local c = EverlootWindow.collection
click(c.sections.raids)
assert(c.summary.text:find('drops: checking the price file', 1, true) and not c.rows[3].toggle.shown, c.summary.text)
drain()
assert(not c.summary.text:find('drops:', 1, true) and c.rows[3].toggle.shown and c.rows[3].name.text == 'Ghamoo-ra',
  'redrawn with the drops once the check ended: ' .. c.summary.text)
assert(EverlootWindow.shown and not U.failed)
""")

# --- No drops block in the price file: the bosses stay plain rows and the summary says why ---
lua = fresh("{ installId = 'abcd-1234', toggles = { completion = true }, records = {} }",
            "date = os.date\nUnitGUID = function() return 'Player-1-0001' end\n", extra=("modules/completion.lua", "modules/owned.lua"))
lua.execute(HELPERS + r"""
assert(U.Open('collection') == true)
local c = EverlootWindow.collection
click(c.sections.raids)
assert(c.summary.text:find('drops: not in the price file yet (the Desktop App writes it)', 1, true), c.summary.text)
assert(names(c.rows) == 'Dungeons | Blackfathom Deeps | Ghamoo-ra' .. TAIL and not c.rows[3].toggle.shown, names(c.rows))
-- Without the journals the sections say so instead of failing.
click(c.sections.mounts)
assert(c.rows.empty.shown and c.rows.empty.text == 'The game lists no mounts on this client.', c.rows.empty.text)
click(c.sections.toys)
assert(c.rows.empty.shown and c.rows.empty.text:find('Toy Box lists no toys', 1, true))
click(c.sections.flights)
assert(c.rows.empty.shown and c.rows.empty.text:find('no flight paths', 1, true), c.rows.empty.text)
assert(EverlootWindow.shown and not U.failed)
""")
print("Lua 5.1 Collection tree: boss drops from the price file by the creatures seen or the boss's name, open and close with "
      "counts, quality colours, icons and the game's tooltip; Missing only; mounts and pets by source, toys from the journals; "
      "flight paths from the flight map; the overview's counts; wheel scroll with a thumb")
