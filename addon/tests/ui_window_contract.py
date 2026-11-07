"""Run with: uv run --with lupa python addon/tests/ui_window_contract.py

The Everloot window (modules/window.lua): built the first time it opens, from the minimap button or
/everloot window, and drawn only from what the client and the saved file hold. A value it cannot read is a
dash, never a number. It registers no events, so recording never runs through it: an error inside it closes
the window and leaves capture as it was, and the off switch keeps it from being built at all. Its title is
Everloot in fel green, and the settings page borrows its look at load without building it. The item
tooltip keeps its lines under one "Everloot" header, and the crest texture ships in the addon zip.
"""
import shutil
import zlib
import struct
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile
from window_world import AFTER, BEFORE, WORLD, fresh  # noqa: F401

root = Path(__file__).parents[1]
repo = root.parent

# --- The file itself: no events, no hooks on the recording frame, the game's own fonts and the bronze edge ---
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\window.lua" in toc, "the window is in the TOC"
assert toc.index("modules\\window.lua") < toc.index("modules\\minimap.lua"), "the window loads before the minimap button"
source = (root / "modules" / "window.lua").read_text(encoding="utf-8")
code = "\n".join(line.split("--")[0] for line in source.splitlines())
# The window and every view file read and display only.
for path in [root / "modules" / "window.lua", *sorted((root / "modules").glob("view_*.lua"))]:
    text = path.read_text(encoding="utf-8")
    lines = "\n".join(line.split("--")[0] for line in text.splitlines())
    for word in ["RegisterEvent", "HookScript", "hooksecurefunc", "E:Store", "EverlootDB.records[", "SendAddonMessage"]:
        assert word not in lines, f"{path.name} reads and displays only: {word} found"
    assert "Coming soon" not in text, f"no stubs in {path.name}"
assert "Fonts\\\\FRIZQT__.TTF" in code and "Fonts\\\\ARIALN.TTF" in code, "Friz Quadrata headings, Arial Narrow numbers"
assert "UI-Tooltip-Border" in code and "SetBackdropBorderColor" in code, "the stock tooltip edge, tinted"
assert "Coming soon" not in source, "no stubs in the window"
prices = (root / "modules" / "prices.lua").read_text(encoding="utf-8")
for word in ["CreateTexture", "CreateFontString", "SetFont"]:
    assert word not in prices, f"the tooltip uses AddLine and |T..|t only: {word} found in prices.lua"

# --- The crest: a power-of-two, 32-bit uncompressed TGA where the code looks for it ---
crest = (root / "media" / "crest.tga").read_bytes()
id_len, cmap, kind, _, _, _, _, _, width, height, depth, desc = struct.unpack("<BBBHHBHHHHBB", crest[:18])
assert kind == 2 and depth == 32 and desc & 0x0F == 8, "uncompressed true colour with 8 alpha bits"
assert width == height and width in (64, 128) and len(crest) == 18 + id_len + width * height * 4, (width, height, len(crest))
assert 'Interface\\\\AddOns\\\\Everloot\\\\media\\\\crest' in code and 'Interface\\\\AddOns\\\\Everloot\\\\media\\\\crest:14:14' in prices

# --- It builds under the stub frame API and shows only real values ---
# The key core.lua's E.CharacterKey gives this install and player GUID.
ME = "%08x" % zlib.adler32(b"abcd-1234:Player-1-0001")
API = ("UnitGUID = function() return 'Player-1-0001' end\n"
       "date = os.date\n"
       "RAID_CLASS_COLORS.MAGE = { r = 0.25, g = 0.78, b = 0.92 }\n"
       "RAID_CLASS_COLORS.ROGUE = { r = 1, g = 0.96, b = 0.41 }\n")
