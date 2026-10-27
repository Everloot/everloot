"""Exercise the native workspace through real Lua callbacks, without a game client."""
import json
import zipfile
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


def workspace(source):
    """A Lua state with the stubs and the workspace modules, each module's text from source(name)."""
    runtime = LuaRuntime()
    runtime.execute(STUBS)
    for file in ['plan', 'raid_data', 'raid', 'planner', 'minimap']:
        runtime.execute(source(file))
    return runtime


def this_addon(name):
    return (root / f'modules/{name}.lua').read_text(encoding='utf-8')


lua = workspace(this_addon)
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

# --- Website link -> Import -> Copy plan link -> website ---
# Import takes the set a link carries, with the order under that set's own key: order with plan, order2
# with plan2. The copied link is the very link the shared vectors give the site for that set (the site
# reads them in web/src/lib/talents/order-vectors.test.ts), so it opens the same set, code and order.
vectors = json.loads((root.parent / 'docs' / 'fixtures' / 'talent-order-v1.json').read_text(encoding='utf-8'))
link = {v['name']: v['link'] for v in vectors['links']['read']}
CODE = 'EL1-mage-1482-1.60.1.70450-OTAwMDE6Miw5MDAwMjoxOjEsOTAwMDQ6Mg'
CODE2 = 'EL1-mage-0-1.60.1.70450-MToxLDI6MQ'
FIRST = link['the first set copied alone, with its order']
SECOND = link['the second set copied alone, with its order']
FIRST_BARE = link['a link made before orders, with the first set']
SECOND_BARE = link['a link made before orders, with the second set alone']
site = workspace(this_addon)
site.execute("Everloot.Planner.Open('talents')")
round_trip = site.eval("""function(text)
  local f = Everloot.Planner.frame
  f.box:SetText(text)
  f.import.scripts.OnClick()
  local said = f.notice:GetText()
  f.export.scripts.OnClick()
  return EverlootDB.plan, EverlootDB.planOrder, EverlootDB.planSet, said, f.box:GetText()
end""")
NONE = 'Point order unavailable: none came with this plan'
cases = [
    # pasted, code kept, order kept, set kept, the notice says, copied back
    (FIRST, CODE, 'O1p-AABCC', None, 'Point order: planned in the talent calculator', FIRST),
    (SECOND, CODE2, 'O1g-AB', 2, 'Point order: provisional, made by a tool', SECOND),
    (link['both sets and both orders'], CODE, 'O1p-AABCC', None, 'Point order: planned', FIRST),
    (link["both sets and the second set's order"], CODE, None, None, NONE, FIRST_BARE),
    (link["an order whose set has no code is read as it is: the first set's order with the second set alone"], CODE2, None, 2, NONE, SECOND_BARE),
    (link["an order whose set has no code is read as it is: the second set's order with the first set alone"], CODE, None, None, NONE, FIRST_BARE),
    (link['a link made before orders, with both sets'], CODE, None, None, NONE, FIRST_BARE),
    (CODE, CODE, None, None, NONE, FIRST_BARE),
    (f'https://everloot.app/tools/talents/mage/b/-/{CODE2}', CODE2, None, 2, NONE, SECOND_BARE),
    (FIRST_BARE + '&order=O2p-AABCC', CODE, None, None, 'Point order unknown: a newer version of Everloot made it', FIRST_BARE),
    (FIRST_BARE + '&order=O1p-AABC', CODE, None, None, 'Point order unknown: it leaves out points the plan has', FIRST_BARE),
]
copied = {}
for pasted, code, order, kept_set, said, back in cases:
    got = round_trip(pasted)
    assert got[:3] == (code, order, kept_set), f'{pasted}: {got}'
    assert got[3].startswith('Plan loaded. ') and said in got[3], f'{pasted}: {got[3]}'
    assert got[4] == back, f'{pasted} copies back as {got[4]}'
    copied[pasted] = got[4]
# A bare code says nothing of its set: it goes back as a first set.
assert round_trip(CODE2)[4] == 'https://everloot.app/tools/talents/mage#plan=' + CODE2
# A failed import keeps the plan and the order it had.
round_trip(FIRST)
assert round_trip('EL1-mage-1482-1.60.1.70450-!!')[:3] == (CODE, 'O1p-AABCC', None)

# --- Addon 0.3.12 as published: the same links give it their ranks, never their order ---
with zipfile.ZipFile(root.parent / 'web' / 'public' / 'downloads' / 'Everloot-0.3.12.zip') as shipped:
    old = workspace(lambda name: shipped.read(f'Everloot/modules/{name}.lua').decode('utf-8'))
old.execute("Everloot.Planner.Open('talents')")
old_import = old.eval("""function(text)
  local f = Everloot.Planner.frame
  f.box:SetText(text)
  f.import.scripts.OnClick()
  return EverlootDB.plan, EverlootDB.planOrder
end""")
for pasted, code in [(copied[FIRST], CODE), (copied[SECOND], CODE2), (link['both sets and both orders'], CODE)]:
    assert old_import(pasted) == (code, None), f'0.3.12 reads {pasted} as {old_import(pasted)}'
# Its next point follows the code's item order: after one point in 90001 it names 90001 again, where the
# order O1p-ACBAC names 90004 (plan_contract.py).
assert old.eval("""(function()
  local P = Everloot.Plan
  local state = { order = { 90001, 90002, 90004 }, nodes = {
    [90001] = { ranks = 1, canBuy = true }, [90002] = { ranks = 0, canBuy = true }, [90004] = { ranks = 0, canBuy = true } } }
  return P.Evaluate(P.Decode('""" + CODE + """'), state).next.entry.nodeId
end)()""") == 90001
print('planner contract: PASS')
