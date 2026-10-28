"""Exercise the native workspace through real Lua callbacks, without a game client."""
import json
from pathlib import Path
from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]
STUBS = """
EverlootDB = {clientBuild='1.60.1.70532', toggles={}, records={}}
UIParent = {}; UISpecialFrames = {}; SlashCmdList = {}; Minimap = {}
frames = {}; print = function() end
local F = {}
F.__index = function(_, key) return F[key] or function() end end
function F:SetScript(key, fn) self.scripts[key] = fn end
function F:HookScript(key, fn) self.scripts[key] = fn end
function F:SetText(text) self.text = text end
function F:GetText() return self.text or '' end
function F:Show() self.shown=true; if self.scripts.OnShow then self.scripts.OnShow(self) end end
function F:Hide() self.shown=false; if self.scripts.OnHide then self.scripts.OnHide(self) end end
function F:IsShown() return self.shown end
function F:HighlightText() self.selected=true end
function F:SetFocus() self.focused=true end
function F:ClearFocus() self.focused=false end
function F:CreateFontString() return CreateFrame('FontString') end
function F:CreateTexture() return CreateFrame('Texture') end
CreateFrame = function(kind, name, parent)
 local f = setmetatable({kind=kind, scripts={}, parent=parent, shown=false}, F)
 frames[#frames+1]=f; if name then _G[name]=f end; return f
end
initializers = {}
Everloot = { RegisterModule=function(_, name, fn) initializers[name]=fn end, Talents={
 HasTraitApi=function() return true end,
 Player=function() return 'MAGE' end, SpecId=function() return 0 end, Groups=function() return {} end
}}
"""


def workspace():
    lua = LuaRuntime()
    lua.execute(STUBS)
    for file in ['plan', 'raid_data', 'raid', 'planner', 'minimap']:
        lua.execute((root / f'modules/{file}.lua').read_text(encoding='utf-8'))
    return lua