SAVED = f"""{{ installId = 'abcd-1234', toggles = {{}}, records = {{
    recipe_observed = {{ {{ profession = 'Cooking' }}, {{ profession = 'Cooking' }} }},
    lockout_owned = {{ {{ characterKey = 'bbbb0002', instance = 'Karazhan', resetAt = '2030-01-01T00:00:00Z' }}, {{ characterKey = 'bbbb0002', instance = 'Gruul', resetAt = '2030-01-02T00:00:00Z' }}, {{ characterKey = 'bbbb0002', instance = 'Magtheridon', resetAt = '1970-01-02T00:00:00Z' }}, {{ characterKey = 'zzzz', instance = 'Other' }} }} }},
  ledger = {{ events = {{
    {{ at = 1000000 - 3600, key = '{ME}', category = 'quest', copper = 12345 }},
    {{ at = 1000000 - 7200, key = '{ME}', category = 'flight', copper = 77 }},
    {{ at = 1000000 - 8 * 86400, key = '{ME}', category = 'vendor', copper = 5000000 }},
    {{ at = 1000000 - 3600, key = 'aaaa0001', category = 'quest', copper = 999 }},
  }} }},
  roster = {{
    ['{ME}'] = {{ name = 'Samplechar', realm = 'Forever', class = 'SHAMAN', level = 24, copper = 1312745, lastSeen = 1794052800,
      professions = {{ {{ name = 'Mining', rank = 112, maxRank = 150 }}, {{ name = 'Cooking', rank = 1, maxRank = 75 }} }} }},
    aaaa0001 = {{ name = 'Alt', realm = 'Forever', class = 'ROGUE', level = 12, copper = 500 }},
    bbbb0002 = {{ name = 'Mage', realm = 'Nightfall', class = 'MAGE', level = 30 }},
  }} }}"""
