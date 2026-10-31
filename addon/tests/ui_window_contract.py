"""Run with: uv run --with lupa python addon/tests/ui_window_contract.py

The Everloot window (modules/window.lua): built the first time it opens, from the minimap button or
/everloot window, and drawn only from what the client and the saved file hold. A value it cannot read is a
dash, never a number. It registers no events, so recording never runs through it: an error inside it closes
the window and leaves capture as it was, and the off switch keeps it from being built at all. The item
tooltip keeps its lines under one "Everloot" header, and the crest texture ships in the addon zip.
"""
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile
from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]
repo = root.parent

WORLD = """
now = 1000000
time = function() return now end
date = function() return '2026-10-30T10:00:00Z' end
printed = {}
print = function(msg) printed[#printed + 1] = tostring(msg) end
function said(pattern) for _, p in ipairs(printed) do if string.find(p, pattern) then return true end end return false end
SlashCmdList = {}
UIParent = { GetWidth = function() return 1920 end, GetHeight = function() return 1080 end }
UISpecialFrames = {}
SECRET = {}
issecretvalue = function(v) return SECRET[v] == true end

-- A frame API that accepts every call and keeps what the window sets, so a test can read it back. As in the game,
-- a named frame becomes a global and a new frame is shown until something hides it.
created = {}
failOn = nil
local Frame = {}
Frame.__index = function(self, key)
  local own = rawget(Frame, key)
  if own then return own end
  return function() end
end
local function new(kind, name, parent, template)
  local f = setmetatable({ kind = kind, frameName = name, parent = parent, template = template, scripts = {}, hooks = {}, events = {}, shown = true }, Frame)
  created[#created + 1] = f
  if name then _G[name] = f end
  return f
end
function Frame.SetScript(self, script, f) self.scripts[script] = f; if script == 'OnEvent' then self.onEvent = f end end
function Frame.HookScript(self, _, f) table.insert(self.hooks, f) end
function Frame.SetText(self, t) self.text = t end
function Frame.GetText(self) return self.text end
function Frame.Show(self) self.shown = true end
function Frame.Hide(self) self.shown = false end
function Frame.IsShown(self) return self.shown == true end
function Frame.SetTexture(self, path) self.path = path end
function Frame.SetBackdrop(self, b) self.backdrop = b end
function Frame.SetBackdropBorderColor(self, r, g, b) self.border = { r, g, b } end
function Frame.SetFont(self, path, size) self.font = path; return true end
function Frame.SetMinMaxValues(self, lo, hi) self.lo, self.hi = lo, hi end
function Frame.SetValue(self, v) self.value = v end
function Frame.SetChecked(self, v) self.checked = v and true or false end
function Frame.GetChecked(self) return self.checked end
function Frame.RegisterEvent(self, e) self.events[e] = true end
function Frame.CreateFontString(self) return new('FontString') end
function Frame.CreateTexture(self) return new('Texture') end
CreateFrame = function(kind, name, parent, template)
  if failOn == kind then error('forced failure creating a ' .. kind) end
  return new(kind, name, parent, template)
end

-- The core frame dispatches to its OnEvent script, then to every module's hook, as the game does.
function fire(event, ...)
  local f = Everloot.frame
  f.onEvent(f, event, ...)
  for _, hook in ipairs(f.hooks) do hook(f, event, ...) end
end

money = 381240
GetMoney = function() return money end
UnitName = function() return 'Samplechar' end
UnitClass = function() return 'Shaman', 'SHAMAN' end
UnitRace = function() return 'Orc' end
UnitLevel = function() return 24 end
GetRealmName = function() return 'Forever' end
RAID_CLASS_COLORS = { SHAMAN = { r = 0, g = 0.44, b = 0.87 } }
GetProfessions = function() return 1, nil, nil, 4, 5 end
GetProfessionInfo = function(i)
  if i == 1 then return 'Mining', 'Interface\\\\Icons\\\\Trade_Mining', 112, 150 end
  if i == 4 then return 'Fishing', 'Interface\\\\Icons\\\\Trade_Fishing', 20, 75 end
  if i == 5 then return 'Cooking', 'Interface\\\\Icons\\\\INV_Misc_Food_15', 1, 75 end
end
timers = {}
C_Timer = { After = function(seconds, f) table.insert(timers, f) end }
function drain() while #timers > 0 do table.remove(timers, 1)() end end
tooltipCalls = {}
Enum = { TooltipDataType = { Item = 0 } }
TooltipDataProcessor = { AddTooltipPostCall = function(kind, f) table.insert(tooltipCalls, f) end }
function tooltipFor(itemId)
  local tip = { lines = {} }
  tip.AddLine = function(self, text, r, g, b) table.insert(self.lines, { text = text, r = r, g = g, b = b }) end
  for _, f in ipairs(tooltipCalls) do f(tip, { id = itemId }) end
  return tip.lines
end
"""

BEFORE = ["core.lua", "modules/auctions.lua", "modules/gold.lua", "modules/prices.lua", "modules/drops.lua",
          "modules/gph.lua", "modules/options.lua"]
AFTER = ["modules/minimap.lua"]


def fresh(saved: str = "nil", api: str = "", window: bool = True):
    lua = LuaRuntime()
    lua.execute(WORLD)
    lua.execute(api)
    lua.execute(f"EverlootDB = {saved}")
    for file in BEFORE:
        lua.execute((root / file).read_text(encoding="utf-8"))
    # Every global that exists before the window's file runs; the window may add its own frame name only.
    lua.execute("globalsBefore = {}; for k in pairs(_G) do globalsBefore[k] = true end")
    if window:
        lua.execute((root / "modules" / "window.lua").read_text(encoding="utf-8"))
    for file in AFTER:
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute("Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')")
    return lua


