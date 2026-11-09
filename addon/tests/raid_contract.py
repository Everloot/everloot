"""Run with: uv run --with lupa python addon/tests/raid_contract.py"""
import json
from pathlib import Path
from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\raid_data.lua" in toc and "modules\\raid.lua" in toc, "raid files must be in the TOC"
source = (root / "modules" / "raid.lua").read_text(encoding="utf-8")
# Display only: the module may read the group and auras and nothing else.
for forbidden in ["CastSpellByName", "TargetUnit", "InviteUnit", "UninviteUnit", "SetRaidSubgroup", "SwapRaidSubgroup",
                  "PromoteToAssistant", "SendChatMessage", "RunMacro", "UseAction", "SecureActionButton", "E:Store"]:
    assert forbidden not in source, f"raid.lua must not call {forbidden}"

# The buff list is generated from the site's game-data layer, so it names that layer's build; the client stub runs it.
LAYER_BUILD = json.loads((root.parent / "web/src/data/game-data/client-layer.json").read_text(encoding="utf-8"))["build"]["version"]
VERSION, BUILD_NUMBER = LAYER_BUILD.rsplit(".", 1)

STUBS = f"""
LAYER_BUILD = '{LAYER_BUILD}'
BUILD = {{ '{VERSION}', '{BUILD_NUMBER}', 'Oct 1 2026', 11508 }}""" + """
date = function() return '2026-10-18T00:00:00Z' end
time = function() return 123456 end
printed = {}
print = function(...) local t = {} for i = 1, select('#', ...) do t[#t+1] = tostring((select(i, ...))) end table.insert(printed, table.concat(t, ' ')) end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function() end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function() end
} end
GetBuildInfo = function() return unpack(BUILD) end
"""

# A raid of 7: group 1 has a warrior, a druid and a mage; group 2 has a shaman, a priest, a paladin and a
# hunter. Buffs are placed by name. "far" is out of range, "off" is offline.
GROUP = """
group = { inRaid = true, members = {
 { name = 'Ash', sub = 1, class = 'WARRIOR', auras = { 'Battle Shout' } },
 { name = 'Bri', sub = 1, class = 'DRUID', auras = { 'Mark of the Wild', 'Battle Shout' } },
 { name = 'Cal', sub = 1, class = 'MAGE', auras = { 'Arcane Intellect', 'Battle Shout' } },
 { name = 'Dee', sub = 2, class = 'SHAMAN', auras = { 'Strength of Earth' } },
 { name = 'Eli', sub = 2, class = 'PRIEST', auras = { 'Power Word: Fortitude' } },
 { name = 'Fay', sub = 2, class = 'PALADIN', auras = {} },
 { name = 'Gus', sub = 2, class = 'HUNTER', auras = {}, far = true },
} }
IsInGroup = function() return #group.members > 0 end
IsInRaid = function() return group.inRaid end
GetNumGroupMembers = function() return #group.members end
GetRaidRosterInfo = function(i)
 local m = group.members[i]
 return m.name, 0, m.sub, 60, m.class:sub(1,1) .. m.class:sub(2):lower(), m.class
end
function member(unit)
 local n = unit:match('^raid(%d+)$')
 if n then return group.members[tonumber(n)] end
 if unit == 'player' then return group.members[1] end
 local p = unit:match('^party(%d+)$')
 return p and group.members[tonumber(p) + 1] or nil
end
UnitExists = function(u) return member(u) ~= nil end
UnitIsConnected = function(u) local m = member(u) return m ~= nil and not m.off end
UnitIsVisible = function(u) local m = member(u) return m ~= nil and not m.far end
UnitName = function(u) local m = member(u) return m and m.name end
UnitClass = function(u) local m = member(u) return m and (m.class:sub(1,1) .. m.class:sub(2):lower()), m and m.class end
calls = 0
"""

MODERN_AURAS = """
C_UnitAuras = { GetAuraDataByIndex = function(unit, i, filter)
 assert(filter == 'HELPFUL', 'only helpful auras are read')
 calls = calls + 1
 local m = member(unit)
 local name = m and m.auras[i]
 if not name then return nil end
 return { name = name, spellId = 900000 + i }
end }
"""

CLASSIC_AURAS = """
UnitAura = function(unit, i, filter)
 assert(filter == 'HELPFUL', 'only helpful auras are read')
 calls = calls + 1
 local m = member(unit)
 local name = m and m.auras[i]
 if not name then return nil end
 return name, 'icon', 1, nil, 0, 0, 'player', false, false, 800000 + i
end
"""


def fresh(extra: str = "", auras: str = MODERN_AURAS):
    lua = LuaRuntime()
    lua.execute(STUBS)
    lua.execute(GROUP)
    lua.execute(auras)
    lua.execute(extra)
    for file in ["core.lua", "modules/raid_data.lua", "modules/raid.lua"]:
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute("Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot')")
    return lua