lua = fresh(SAVED, API)
lua.execute("""
local U = Everloot.Window
assert(U.frame == nil and EverlootWindow == nil, 'nothing is built at load')
assert(Everloot:Status():find('window: ready'), 'the module reports in /everloot status')
local page = Everloot.Options.page
assert(page.crest and page.crest.path == 'Interface\\\\AddOns\\\\Everloot\\\\media\\\\crest' and page.title.color[2] > 0.9,
  'the settings page, built at load, already wears the crest and fel green title')

-- Gold the gold module records: a vendor sale, a quest reward and a flight.
fire('PLAYER_ENTERING_WORLD')
fire('MERCHANT_SHOW'); money = money + 41000; fire('PLAYER_MONEY'); fire('MERCHANT_CLOSED')
fire('QUEST_TURNED_IN', 1, 0, 67500); money = money + 67500; fire('PLAYER_MONEY')
fire('TAXIMAP_OPENED'); money = money - 55; fire('PLAYER_MONEY'); fire('TAXIMAP_CLOSED')
assert(Everloot:Count('money_event') == 3, 'three money events recorded')

table.insert(Everloot.Window.NAV, { key = 'ghost', label = 'Ghost', icon = 'INV_Misc_QuestionMark' })
assert(U.Open() == true, 'the window opens')
local f = EverlootWindow
assert(f == U.frame and f.shown and f.template == 'BackdropTemplate', 'one named window, shown')
assert(f.backdrop.edgeFile == 'Interface\\\\Tooltips\\\\UI-Tooltip-Border' and f.border[1] > f.border[3], 'bronze-tinted tooltip edge')
assert(f.crest.path == 'Interface\\\\AddOns\\\\Everloot\\\\media\\\\crest', 'the crest')
assert(f.title.text == 'Everloot' and f.title.color[2] > 0.9 and f.title.color[1] < 0.7 and f.title.color[3] < 0.3,
  'Everloot in fel green, as in the tooltip, the settings page and the auction house tab')
assert(f.subtitle.text == 'Home' and f.home.shown ~= false and f.nav.home.on.shown, 'Home is open, its nav item lit')
assert(f.name.text == 'Samplechar' and f.realm.text == 'Forever', f.name.text)
assert(f.class.text:find('^Level 24 Orc |cff0070dd') and f.class.text:find('Shaman'), f.class.text)
assert(f.onHand.text:find('^48|TInterface\\\\MoneyFrame\\\\UI%-GoldIcon') and f.onHand.text:find('96|T.-Silver') and f.onHand.text:find('85|T.-Copper'), f.onHand.text)
assert(f.peak.text:find('^48|T'), 'the peak the gold module saved: ' .. f.peak.text)
local U0 = Everloot.Window
-- The seeded events (12345 in, 77 out) plus the vendor sale, quest reward and flight the gold module just recorded live.
assert(f.week.text == 'This week: +' .. U0.Money(12345 + 41000 + 67500) .. ' / -' .. U0.Money(77 + 55), 'this character, last 7 days only: ' .. f.week.text)
assert(rawget(f, 'ledger') == nil, 'the Recorded line is the week line now')
assert(f.perHour.text == '-' and f.session.text:find('not running') and f.gphButton.text == 'Start', 'no session, no number')

local rows = f.profRows
assert(rows[1].name.text == 'Mining' and rows[1].rank.text == '112 / 150' and rows[1].bar.hi == 150 and rows[1].bar.value == 112)
assert(rows[2].name.text == 'Fishing' and rows[3].name.text == 'Cooking', rows[3].name.text)
assert(rows[4].name.shown == false and rows[4].bar.shown == false, 'unused rows are hidden')

-- Home across alts: realm lines and characters sorted realm then name, class colours, totals, lockouts, last seen.
assert(rawget(f, 'added') == nil and Everloot.Window.ADDED == nil, 'the row counts left the window for Settings')
local r = f.roster
local function shownRows() local n = 0; for _, row in ipairs(r.rows) do if row.shown then n = n + 1 end end; return n end
assert(#r.rows == 10 and shownRows() == 5, 'two realm lines and three characters')
assert(r.rows[1].name.text:find('^Forever') and r.rows[2].name.text == 'Alt' and r.rows[3].name.text == 'Samplechar'
  and r.rows[4].name.text:find('^Nightfall') and r.rows[5].name.text == 'Mage', 'realm, then name')
assert(r.rows[2].name.color[1] == 1 and r.rows[2].name.color[3] == 0.41, 'Alt is rogue yellow')
assert(r.rows[5].name.color[1] == 0.25 and r.rows[5].name.color[3] == 0.92, 'Mage is mage blue')
assert(r.rows[3].name.color[1] < 0.7 and r.rows[3].name.color[2] > 0.9 and r.rows[3].name.color[3] < 0.3, 'this character is marked in the accent colour')
local mine = EverlootDB.roster[Everloot.CharacterKey()].copper
assert(mine == money, 'this character reads gold from the client when the window opens')
assert(r.realmTotals.Forever.text == 'Forever · ' .. Everloot.Window.Money(mine + 500) and r.realmTotals.Forever.copper == mine + 500, r.realmTotals.Forever.text)
assert(r.realmTotals.Nightfall.text == 'Nightfall · -' and r.realmTotals.Nightfall.copper == nil, 'no gold read, a dash')
assert(r.accountTotal.text == 'Account: ' .. Everloot.Window.Money(mine + 500), r.accountTotal.text)
assert(r.rows[3].level.text == '24' and r.rows[3].gold.text == Everloot.Window.MoneyShort(mine) and r.rows[2].gold.text == Everloot.Window.MoneyShort(500), r.rows[2].gold.text)
assert(r.rows[3].profs.text == 'Mining 112, Fishing 20, Cooking 1' and r.rows[2].profs.text == '-', r.rows[3].profs.text)
assert(r.rows[3].lockouts.text == '-' and r.rows[5].lockouts.text == '-', 'lockouts are read only while the completion tracker is on')
assert(r.rows[3].seen.text == '1970-01-12' and r.rows[2].seen.text == '-', r.rows[3].seen.text)
EverlootDB.toggles.completion = true
Everloot.Window.Refresh()
-- Magtheridon's reset time has passed: two live lockouts, as the Collection view counts them.
assert(r.rows[5].lockouts.text == '2 raids' and r.rows[3].lockouts.text == '-' and r.rows[2].lockouts.text == '-', r.rows[5].lockouts.text)
EverlootDB.records.lockout_owned[2].resetAt = '1970-01-03T00:00:00Z'
Everloot.Window.Refresh()
assert(r.rows[5].lockouts.text == '1 raid', 'one live, two past their reset: ' .. r.rows[5].lockouts.text)
EverlootDB.toggles.completion = false
Everloot.Window.Refresh()

-- Paging: more than 10 lines show Down only; Down moves a page and clamps at the end; Up goes back.
assert(r.up.shown == false and r.down.shown == false, 'a short list pages nowhere')
for i = 1, 12 do EverlootDB.roster['zz' .. string.format('%02d', i)] = { name = 'Zed' .. string.format('%02d', i), realm = 'Zeta', class = 'MAGE', level = 5 } end
Everloot.Window.Refresh()
assert(shownRows() == 10 and r.rows[1].name.text:find('^Forever') and r.down.shown and not r.up.shown, 'first page, Down only')
r.down.scripts.OnClick(r.down)
assert(r.offset == 10 and r.rows[1].name.text == 'Zed05' and shownRows() == 8, 'second page starts at the 11th line: ' .. r.rows[1].name.text)
assert(r.up.shown and not r.down.shown, 'at the end, Up only')
r.down.scripts.OnClick(r.down)
assert(r.offset == 10, 'the offset is clamped at the end')
r.up.scripts.OnClick(r.up)
assert(r.offset == 0 and r.rows[1].name.text:find('^Forever') and r.down.shown and not r.up.shown, 'Up returns to the first page')

-- Gold per hour from the gph session, and Pause runs the gph command.
EverlootDB.gph.current = { v = 1, elapsed = 0, runningSince = now - 600, counts = {}, distinct = 0,
  money = { loot = 5000, quest = 0, vendor = 0 }, zones = {} }
f.scripts.OnUpdate(f, 1)
assert(f.perHour.text:find('^3|T.-Gold') and f.session.text:find('Running') and f.session.text:find('10 min') and f.gphButton.text == 'Pause', f.perHour.text)
f.gphButton.scripts.OnClick(f.gphButton)
assert(EverlootDB.gph.current.runningSince == nil and f.gphButton.text == 'Resume' and f.session.text:find('^Paused'), 'Pause pauses the session')

-- Sidebar: Home, Gold, Collection, Professions, Settings. A view registers by key; one that did not load says so.
assert(f.nav.ask == nil and f.nav.plan == nil and f.nav.auctions == nil, 'Ask, Build plan and Auctions left the sidebar')
assert(f.nav.gold and f.nav.collection and f.nav.professions and f.nav.settings, 'Home, Gold, Collection, Professions, Settings')
Everloot.Window.Views.collection = { build = function(f, parent) parent.built = true end, refresh = function(f) local v = f.views.collection; v.refreshed = (rawget(v, 'refreshed') or 0) + 1 end }
f.nav.collection.scripts.OnClick(f.nav.collection)
assert(f.home.shown == false and f.views.collection.shown and rawget(f.views.collection, 'built') and f.views.collection.refreshed == 1 and f.subtitle.text == 'Collection')
assert(f.nav.collection.on.shown and not f.nav.home.on.shown, 'fel green marks only the open item')
f.nav.ghost.scripts.OnClick(f.nav.ghost)
assert(f.views.collection.shown == false and f.note.shown and f.note.text:find('did not load'), 'an unregistered view says so')
assert(not f.note.text:find('oon'), 'no coming soon')
f.nav.settings.scripts.OnClick(f.nav.settings)
assert(Everloot.Options.page and Everloot.Options.page.shown, 'Settings opens the options page')
f.nav.home.scripts.OnClick(f.nav.home)
assert(f.home.shown and f.note.shown == false)

-- /everloot window toggles it; Escape closes it.
SlashCmdList.EVERLOOT('window')
assert(f.shown == false, 'the command closes an open window')
SlashCmdList.EVERLOOT('window')
assert(f.shown, 'and opens it again')
local escapes = false
for _, name in ipairs(UISpecialFrames) do if name == 'EverlootWindow' then escapes = true end end
assert(escapes, 'Escape closes it')

-- No stray globals: only named frames (the window's, and the pages its buttons open) are new.
local extra = {}
for k, v in pairs(_G) do
  if not globalsBefore[k] and not (type(v) == 'table' and v.frameName == k and k:find('^Everloot')) then extra[#extra + 1] = tostring(k) end
end
assert(#extra == 0, 'stray globals: ' .. table.concat(extra, ', '))
""")