# --- The file itself: no events, no hooks on the recording frame, the game's own fonts and the bronze edge ---
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\window.lua" in toc, "the window is in the TOC"
assert toc.index("modules\\window.lua") < toc.index("modules\\minimap.lua"), "the window loads before the minimap button"
source = (root / "modules" / "window.lua").read_text(encoding="utf-8")
code = "\n".join(line.split("--")[0] for line in source.splitlines())
for word in ["RegisterEvent", "HookScript", "hooksecurefunc", "E:Store", "EverlootDB.records[", "SendAddonMessage"]:
    assert word not in code, f"the window reads and displays only: {word} found"
assert "Fonts\\\\FRIZQT__.TTF" in code and "Fonts\\\\ARIALN.TTF" in code, "Friz Quadrata headings, Arial Narrow numbers"
assert "UI-Tooltip-Border" in code and "SetBackdropBorderColor" in code, "the stock tooltip edge, tinted"
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
SAVED = "{ installId = 'abcd-1234', toggles = {}, records = { recipe_observed = { { profession = 'Cooking' }, { profession = 'Cooking' } } } }"
lua = fresh(SAVED)
lua.execute("""
local U = Everloot.Window
assert(U.frame == nil and EverlootWindow == nil, 'nothing is built at load')
assert(Everloot:Status():find('window: ready'), 'the module reports in /everloot status')

-- Gold the gold module records: a vendor sale, a quest reward and a flight.
fire('PLAYER_ENTERING_WORLD')
fire('MERCHANT_SHOW'); money = money + 41000; fire('PLAYER_MONEY'); fire('MERCHANT_CLOSED')
fire('QUEST_TURNED_IN', 1, 0, 67500); money = money + 67500; fire('PLAYER_MONEY')
fire('TAXIMAP_OPENED'); money = money - 55; fire('PLAYER_MONEY'); fire('TAXIMAP_CLOSED')
assert(Everloot:Count('money_event') == 3, 'three money events recorded')

assert(U.Open() == true, 'the window opens')
local f = EverlootWindow
assert(f == U.frame and f.shown and f.template == 'BackdropTemplate', 'one named window, shown')
assert(f.backdrop.edgeFile == 'Interface\\\\Tooltips\\\\UI-Tooltip-Border' and f.border[1] > f.border[3], 'bronze-tinted tooltip edge')
assert(f.crest.path == 'Interface\\\\AddOns\\\\Everloot\\\\media\\\\crest', 'the crest')
assert(f.subtitle.text == 'Home' and f.home.shown ~= false and f.nav.home.on.shown, 'Home is open, its nav item lit')
assert(f.name.text == 'Samplechar' and f.realm.text == 'Forever', f.name.text)
assert(f.class.text:find('^Level 24 Orc |cff0070dd') and f.class.text:find('Shaman'), f.class.text)
assert(f.onHand.text:find('^48|TInterface\\\\MoneyFrame\\\\UI%-GoldIcon') and f.onHand.text:find('96|T.-Silver') and f.onHand.text:find('85|T.-Copper'), f.onHand.text)
assert(f.peak.text:find('^48|T'), 'the peak the gold module saved: ' .. f.peak.text)
assert(f.ledger.text:find('Quests |cffffffff6g 75s|r') and f.ledger.text:find('Vendors |cffffffff4g 10s|r')
  and f.ledger.text:find('Flights |cffffffff%-55c|r'), f.ledger.text)
assert(not f.ledger.text:find('Loot'), 'a source with no rows is left out: ' .. f.ledger.text)
assert(f.perHour.text == '-' and f.session.text:find('not running') and f.gphButton.text == 'Start', 'no session, no number')

local rows = f.profRows
assert(rows[1].name.text == 'Mining' and rows[1].rank.text == '112 / 150' and rows[1].bar.hi == 150 and rows[1].bar.value == 112)
assert(rows[2].name.text == 'Fishing' and rows[3].name.text:find('^Cooking  .-2 recipe colours recorded'), rows[3].name.text)
assert(rows[4].name.shown == false and rows[4].bar.shown == false, 'unused rows are hidden')
for i, a in ipairs(Everloot.Window.ADDED) do
  assert(f.added[i].text == tostring(Everloot:Count(a[1])), a[2])
end
assert(f.added[4].text == '2', 'recipe colours counted from the file')

-- Gold per hour from the gph session, and Pause runs the gph command.
EverlootDB.gph.current = { v = 1, elapsed = 0, runningSince = now - 600, counts = {}, distinct = 0,
  money = { loot = 5000, quest = 0, vendor = 0 }, zones = {} }
f.scripts.OnUpdate(f, 1)
assert(f.perHour.text:find('^3|T.-Gold') and f.session.text:find('Running') and f.session.text:find('10 min') and f.gphButton.text == 'Pause', f.perHour.text)
f.gphButton.scripts.OnClick(f.gphButton)
assert(EverlootDB.gph.current.runningSince == nil and f.gphButton.text == 'Resume' and f.session.text:find('^Paused'), 'Pause pauses the session')

-- Other sidebar items: a line, or the part of the addon they open.
f.nav.collection.scripts.OnClick(f.nav.collection)
assert(f.home.shown == false and f.note.shown and f.note.text:find('Coming soon') and f.subtitle.text == 'Collection')
assert(f.nav.collection.on.shown and not f.nav.home.on.shown, 'fel green marks only the open item')
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
assert(f.ledger.text:find('No gold sources'), f.ledger.text)
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