lua = fresh()
lua.execute("""
local note
for _, line in ipairs(printed) do if line:find('raid:') or line:find('  raid:') then note = line end end
assert(Everloot.RaidCommand, 'the module registers its command')
assert(Everloot.RaidData.build == LAYER_BUILD, 'the buff list names its build')
assert(EverlootDB.toggles.raid == nil, 'no toggle is needed: nothing is recorded')
""")

# The report: who lacks what, per group.
lua.execute("""
printed = {}
SlashCmdList.EVERLOOT('raid')
local text = table.concat(printed, '\\n')
assert(text:find('7 members', 1, true), text)
assert(text:find('hand-checked and unconfirmed', 1, true), 'the report labels the list unconfirmed')
assert(not text:find('may be out of date', 1, true), 'same build, no warning: ' .. text)
local g1 = text:match('Group 1: ([^\\n]*)')
local g2 = text:match('Group 2: ([^\\n]*)')
assert(g1 and g1:find('missing', 1, true), g1)
assert(not g1:find('Battle Shout', 1, true), 'group 1 has Battle Shout: ' .. text)
assert(not g1:find('Mark of the Wild', 1, true) and not g1:find('Arcane Intellect', 1, true), 'group 1 has these')
assert(g1:find('Power Word: Fortitude', 1, true), 'group 1 lacks Fortitude')
assert(g2:find('Battle Shout', 1, true), 'group 2 lacks Battle Shout (Fay and Gus read nothing)')
assert(not g2:find('Power Word: Fortitude', 1, true) and not g2:find('Strength of Earth', 1, true), 'group 2 has these')
assert(text:find('1 member(s) could not be read', 1, true), 'Gus is out of range and is not counted as lacking')
""")

# Aura reading falls back to UnitAura on a client without C_UnitAuras.
lua = fresh(auras=CLASSIC_AURAS)
lua.execute("""
printed = {}
SlashCmdList.EVERLOOT('raid')
local text = table.concat(printed, '\\n')
assert(not text:match('Group 1: ([^\\n]*)'):find('Battle Shout', 1, true), 'UnitAura fallback reads names')
""")

# No aura API at all: members are unreadable, the command reports that and does not error.
lua = fresh(auras="")
lua.execute("""
printed = {}
SlashCmdList.EVERLOOT('raid')
local text = table.concat(printed, '\\n')
assert(text:find('nobody could be read', 1, true), text)
""")

# Spell ids work when a buff carries them (the generated table adds them later).
lua = fresh()
lua.execute("""
local data = { families = { { id = 'f', label = 'F' } }, buffs = { { family = 'f', id = 'f1', scope = 'raid', names = { 'Nope' }, spellIds = { 1001 } } } }
local groups = Everloot.Raid.Missing({
 { group = 1, readable = true, auras = { [1001] = true } },
 { group = 2, readable = true, auras = {} },
}, data)
assert(#groups[1].missing == 0 and groups[2].missing[1] == 'F', 'a spell id match counts')
""")

# A client on another build is told the list may be out of date.
lua = fresh("BUILD = { '1.60.1', '70500', 'Oct 9 2026', 11508 }")
lua.execute("""
printed = {}
SlashCmdList.EVERLOOT('raid')
assert(table.concat(printed, '\\n'):find('build 1.60.1.70500, so the list may be out of date', 1, true))
""")

# Cost: one pass reads each member's auras once, at most 40 per member.
lua = fresh()
lua.execute("""
calls = 0
SlashCmdList.EVERLOOT('raid')
assert(calls <= 7 * 41, 'at most 41 aura reads per member, got ' .. calls)
""")

# Not in a group.
lua = fresh("group.members = {}")
lua.execute("""
printed = {}
SlashCmdList.EVERLOOT('raid')
assert(table.concat(printed, '\\n'):find('not in a group', 1, true))
""")

# Party (not a raid): everyone is group 1, units are player and party1..4.
lua = fresh("group.inRaid = false; group.members = { group.members[1], group.members[2] }")
lua.execute("""
printed = {}
SlashCmdList.EVERLOOT('raid')
local text = table.concat(printed, '\\n')
assert(text:find('2 members', 1, true) and text:find('Group 1:', 1, true) and not text:find('Group 2:', 1, true), text)
""")