# --- Fonts follow the client: a CJK or Cyrillic client's own fonts, the Latin paths only as a fallback ---
lua = fresh("{ installId = 'abcd-1234', toggles = {}, records = {} }", """
STANDARD_TEXT_FONT = 'Fonts\\\\2002.TTF'
NumberFontNormal = { GetFont = function() return 'Fonts\\\\2002B.TTF', 12, '' end }
""")
lua.execute("""
assert(Everloot.Window.Open())
local f = EverlootWindow
assert(f.title.font == 'Fonts\\\\2002.TTF', 'the title uses the client font: ' .. tostring(f.title.font))
assert(f.realm.font == 'Fonts\\\\2002.TTF', 'the realm line too: ' .. tostring(f.realm.font))
assert(f.onHand.font == 'Fonts\\\\2002B.TTF', 'numbers use the client number font: ' .. tostring(f.onHand.font))
assert(Everloot.Window.NARROW == 'Fonts\\\\2002B.TTF')
""")
lua = fresh("{ installId = 'abcd-1234', toggles = {}, records = {} }", """
STANDARD_TEXT_FONT = 5
NumberFontNormal = { GetFont = function() error('no font') end }
""")
lua.execute("""
assert(Everloot.Window.Open())
assert(EverlootWindow.title.font == 'Fonts\\\\FRIZQT__.TTF' and Everloot.Window.NARROW == 'Fonts\\\\ARIALN.TTF', 'a bad value falls back to the Latin fonts')
""")