lua = workspace()
lua.execute("""
local W = Everloot.Planner
assert(W and not W.frame, 'workspace is built lazily')
W.Open('talents')
local f = W.frame
assert(f and f:IsShown() and W.tab == 'talents')
assert(f.body:GetText():find('No plan loaded', 1, true))
local count = #frames
W.Open('raid'); W.Open('talents')
assert(#frames == count, 'reuse the same window and controls')
f.box:SetText('EL1-mage-0-1.60.1.70532-MTox')
f.import.scripts.OnClick()
assert(EverlootDB.plan and not EverlootPlanFrame, 'import uses embedded mode, no second window')
assert(f.notice:GetText():find('loaded', 1, true))
f.export.scripts.OnClick()
assert(f.box:GetText():find('#plan=EL1-mage', 1, true) and f.box.selected)
f.import.scripts.OnClick()
assert(f.notice:GetText():find('loaded', 1, true), 'exported link can be imported')
f.tabs.raid.scripts.OnClick()
assert(W.tab == 'raid')
f.box:SetText('ELR1-10-1.60.1.70532-NzMwMDEw')
f.box.scripts.OnEnterPressed(f.box)
assert(EverlootDB.raidPlan)
assert(f.body:GetText():find('Group 1', 1, true))
local before = EverlootDB.raidPlan
f.box:SetText('damaged')
f.import.scripts.OnClick()
assert(EverlootDB.raidPlan == before and f.box:GetText() == 'damaged')
assert(f.notice:GetText():find('not an Everloot', 1, true))
f.clear.scripts.OnClick()
assert(not EverlootDB.raidPlan and EverlootDB.plan, 'clear affects only the current tab')
f.box.scripts.OnEscapePressed(f.box)
assert(not f:IsShown() and not f.box.focused)
local button = Everloot.Minimap.Button()
button.scripts.OnClick(button, 'LeftButton')
assert(f:IsShown(), 'minimap opens workspace')
local settings = 0
Everloot.Options = {Open=function() settings=settings+1 end}
button.scripts.OnClick(button, 'RightButton')
assert(settings == 1)
assert(UISpecialFrames[1] == 'EverlootPlannerFrame', 'Escape closes the workspace')
W.Open('talents')
f.box:SetText('https://everloot.app/tools/talents/mage/b/EL1-mage-0-1.60.1.70532-MTox')
W.Import()
assert(f.notice:GetText():find('loaded', 1, true), 'website preview links also import')
f.box:SetText('https://everloot.app/tools/talents/mage?saved=example#plan=EL1-mage-0-1.60.1.70532-MTox')
W.Import()
assert(f.notice:GetText():find('loaded', 1, true), 'saved build links import')
for _, link in ipairs({
 'https://everloot.app/tools/talents/mage#plan2=EL1-mage-0-1.60.1.70532-MTox',
 'https://everloot.app/tools/talents/mage/b/-/EL1-mage-0-1.60.1.70532-MTox'
}) do
 f.box:SetText(link); W.Import()
 assert(f.notice:GetText():find('loaded', 1, true), 'second-set-only links import')
end
f.box:SetText('https://everloot.app/tools/talents/mage/b/saved-short-link')
W.Import()
assert(f.notice:GetText():find('Copy for addon', 1, true), 'short links explain how to get a code')
f.box:SetText('  https://everloot.app/b/short-link  ')
W.Import()
assert(f.notice:GetText():find('Copy for addon', 1, true), 'trimmed short links get the same explanation')
Everloot.Talents.HasTraitApi = function() return false end
f.box:SetText('EL1-mage-0-1.60.1.70532-MTox')
W.Import()
assert(f.notice:GetText():find('unavailable', 1, true), 'unsupported clients get a clear explanation')
Everloot.Talents.HasTraitApi = function() return true end
EverlootDB.raidPlan = 'corrupted saved data'
W.Open('raid')
assert(f.body:GetText():find('Saved plan could not load', 1, true))
W.Open('talents')
local reads = 0
Everloot.Talents.Groups = function() reads=reads+1; return {} end
f:Hide()
f.scripts.OnEvent(f, 'PLAYER_TALENT_UPDATE')
assert(reads == 0, 'closed workspace does no talent reads')
W.Open('talents')
local before = reads
f.scripts.OnEvent(f, 'PLAYER_TALENT_UPDATE')
assert(reads > before, 'visible workspace updates its character comparison')
local pending = {}
C_Timer = {After=function(_, fn) pending[#pending+1] = fn end}
f.scripts.OnEvent(f, 'TRAIT_NODE_CHANGED')
f.scripts.OnEvent(f, 'ACTIVE_PLAYER_SPECIALIZATION_CHANGED')
assert(#pending == 1, 'event bursts coalesce into one refresh')
f:Hide()
before = reads
pending[1]()
assert(reads == before, 'a queued update does nothing after closing')
C_Timer = nil
""")
lua.execute((root / 'core.lua').read_text(encoding='utf-8'))
lua.execute("""
SlashCmdList.EVERLOOT('planner raid')
assert(Everloot.Planner.tab == 'raid')
SlashCmdList.EVERLOOT('planner talents')
assert(Everloot.Planner.tab == 'talents')
SlashCmdList.EVERLOOT('plannerraid')
assert(Everloot.Planner.tab == 'talents', 'command requires a word boundary')
Everloot.Planner.frame:Hide()
SlashCmdList.EVERLOOT('')
assert(Everloot.Planner.frame:IsShown(), 'bare command opens workspace')
PlayerSpellsFrame = CreateFrame('Frame')
initializers.plan()
Everloot.Planner.frame.box:SetText('EL1-mage-0-1.60.1.70532-MTox')
Everloot.Planner.Import()
PlayerSpellsFrame:Show()
assert(not EverlootPlanFrame or not EverlootPlanFrame:IsShown(), 'opening talents after workspace import does not open a second panel')
""")
lua.execute("Everloot.RegisterModule = function(_, name, fn) initializers[name]=fn end")
lua.execute((root / 'modules/plan.lua').read_text(encoding='utf-8'))
lua.execute("""
PlayerSpellsFrame:Hide()
initializers.plan()
PlayerSpellsFrame:Show()
assert(not EverlootPlanFrame or not EverlootPlanFrame:IsShown(), 'workspace preference survives a reload')
Everloot.Plan.Show()
assert(EverlootPlanFrame:IsShown() and not Everloot.Planner.frame:IsShown(), 'explicit legacy guide closes workspace')
Everloot.Planner.Open('talents')
assert(not EverlootPlanFrame:IsShown() and Everloot.Planner.frame:IsShown(), 'workspace replaces legacy guide')
""")