# The share code: the same format the site reads (web/src/lib/raid.ts).
lua = fresh()
lua.execute("""
local R = Everloot.Raid
local members = {}
for i = 1, 7 do
 local m = group.members[i]
 members[i] = { group = m.sub, class = m.class }
end
local code = R.Code(members, '1.60.1.70450')
-- warrior druid mage, two empty slots, shaman priest paladin hunter, one empty:
-- 10 90 70 00 00 60 50 20 30 00  ->  "1090700000605020 30"  (trailing "00" dropped)
assert(code == 'ELR1-10-1.60.1.70450-MTA5MDcwMDAwMDYwNTAyMDMw', code)
-- the site test encodes mage tree 3 and a warrior as "NzMwMDEw"; the addon writes tree 0, so mage is "70".
assert(R.Code({ { group = 1, class = 'MAGE' } }, '1.60.1.70450') == 'ELR1-10-1.60.1.70450-NzA', 'mage alone is 70')
assert(R.Code({}, '1.60.1.70450') == 'ELR1-10-1.60.1.70450-', 'an empty raid is a short code')
assert(R.Code(members, nil) == nil, 'no build, no code')
assert(R.Code(members, '70450') == nil, 'a malformed build is refused')

-- Size follows the highest group: group 3 needs 20 slots, group 5 needs 40.
local g3 = R.Code({ { group = 3, class = 'MAGE' } }, '1.60.1.70450')
assert(g3:find('^ELR1%-20%-'), g3)
local g5 = R.Code({ { group = 5, class = 'MAGE' } }, '1.60.1.70450')
assert(g5:find('^ELR1%-40%-'), g5)
-- A sixth player in one group does not spill into the next group's slots.
local six = {}
for i = 1, 6 do six[i] = { group = 1, class = 'MAGE' } end
local sixCode = R.Code(six, '1.60.1.70450')
assert(sixCode == R.Code({ six[1], six[2], six[3], six[4], six[5] }, '1.60.1.70450'), 'five slots per group')
-- An unknown class is an empty slot.
assert(R.Code({ { group = 1, class = 'DEATHKNIGHT' } }, '1.60.1.70450') == 'ELR1-10-1.60.1.70450-', 'unknown class is empty')

printed = {}
SlashCmdList.EVERLOOT('raid code')
local text = table.concat(printed, '\\n')
assert(text:find('Everloot raid code: ELR1-10-' .. LAYER_BUILD .. '-', 1, true), text)
""")

# --- The link window: a titled, bordered box with the link selected, a Ctrl+C hint and a close button ---
lua = fresh()
lua.execute("""
local Widget = {}
Widget.__index = function(self, key) return rawget(Widget, key) or function() end end
function Widget.SetText(self, t) self.text = t end
function Widget.GetText(self) return self.text end
function Widget.Show(self) self.shown = true end
function Widget.Hide(self) self.shown = false end
function Widget.SetBackdrop(self) self.backdropSet = true end
function Widget.HighlightText(self) self.highlighted = true end
function Widget.SetFocus(self) self.focused = true end
function Widget.SetScript(self, name, f) self.scripts[name] = f end
local function make(kind, name, template)
  local w = setmetatable({ kind = kind, name = name, template = template, scripts = {}, children = {} }, Widget)
  return w
end
function Widget.CreateFontString(self) local w = make('FontString'); table.insert(self.children, w); return w end
function Widget.CreateTexture(self) local w = make('Texture'); table.insert(self.children, w); return w end
UIParent = make('Frame', 'UIParent')
ChatFontNormal = {}
CreateFrame = function(kind, name, parent, template)
  local w = make(kind, name, template)
  w.parent = parent
  if parent and parent.children then table.insert(parent.children, w) end
  return w
end
local function find(frame, pred)
  for _, c in ipairs(frame.children) do if pred(c) then return c end end
end
local url = 'https://everloot.app/tools/raid#raid=ELR1-10-X-AB'
local R = Everloot.Raid
-- Without the Everloot window loaded the box still has its parts, plainly dressed.
Everloot.Window = nil
printed = {}
SlashCmdList.EVERLOOT('raid code')
local frame = R.frame
assert(frame and frame.shown, 'the window opens')
assert(frame.box.text:find('^https://everloot.app/tools/raid#raid=ELR1%-10%-'), 'the link is in the box: ' .. tostring(frame.box.text))
assert(frame.box.highlighted and frame.box.focused, 'the link is selected for Ctrl+C')
local title = find(frame, function(c) return c.kind == 'FontString' and c.text and c.text:find('Everloot') end)
assert(title, 'a title names what this is')
local hint = find(frame, function(c) return c.kind == 'FontString' and c.text and c.text:find('Ctrl+C', 1, true) end)
assert(hint, 'a Ctrl+C notice')
local close = find(frame, function(c) return c.kind == 'Button' end)
assert(close and close.text == 'Close' and close.scripts.OnClick, 'a close button')
close.scripts.OnClick(close)
assert(frame.shown == false, 'Close hides the window')
-- With the window's look loaded, the box wears it.
local dressed, headed = 0, 0
Everloot.Window = { Backdrop = function(f) dressed = dressed + 1 end, COLORS = { accent = { 1, 1, 1, 1 }, muted = { 1, 1, 1, 1 } },
  Text = function(parent) local w = parent:CreateFontString(); w.isWindowText = true; return w end }
R.frame = nil
SlashCmdList.EVERLOOT('raid code')
assert(dressed == 1 and R.frame.shown, 'the window look is applied')
assert(find(R.frame, function(c) return c.isWindowText end), 'its text helper is used')
Everloot.Window = nil
-- A frame call that is missing falls back to chat with the link.
CreateFrame = function() error('no frames') end
R.frame = nil
printed = {}
SlashCmdList.EVERLOOT('raid code')
assert(table.concat(printed, ' '):find('Everloot raid link: https://', 1, true), 'chat fallback')
""")
print("raid contract ok")