# --- A value the client cannot give, or will not let the addon read, is a dash ---
lua = fresh("{ installId = 'abcd-1234', toggles = {}, records = {} }", """
GetMoney = nil
GetProfessions = nil
SECRET_NAME = 'Hidden'
SECRET[SECRET_NAME] = true
UnitName = function() return SECRET_NAME end
""")
lua.execute("""
assert(Everloot.Window.Open())
local f = EverlootWindow
assert(f.name.text == '-' and f.onHand.text == '-' and f.peak.text == '-' and f.perHour.text == '-', 'dashes, not numbers')
assert(f.profRows[1].name.text == '-' and f.profRows[1].bar.shown == false, 'no profession book, no bars')
assert(f.week.text == 'This week: -', f.week.text)
assert(f.roster.accountTotal.text == 'Account: -' and not f.roster.rows[1].shown, 'no characters, no rows')
""")

# --- A forced error inside the window never stops an event from being recorded ---
for failure in [
    "failOn = 'StatusBar'",                                                    # while building
    "Everloot.Window.HomeData = function() error('forced refresh failure') end",  # while refreshing
]:
    lua = fresh("{ installId = 'abcd-1234', toggles = {}, records = {} }")
    lua.execute(failure)
    lua.execute("""
    fire('PLAYER_ENTERING_WORLD')
    local snapshots = Everloot:Count('gold_snapshot')
    assert(Everloot.Window.Open() == false, 'a broken window reports that it did not open')
    assert(Everloot.Window.failed and said('Recording is not affected'), 'the player is told once')
    assert(Everloot:Status():find('window: error, closed until /reload'), Everloot:Status())
    assert((EverlootWindow == nil or EverlootWindow.shown == false) and (Everloot.Window.frame == nil or Everloot.Window.frame.shown == false), 'nothing broken stays on screen')
    assert(Everloot.Window.Open() == false, 'it stays closed this session')
    -- Recording goes on: a merchant sale and looted copper are both stored.
    failOn = nil
    fire('MERCHANT_SHOW'); money = money + 500; fire('PLAYER_MONEY'); fire('MERCHANT_CLOSED')
    GetNumLootItems = function() return 1 end
    GetLootSlotType = function() return 2 end
    GetLootSlotInfo = function() return nil, nil, 1234 end
    fire('LOOT_OPENED')
    local events = EverlootDB.records.money_event
    assert(#events == 2 and events[1].category == 'vendor' and events[1].copper == 500 and events[2].category == 'loot', 'capture is untouched')
    assert(Everloot:Count('gold_snapshot') > snapshots, 'gold snapshots still written')
    """)