# --- Website links: Import loads one set with that set's own order, Copy plan link writes it back under
# the same keys, and the site reads it as that set. The site's reads are the shared vectors themselves. ---
VECTORS = json.loads((root.parent / 'docs' / 'fixtures' / 'talent-order-v1.json').read_text(encoding='utf-8'))
SITE = {v['link']: v for v in VECTORS['links']['read']}
PAGE = 'https://everloot.app/tools/talents/mage'
FIRST = next(v['first'] for v in VECTORS['links']['read'] if v['first'])
SECOND = next(v['second'] for v in VECTORS['links']['read'] if v['second'])
lua = workspace()
lua.execute("""
Everloot.Planner.Open('talents')
local f = Everloot.Planner.frame
assert(f.hint:GetText():find('then spend points yourself', 1, true), f.hint:GetText())
function roundTrip(text)
  Everloot.Plan.Clear()
  f.box:SetText(text)
  f.import.scripts.OnClick()
  local loaded, notice = EverlootDB.plan, f.notice:GetText()
  f.export.scripts.OnClick()
  return loaded, EverlootDB.planOrder, EverlootDB.planSet, notice, loaded and f.box:GetText() or nil, f.body:GetText()
end
-- How addon 0.3.12 reads a talent link: the code after #plan=, or after #plan2= when it comes first.
function oldReader(link)
  return link:match("^https?://[^/]+/tools/talents/%a+[^#]*#plan=([^&]+)") or link:match("^https?://[^/]+/tools/talents/%a+[^#]*#plan2=([^&]+)")
end
""")
round_trip, old_reader = lua.globals().roundTrip, lua.globals().oldReader


def site_reads(link):
    """What the site reads from a link the addon copied: the shared read vector for that exact link."""
    assert link in SITE, f'not a link the shared vectors pin: {link}'
    v = SITE[link]
    return v['first'], v['second'], v['firstOrder'], v['secondOrder']


ORIGIN = {'O1p': 'Spend order: planned by a player.',
          'O1g': 'Spend order: provisional, generated by a tool; not a recommendation or a record of play.'}
UNKNOWN = 'Spend order: unknown, so no point is named next.'
TWO_SETS = ' The link has two talent sets, so the first loaded; Copy for addon on the website copies the one you choose.'
for v in VECTORS['links']['read']:
    # The first set with its own order, else the second with its own; an order without its set's code is not used.
    code, order, key = (v['first'], v['firstOrder'], '') if v['first'] else (v['second'], v['secondOrder'], '2')
    plan, kept, number, notice, copied, body = round_trip(v['link'])
    if code is None:
        assert plan is None and 'Copy for addon' in notice, f"{v['name']}: {notice}"
        continue
    assert (plan, kept, number) == (code, order, 2 if key else None), f"{v['name']}: {(plan, kept, number)}"
    assert copied == f'{PAGE}#plan{key}={code}' + (f'&order{key}={order}' if order else ''), f"{v['name']}: {copied}"
    assert site_reads(copied) == ((None, code, None, order) if key else (code, None, order, None)), v['name']
    assert old_reader(copied) == code, f"addon 0.3.12 still reads the talents of {copied}, without the order"
    said = ORIGIN[order[:3]] if order else UNKNOWN
    assert notice == 'Plan loaded. ' + said + (TWO_SETS if v['first'] and v['second'] else ''), f"{v['name']}: {notice}"
    assert said in body, f"{v['name']}: {body}"