# An error in the once-a-second refresh closes the window, and capture still runs.
lua = fresh("{ installId = 'abcd-1234', toggles = {}, records = {} }")
lua.execute("""
assert(Everloot.Window.Open())
Everloot.Window.RefreshLive = function() error('forced tick failure') end
EverlootWindow.scripts.OnUpdate(EverlootWindow, 1)
assert(EverlootWindow.shown == false and Everloot.Window.failed, 'the tick error closes the window')
fire('PLAYER_ENTERING_WORLD')
fire('MERCHANT_SHOW'); money = money + 700; fire('PLAYER_MONEY')
assert(EverlootDB.records.money_event[1].copper == 700, 'capture is untouched')
-- The minimap button falls back to the plan workspace or the options page instead.
Minimap = {}
local button = Everloot.Minimap.Button()
button.scripts.OnClick(button, 'LeftButton')
assert(Everloot.Options.page and Everloot.Options.page.shown, 'a failed window hands the click to the options page')
""")

# --- The off switch: nothing is built, and the minimap button opens what it opened before ---
lua = fresh("{ installId = 'abcd-1234', toggles = { window = false }, records = {} }")
lua.execute("""
assert(Everloot:Status():find('window: off by toggle'), Everloot:Status())
local before = #created
assert(Everloot.Window.Open() == false and said('the window is off'), 'off: it does not open')
assert(Everloot.Window.frame == nil and EverlootWindow == nil and #created == before, 'off: not one frame is created')
Minimap = {}
local button = Everloot.Minimap.Button()
button.scripts.OnClick(button, 'LeftButton')
assert(Everloot.Window.frame == nil and Everloot.Options.page.shown, 'the minimap button skips the window')
-- The switch is on the options page, first, and it sets the toggle.
local O = Everloot.Options
assert(O.ROWS[1].key == 'window' and not O.IsOn(O.ROWS[1]))
O.Set(O.ROWS[1], true)
assert(EverlootDB.toggles.window == true and O.IsOn(O.ROWS[1]))
O.Set(O.ROWS[1], false)
assert(EverlootDB.toggles.window == false)
""")

# Without the window's file (an older install) the minimap button opens the options page as before.
lua = fresh("{ installId = 'abcd-1234', toggles = {}, records = {} }", window=False)
lua.execute("""
Minimap = {}
local button = Everloot.Minimap.Button()
button.scripts.OnClick(button, 'LeftButton')
assert(Everloot.Options.page.shown)
""")

# --- The tooltip: the same lines under one fel-green header with the crest inline ---
lua = fresh("{ installId = 'abcd-1234', toggles = {}, records = {} }")
lua.execute("assert(#tooltipFor(2589) == 0, 'no file, no header either')")
lua.execute((root / "tests" / "fixtures" / "EverlootPrices.lua").read_text(encoding="utf-8"))
lua.execute("""
Everloot:ResetPrices()
tooltipFor(2589); drain()
local lines = tooltipFor(2589)
local head = lines[1]
assert(head.text == '|TInterface\\\\AddOns\\\\Everloot\\\\media\\\\crest:14:14:0:0:128:128:36:92:36:92|t Everloot', head.text)
assert(head.r < 0.7 and head.g > 0.9 and head.b < 0.3, 'fel green')
assert(lines[2].text:find('^Everloot market 2s 5c'), 'the existing lines follow, unchanged: ' .. lines[2].text)
local headers = 0
for _, l in ipairs(lines) do if l.text:find('media\\\\crest') then headers = headers + 1 end end
assert(headers == 1, 'one header per tooltip')
""")

# --- The crest ships: the packaging script puts every addon/media TGA in the zip, byte for byte ---
with tempfile.TemporaryDirectory() as tmp:
    copy = Path(tmp)
    shutil.copytree(root, copy / "addon", ignore=shutil.ignore_patterns("tests", "__pycache__"))
    (copy / "scripts").mkdir()
    shutil.copy(repo / "scripts" / "package-addon.py", copy / "scripts" / "package-addon.py")
    subprocess.run([sys.executable, "-I", str(copy / "scripts" / "package-addon.py")], check=True, capture_output=True)
    built = next((copy / "web" / "public" / "downloads").glob("Everloot-*.zip"))
    with ZipFile(built) as archive:
        names = archive.namelist()
        assert "Everloot/media/crest.tga" in names and "Everloot/modules/window.lua" in names, names
        assert archive.read("Everloot/media/crest.tga") == crest, "the texture is stored byte for byte"

print("Lua 5.1 window: built on first open from the file's own values, dashes for the rest; a UI error or the off switch never touches capture; one tooltip header; the crest ships")