# An order rides only with its own set's code, even when it would fit the other set.
for link, key, code in [(f'{PAGE}#plan={FIRST}&order2=O1p-AABCC', '', FIRST), (f'{PAGE}#plan2={SECOND}&order=O1g-AB', '2', SECOND)]:
    plan, kept, number, notice, copied, body = round_trip(link)
    assert (plan, kept, number) == (code, None, 2 if key else None), f'{link}: {(plan, kept, number)}'
    assert notice == 'Plan loaded. ' + UNKNOWN and copied == f'{PAGE}#plan{key}={code}', f'{notice} / {copied}'

# A bare share code is the first set with no order, as before orders.
plan, kept, number, notice, copied, body = round_trip(FIRST)
assert (plan, kept, number, copied) == (FIRST, None, None, f'{PAGE}#plan={FIRST}'), copied
assert site_reads(copied) == (FIRST, None, None, None) and 'Spend order: unknown' in notice
# A link value ends where the site's does, so a bracket or full stop pasted after it is not part of the order.
plan, kept, number, notice, copied, body = round_trip(f'({PAGE}#plan={FIRST}&order=O1p-AABCC).')
assert (plan, kept, number, copied) == (FIRST, 'O1p-AABCC', None, f'{PAGE}#plan={FIRST}&order=O1p-AABCC'), copied

# An order the addon cannot read leaves the talents loaded, says why, and stays out of the copied link.
for link, reason in {
    f'{PAGE}#plan={FIRST}&order=O2p-AABCC': 'was made by a newer version of Everloot',
    f'{PAGE}#plan={FIRST}&order=O1p-AAB.CC': 'is damaged',
    f'{PAGE}#plan={FIRST}&order=O1p-AABC': 'leaves out points the plan has',
    f'{PAGE}#plan2={SECOND}&order2=O2g-AB': 'was made by a newer version of Everloot',
}.items():
    plan, kept, number, notice, copied, body = round_trip(link)
    key = '2' if '#plan2=' in link else ''
    assert (plan, kept, number) == (SECOND if key else FIRST, None, 2 if key else None), f'{link}: {(plan, kept, number)}'
    assert reason in notice and reason in body, f'{link}: {notice} / {body}'
    assert copied == f'{PAGE}#plan{key}={SECOND if key else FIRST}', f'an order that could not be read is left out: {copied}'

# A failed import keeps the plan already loaded, order and set included; a later import replaces all three.
lua.globals().SECOND_LINK = f'{PAGE}#plan2={SECOND}&order2=O1g-AB'
lua.globals().FIRST, lua.globals().SECOND = FIRST, SECOND
lua.execute("""
local f = Everloot.Planner.frame
f.box:SetText(SECOND_LINK); f.import.scripts.OnClick()
assert(EverlootDB.plan == SECOND and EverlootDB.planSet == 2 and EverlootDB.planOrder == 'O1g-AB')
f.box:SetText('https://everloot.app/tools/talents/mage#plan=damaged&order=O1p-AABCC'); f.import.scripts.OnClick()
assert(EverlootDB.plan == SECOND and EverlootDB.planSet == 2 and EverlootDB.planOrder == 'O1g-AB', 'a failed import changes nothing')
assert(f.notice:GetText():find('Copy for addon', 1, true), f.notice:GetText())
f.box:SetText('EL1-mage-0-1.60.1.70450-!!!'); f.import.scripts.OnClick()
assert(EverlootDB.plan == SECOND and EverlootDB.planSet == 2 and EverlootDB.planOrder == 'O1g-AB', 'nor does a damaged code')
f.box:SetText(FIRST); f.import.scripts.OnClick()
assert(EverlootDB.plan == FIRST and EverlootDB.planSet == nil and EverlootDB.planOrder == nil, 'no set or order left from the last link')
f.clear.scripts.OnClick()
f.export.scripts.OnClick()
assert(f.notice:GetText():find('Import a plan first', 1, true))
""")
print('planner contract: PASS')
