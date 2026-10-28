"""Run with: uv run --with lupa python addon/tests/plan_contract.py"""
import base64
import json
import re
import string
from pathlib import Path
from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\plan.lua" in toc, "plan module must be in the TOC"


def share_code(cls: str, spec: int, build: str, text: str) -> str:
    """The documented share code, built here without the addon's encoder."""
    payload = base64.urlsafe_b64encode(text.encode("ascii")).decode("ascii").rstrip("=")
    return f"EL1-{cls}-{spec}-{build}-{payload}"


# 90001 at rank 2, the choice node at its second entry, 90004 at rank 2. Items are listed by node id, as
# the site writes them; their order is not a spend order. The spend order is a token of its own.
PLAN_TEXT = "90001:2,90002:1:1,90004:2"
CODE = share_code("mage", 1482, "1.60.1.70450", PLAN_TEXT)
CODE2 = "EL1-mage-0-1.60.1.70450-MToxLDI6MQ"
VECTORS = json.loads((root.parent / "docs" / "fixtures" / "talent-order-v1.json").read_text(encoding="utf-8"))

STUBS = """
date = function() return '2026-10-17T00:00:00Z' end
time = function() return 123456 end
printed = {}
print = function(text) table.insert(printed, text) end
SlashCmdList = {}
-- Frames accept any call, remember text, and count Show/Hide, like the client's widgets for these purposes.
local function widget(name)
 local w = { name = name, shown = false, text = '', scripts = {} }
 return setmetatable(w, { __index = function(self, key)
  if not key:find('^[A-Z]') then return nil end
  if key == 'Show' then return function(s) s.shown = true end end
  if key == 'Hide' then return function(s) s.shown = false end end
  if key == 'IsShown' then return function(s) return s.shown end end
  if key == 'SetText' then return function(s, t) s.text = t end end
  if key == 'GetText' then return function(s) return s.text end end
  if key == 'SetAllPoints' then return function(s, target) s.target = target end end
  if key == 'CreateFontString' or key == 'CreateTexture' then return function() return widget('child') end end
  if key == 'SetColorTexture' then return function(s, r, g, b) s.color = { r, g, b } end end
  if key == 'SetParent' then return function(s, p) s.parent = p end end
  if key == 'EnableMouse' then return function(s, on) s.mouse = on end end
  if key == 'RegisterEvent' then return function(s, event) end end
  if key == 'SetScript' then return function(s, kind, f) s.scripts[kind] = f end end
  if key == 'HookScript' then return function(s, kind, f) end end
  return function() end
 end })
end
frames = {}
local first = true
CreateFrame = function(kind, name)
 -- The first frame is core's event frame: it keeps the script and hooks the tests fire.
 if first then
  first = false
  return {
   RegisterEvent=function() end,
   SetScript=function(self, _, f) self.onEvent=f end,
   HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
  }
 end
 local w = widget(name); table.insert(frames, w); return w
end
UIParent = widget('UIParent')
GetBuildInfo = function() return '1.60.1', '70450', 'Oct 1 2026', 11508 end
UnitClass = function() return 'Mage', CLASS, 8 end
UnitLevel = function() return 45 end
CLASS = 'MAGE'
SPEC = 1482
PlayerUtil = { GetCurrentSpecID = function() return SPEC end }
C_SpecializationInfo = {
 GetNumSpecGroups = function() return 1 end,
 GetActiveSpecGroup = function() return 1 end,
 GetCombatConfigIDForSpecGroup = function() return 10 end,
}
calls = { import = 0, purchase = 0, select = 0, click = 0, commit = 0, view = 0 }
-- ranksPurchased and canPurchaseRank change as the "player" spends points.
NODES = {
 [90001] = { ranksPurchased = 1, maxRanks = 3, canPurchaseRank = true, entryIDs = { 1 } },
 [90002] = { ranksPurchased = 0, maxRanks = 1, canPurchaseRank = true, entryIDs = { 501, 502 } },
 [90003] = { ranksPurchased = 0, maxRanks = 1, canPurchaseRank = false, entryIDs = { 90001 } },
 [90004] = { ranksPurchased = 0, maxRanks = 2, canPurchaseRank = false, entryIDs = { 90001 } },
}
C_Traits = {
 GetConfigInfo = function(id) return { ID = id, treeIDs = { 786 } } end,
 GetTreeNodes = function() return { 90001, 90002, 90003, 90004 } end,
 GetNodeInfo = function(config, node) local copy = { ID = node }; for k, v in pairs(NODES[node]) do copy[k] = v end; return copy end,
 GetEntryInfo = function(config, entry) return { definitionID = entry } end,
 GetDefinitionInfo = function(def) return { spellID = def } end,
 PurchaseRank = function() calls.purchase = calls.purchase + 1 end,
 SetSelection = function() calls.select = calls.select + 1 end,
 CommitConfig = function() calls.commit = calls.commit + 1 end,
}
C_ClassTalents = {
 GetActiveConfigID = function() return 10 end,
 ImportLoadout = function() calls.import = calls.import + 1 end,
 ViewLoadout = function() calls.view = calls.view + 1 end,
 CommitConfig = function() calls.commit = calls.commit + 1 end,
}
SPELLS = { [1] = 'Arcane Power', [501] = 'Ice Lance', [502] = 'Frost Nova', [90001] = 'x' }
C_Spell = { GetSpellName = function(id) return SPELLS[id] end }
"""


def fresh(extra: str = "", saved: str = "nil"):
    lua = LuaRuntime()
    lua.execute(STUBS)
    lua.execute(extra)
    for file in ["core.lua", "modules/talents.lua", "modules/selftest.lua", "modules/plan.lua"]:
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute(f"EverlootDB = {saved}")
    lua.execute("""
Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot')
function event(name) for _, hook in ipairs(Everloot.frame.hooks or {}) do hook(nil, name) end end
function panel() for _, f in ipairs(frames) do if f.name == 'EverlootPlanFrame' then return f end end end
""")
    return lua


# The documented example is the one this test checks.
for doc in [root / "README.md", root.parent / "docs" / "2026-10-17-talent-share-code.md"]:
    assert CODE in doc.read_text(encoding="utf-8"), f"{doc.name} must show the tested example code"

# --- The share code: our encoder writes exactly what the documented format says ---
lua = fresh()
lua.execute(f"""
local P = Everloot.Plan
local plan = P.Decode('{CODE}')
assert(plan and plan.version == 1 and plan.class == 'MAGE' and plan.spec == 1482 and plan.build == '1.60.1.70450')
assert(#plan.entries == 3, 'three entries')
assert(plan.entries[1].nodeId == 90001 and plan.entries[1].rank == 2 and plan.entries[1].choice == nil)
assert(plan.entries[2].nodeId == 90002 and plan.entries[2].rank == 1 and plan.entries[2].choice == 1, 'the choice index')
assert(P.Encode(plan) == '{CODE}', 'encode matches an independent base64url encoder: ' .. P.Encode(plan))
assert(P.Decode('  {CODE}  ') ~= nil, 'surrounding spaces are ignored')
""")
# Payload lengths of every remainder class round-trip (1, 2 and 3 bytes left over).
for text in ["1:1", "12:1", "123:1", "1234:1", "90001:50:3,2:1"]:
    code = share_code("priest", 0, "1.60.2.70611", text)
    lua.execute(f"""
local plan = Everloot.Plan.Decode('{code}')
assert(plan and plan.spec == 0 and plan.class == 'PRIEST' and Everloot.Plan.Encode(plan) == '{code}', '{text}')
""")

# --- Bad codes say why and never raise ---
bad = {
    "": "not an Everloot",
    "hello": "not an Everloot",
    "EL2-mage-1482-1.60.1.70450-" + CODE.rsplit("-", 1)[1]: "version 2",
    "EL1-mage-1482-1.60.1.70450-!!!!": "not an Everloot",
    share_code("mage", 1, "1.60.1.70450", "90001:0"): "damaged",
    share_code("mage", 1, "1.60.1.70450", "90001:2:9"): "damaged",
    share_code("mage", 1, "1.60.1.70450", "abc"): "damaged",
    "EL1-mage-1-1.60.1.70450-A": "damaged",
    "EL1-mage-1-1.60.1.70450-": "no talents",
    share_code("mage", 1, "1.60.1.70450", "90001:1,90002:1,90001:2"): "twice",
    share_code("mage", 1, "1", "90001:1"): "not an Everloot",
    share_code("mage", 1, "1..2", "90001:1"): "not an Everloot",
    share_code("mage", 1, "1.2.", "90001:1"): "not an Everloot",
}
for code, reason in bad.items():
    lua.execute(f"""
local plan, why = Everloot.Plan.Decode('{code}')
assert(plan == nil and string.find(why, '{reason}', 1, true), '{code}: ' .. tostring(why))
""")
lua.execute(f"assert(Everloot.Plan.Decode('{CODE}==') ~= nil, 'trailing padding is ignored')")
lua.execute("assert(Everloot.Plan.Decode(nil) == nil and Everloot.Plan.Decode(42) == nil)")

# --- Spend order token: the shared vectors every reader of the token passes ---
lua.execute("""
-- A plan from the vectors' ranks, { {node, rank, choice?}, ... }, rank 0 included as the vectors list it.
function planOf(ranks)
  local plan = { entries = {} }
  for i, r in ipairs(ranks) do plan.entries[i] = { nodeId = r[1], rank = r[2], choice = r[3] } end
  return plan
end
-- Each token read against the same ranks: 'origin:node node ...', or the error.
function readAll(tokens, ranks)
  local plan, out = planOf(ranks), {}
  for i = 1, #tokens do
    local order, why = Everloot.Plan.DecodeOrder(tokens[i], plan)
    out[i] = order and (order.origin .. ':' .. table.concat(order.sequence, ' ')) or why
  end
  return table.concat(out, ',')
end
""")


def read_orders(tokens, ranks):
    """The reader's answer for each token (str, or bytes taken as they are) against one plan's ranks."""
    out = lua.globals().readAll(lua.table_from(tokens), lua.table_from([lua.table_from(r) for r in ranks]))
    return out.split(",")


def known(origin, order):
    return origin + ":" + " ".join(map(str, order))


for v in VECTORS["decode"]:
    want = v["error"] if "error" in v else known(v["origin"], v["order"])
    assert read_orders([v["token"]], v["ranks"]) == [want], f'{v["name"]}: {read_orders([v["token"]], v["ranks"])}'
# A token the site writes reads back as the order and origin it was written for. (The addon writes no
# token of its own, so the vectors that expect none are the site's to pass.)
for v in VECTORS["encode"]:
    if v["token"] is not None:
        assert read_orders([v["token"]], v["ranks"]) == [known(v["origin"], v["order"])], v["name"]
# A token both naming an extra point and short of points is extra-points, the format's earlier error.
assert read_orders(["O1p-AAA", "O1p-E", "O1p-CCC"], [[90001, 2], [90002, 1, 1], [90004, 2]]) == ["extra-points"] * 3
lua.execute("""
local order = Everloot.Plan.DecodeOrder(' O1g-AB\\r\\n', planOf({ { 1, 1 }, { 2, 1 } }))
assert(order.token == 'O1g-AB', 'the token is kept whole, without the whitespace around it: ' .. tostring(order.token))
local none, why = Everloot.Plan.DecodeOrder(nil, planOf({ { 1, 1 } }))
assert(none == nil and why == 'malformed', 'no token at all reads as damaged, and never raises')
""")

# Whitespace around a token is exactly the code points the format doc lists, matched as UTF-8 at either
# end, and nothing else: every other BMP code point, and a few beyond it, damages the token.
DOC = (root.parent / "docs" / "2026-10-17-talent-share-code.md").read_text(encoding="utf-8")
listed = DOC.split("Whitespace means exactly the code points", 1)[1].split("A reader in another language", 1)[0]
SPACES = set()
for start, end in re.findall(r"U\+([0-9A-F]{4})(?: to U\+([0-9A-F]{4}))?", listed):
    SPACES.update(range(int(start, 16), int(end or start, 16) + 1))
assert len(SPACES) == 25, sorted(f"U+{p:04X}" for p in SPACES)
B64URL = string.ascii_uppercase + string.ascii_lowercase + string.digits + "-_"
TWO = [[9, 1], [10, 1]]
CHARS = [chr(p) for p in [*range(0xD800), *range(0xE000, 0x10000), 0x10000, 0x1F600, 0xE0020, 0x10FFFF]]
for c, before, after in zip(CHARS, read_orders([c + "O1p-AB" for c in CHARS], TWO), read_orders(["O1p-AB" + c for c in CHARS], TWO)):
    if ord(c) in SPACES:
        assert before == after == "planned:9 10", f"U+{ord(c):04X} is whitespace: {before}, {after}"
    else:
        assert before == "malformed", f"U+{ord(c):04X} before a token is not whitespace: {before}"
        assert after == ("extra-points" if c in B64URL else "malformed"), f"U+{ord(c):04X} after a token is not whitespace: {after}"
# Named here because a reader's own idea of whitespace tends to include them: NEXT LINE, ZERO WIDTH SPACE,
# MONGOLIAN VOWEL SEPARATOR and WORD JOINER are not in the list, and neither is a lone Latin-1 byte.
for p in [0x85, 0x200B, 0x180E, 0x2060]:
    assert read_orders([chr(p) + "O1p-AB", "O1p-AB" + chr(p)], TWO) == ["malformed", "malformed"], f"U+{p:04X}"
for raw in [b"\x85", b"\xa0"]:
    assert read_orders([raw + b"O1p-AB", b"O1p-AB" + raw], TWO) == ["malformed", "malformed"], raw

# Links: each of the four keys read as it is, as the site reads them; one set written back under its own keys.
read_link = lua.eval("function(link) local r = Everloot.Plan.ReadLink(link) return r.first, r.second, r.firstOrder, r.secondOrder end")
for v in VECTORS["links"]["read"]:
    assert read_link(v["link"]) == (v["first"], v["second"], v["firstOrder"], v["secondOrder"]), v["name"]
assert read_link(f"https://everloot.app/tools/talents/mage#plan={CODE}&order=O1p-AABCC).") == (CODE, None, "O1p-AABCC", None), "a value stops where the site's does"
fragment = lua.eval("Everloot.Plan.Fragment")
for v in VECTORS["links"]["write"]:
    if (v["first"] is None) == (v["second"] is None):
        continue  # two sets, or none: the addon's link carries the one set it loaded
    code, order, number = (v["first"], v["firstOrder"], 1) if v["first"] else (v["second"], v["secondOrder"], 2)
    assert fragment(code, order, number) == v["fragment"], f'{v["name"]}: {fragment(code, order, number)}'

# --- Comparing a plan with the client: a next point comes only from a known spend order ---
lua.execute(f"""
local P, T = Everloot.Plan, Everloot.Talents
local plan = P.Decode('{CODE}')
local function state(nodes)
  local s = {{ order = {{ 90001, 90002, 90003, 90004 }}, nodes = {{}} }}
  for id, n in pairs(nodes) do s.nodes[id] = n end
  return s
end
local function node(ranks, canBuy, choice) return {{ ranks = ranks, max = 3, canBuy = canBuy, choice = choice }} end
local function ids(points) local out = {{}}; for i, p in ipairs(points) do out[i] = p.entry.nodeId end; return table.concat(out, ' ') end
local base = {{ [90001] = node(1, true), [90002] = node(0, true), [90003] = node(0, false), [90004] = node(0, false) }}

-- Without an order no point is next: item order and node ids are not a spend order.
local r = P.Evaluate(plan, state(base))
assert(r.total == 5 and r.done == 1 and #r.mismatches == 0, 'one of five points placed')
assert(r.next == nil and r.order == nil and r.missing == 3, 'no order, no next point')
assert(ids(r.candidates) == '90001 90002' and #r.unsure == 0, 'the missing points the game lets you buy now, none ranked first: ' .. ids(r.candidates))

-- With an order: the first point it lists that is not spent yet.
plan.order = P.DecodeOrder('O1p-AABCC', plan)
r = P.Evaluate(plan, state(base))
assert(r.order == 'planned' and r.next.entry.nodeId == 90001 and r.next.blocked == false, 'next point follows the order')
assert(#r.candidates == 0, 'an order names one next point, not a list')
base[90001] = node(2, true)
r = P.Evaluate(plan, state(base))
assert(r.next.entry.nodeId == 90002, 'a finished node is skipped')
base[90002] = node(0, false)
base[90004] = node(0, true)
r = P.Evaluate(plan, state(base))
assert(r.next.entry.nodeId == 90002 and r.next.blocked == true, 'a gated point stays next, marked blocked: the order is not reshuffled')

-- Interleaved, 90001 90004 90001 90002 90004: the order decides, where node ids would say 90001.
base = {{ [90001] = node(1, true), [90002] = node(0, true), [90003] = node(0, false), [90004] = node(0, false) }}
plan.order = P.DecodeOrder('O1p-ACABC', plan)
r = P.Evaluate(plan, state(base))
assert(r.next.entry.nodeId == 90004 and r.next.blocked == true, 'the order puts 90004 before the second point in 90001')
base[90004] = node(1, true)
r = P.Evaluate(plan, state(base))
assert(r.next.entry.nodeId == 90001 and r.next.blocked == false, 'then the second point in 90001')
base[90001] = node(2, true)
r = P.Evaluate(plan, state(base))
assert(r.next.entry.nodeId == 90002, 'then 90002, ahead of the last point in 90004')

-- A generated order is followed too, and is reported as provisional.
plan.order = P.DecodeOrder('O1g-AABCC', plan)
r = P.Evaluate(plan, state(base))
assert(r.order == 'provisional' and r.next.entry.nodeId == 90002)

-- Without an order, a point the game says nothing about is listed apart, never as one you can buy.
plan.order = nil
base[90002] = node(0, nil)
r = P.Evaluate(plan, state(base))
assert(ids(r.candidates) == '90004' and ids(r.unsure) == '90002' and r.missing == 2, ids(r.candidates) .. ' / ' .. ids(r.unsure))
base[90002] = node(0, false)
base[90004] = node(1, false)
r = P.Evaluate(plan, state(base))
assert(#r.candidates == 0 and #r.unsure == 0 and r.missing == 2 and r.next == nil, 'nothing can be bought now')
base[90004] = node(0, false)

base[90003] = node(1, false)          -- spent outside the plan
base[90001] = node(3, true)           -- more than planned
r = P.Evaluate(plan, state(base))
local kinds = {{}}
for _, m in ipairs(r.mismatches) do kinds[m.nodeId] = m.kind .. ':' .. tostring(m.have) .. '/' .. tostring(m.want) end
assert(kinds[90001] == 'extra:3/2' and kinds[90003] == 'extra:1/0', 'extra points are mismatches')

base[90001] = node(2, true); base[90003] = node(0, false)
base[90002] = node(1, false, 0)       -- chose the first entry, the plan says the second
r = P.Evaluate(plan, state(base))
assert(#r.mismatches == 1 and r.mismatches[1].kind == 'choice' and r.mismatches[1].have == 0 and r.mismatches[1].want == 1, 'wrong choice')

base[90002] = node(1, false, 1); base[90004] = node(2, false)
r = P.Evaluate(plan, state(base))
assert(r.done == 5 and r.next == nil and r.missing == 0 and #r.mismatches == 0, 'a finished plan has no next point')
plan.order = P.DecodeOrder('O1p-AABCC', plan)
r = P.Evaluate(plan, state(base))
assert(r.order == 'planned' and r.next == nil and r.missing == 0, 'nor with its order')

local ghost = P.Decode('{share_code("mage", 0, "1.59.0.1", "99999:1")}')
r = P.Evaluate(ghost, state(base))
assert(r.mismatches[1].kind == 'unknown' and r.mismatches[1].nodeId == 99999, 'a node the tree does not have')

-- An order naming a node this tree does not have no longer fits: it is not followed, and the points
-- that can be bought are listed as for a plan without one.
ghost = P.Decode('{share_code("mage", 0, "1.59.0.1", "90001:2,99999:1")}')
ghost.order = P.DecodeOrder('O1p-ABA', ghost)
base[90001] = node(1, true)
r = P.Evaluate(ghost, state(base))
assert(ghost.order and r.unplaced == true and r.order == nil and r.next == nil, 'the order is not followed')
assert(ids(r.candidates) == '90001', 'the points you can buy are listed instead: ' .. ids(r.candidates))
""")

# --- /everloot plan: loads, shows, remembers, and never acts ---
lua = fresh()
lua.execute(f"""
SlashCmdList.EVERLOOT('plan {CODE}')
assert(EverlootDB.plan == '{CODE}', 'the plan is kept in SavedVariables, case intact')
assert(EverlootDB.planOrder == nil and EverlootDB.planSet == nil, 'a bare code brings no order')
local p = panel()
assert(p and p.shown, 'the panel opens')
assert(string.find(p.body.text, 'MAGE plan, made on build 1.60.1.70450', 1, true), p.body.text)
assert(string.find(p.body.text, '1 of 5 planned points match', 1, true), p.body.text)
assert(string.find(p.body.text, 'Spend order: unknown, so no point is named next.', 1, true), p.body.text)
assert(not string.find(p.body.text, 'Next point', 1, true), 'no order, no next point: ' .. p.body.text)
assert(string.find(p.body.text, 'You can add any of these now: Arcane Power (rank 2 of 2), Frost Nova (rank 1 of 1)', 1, true), p.body.text)
assert(not string.find(p.body.text, 'node ids may have moved', 1, true), 'same build, no warning')
""")
lua.execute("""
NODES[90001].ranksPurchased = 2
event('TRAIT_CONFIG_UPDATED')
local p = panel()
assert(string.find(p.body.text, '2 of 5 planned points match', 1, true), 'the panel follows spent points: ' .. p.body.text)
assert(string.find(p.body.text, 'You can add any of these now: Frost Nova (rank 1 of 1)', 1, true), 'the choice node shows the planned option: ' .. p.body.text)
NODES[90002].canPurchaseRank = false
event('TRAIT_CONFIG_UPDATED')
assert(string.find(p.body.text, 'None of the points the plan still needs can be added right now', 1, true), p.body.text)
NODES[90002].canPurchaseRank = nil
event('TRAIT_CONFIG_UPDATED')
assert(string.find(p.body.text, 'The game does not say whether you can add these now: Frost Nova (rank 1 of 1)', 1, true), p.body.text)
assert(not string.find(p.body.text, 'None of the points', 1, true), 'unknown is not the same as unavailable: ' .. p.body.text)
NODES[90002].canPurchaseRank = true
NODES[90003].ranksPurchased = 1
event('TRAIT_CONFIG_UPDATED')
assert(string.find(p.body.text, 'Differences from the plan (1):', 1, true) and string.find(p.body.text, 'you have 1, the plan has 0', 1, true), p.body.text)
assert(calls.purchase == 0 and calls.select == 0 and calls.import == 0 and calls.commit == 0 and calls.view == 0, 'the plan never spends, selects or imports')
""")
# Survives a reload; /everloot plan clear removes it.
lua.execute(f"""
Everloot.frame.hooks = nil; Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
assert(EverlootDB.plan == '{CODE}')
SlashCmdList.EVERLOOT('plan hide'); assert(not panel().shown)
SlashCmdList.EVERLOOT('plan')
assert(panel().shown and string.find(panel().body.text, 'MAGE plan', 1, true), 'a reload remembers the plan')
SlashCmdList.EVERLOOT('plan clear')
assert(EverlootDB.plan == nil and string.find(panel().body.text, 'No plan loaded', 1, true))
""")

# --- A plan with its spend order: the order names the next point, and the token is kept whole ---
lua = fresh()
lua.execute(f"""
local P = Everloot.Plan
assert(P.Load('{CODE}', nil, 'O1p-ABACC') == true)
assert(EverlootDB.plan == '{CODE}' and EverlootDB.planOrder == 'O1p-ABACC' and EverlootDB.planSet == nil, tostring(EverlootDB.planOrder))
local p = panel()
assert(string.find(p.body.text, 'Spend order: planned by a player.', 1, true), p.body.text)
assert(string.find(p.body.text, 'Next point: Frost Nova (rank 1 of 1)', 1, true), 'the order puts 90002 before the second point in 90001: ' .. p.body.text)
assert(not string.find(p.body.text, 'You can add any of these now', 1, true), 'an order names one point, not a list')
NODES[90002].ranksPurchased = 1
event('TRAIT_CONFIG_UPDATED')
assert(string.find(p.body.text, 'Next point: Arcane Power (rank 2 of 2)', 1, true), p.body.text)
NODES[90001].ranksPurchased = 2
event('TRAIT_CONFIG_UPDATED')
assert(string.find(p.body.text, 'Next point: x (rank 1 of 2) - not available yet (a gate or no point to spend)', 1, true), 'a gated next point says so: ' .. p.body.text)
NODES[90004].canPurchaseRank = nil
event('TRAIT_CONFIG_UPDATED')
assert(string.find(p.body.text, 'Next point: x (rank 1 of 2) - the game does not say whether it can be bought now', 1, true), p.body.text)
NODES[90004].canPurchaseRank = false
assert(P.Link() == 'https://everloot.app/tools/talents/mage#plan={CODE}&order=O1p-ABACC', 'Copy plan link carries the order: ' .. tostring(P.Link()))
EverlootDB.planOrder = 'O1p-AAB'
assert(P.Link() == 'https://everloot.app/tools/talents/mage#plan={CODE}', 'the link checks the saved token, and leaves out one that does not fit')
EverlootDB.planOrder = 'O1p-ABACC'

-- A generated order is labelled wherever its next point shows.
assert(P.Load('{CODE}', nil, ' O1g-AABCC\\n', 2) == true)
assert(EverlootDB.planOrder == 'O1g-AABCC' and EverlootDB.planSet == 2, 'the validated token, trimmed, and its set')
assert(string.find(p.body.text, 'Spend order: provisional, generated by a tool; not a recommendation or a record of play.', 1, true), p.body.text)
assert(string.find(p.body.text, 'Next point (provisional order): x (rank 1 of 2)', 1, true), p.body.text)
assert(P.Link() == 'https://everloot.app/tools/talents/mage#plan2={CODE}&order2=O1g-AABCC', 'the second set keeps its own keys: ' .. tostring(P.Link()))

-- A later code without an order leaves no order behind; clearing forgets all of it.
assert(P.Load('{CODE}', nil, nil))
assert(EverlootDB.planOrder == nil and EverlootDB.planSet == nil and string.find(p.body.text, 'Spend order: unknown', 1, true))
assert(P.Link() == 'https://everloot.app/tools/talents/mage#plan={CODE}', 'no order, none in the link: ' .. tostring(P.Link()))
assert(P.Load('{CODE}', nil, 'O1p-ABACC', 2))
SlashCmdList.EVERLOOT('plan clear')
assert(EverlootDB.plan == nil and EverlootDB.planOrder == nil and EverlootDB.planSet == nil and P.Link() == nil)
assert(calls.purchase == 0 and calls.select == 0 and calls.import == 0 and calls.commit == 0 and calls.view == 0, 'an order never spends either')
""")

# An order that does not fit leaves the talents loaded and says why; nothing of it is kept or linked.
ORDER_PROBLEMS = {
    "O2p-AABCC": "was made by a newer version of Everloot",
    "O1p-AA BCC": "is damaged",
    "\u200bO1p-AABCC": "is damaged",
    "O1x-AABCC": "is of a kind this addon does not read",
    "O1p-" + "A" * 65: "is for more than 64 points, the most an order carries",
    "O1p-AABCCC": "lists points the plan does not have",
    "O1p-AABC": "leaves out points the plan has",
}
for token, reason in ORDER_PROBLEMS.items():
    lua = fresh()
    lua.globals().TOKEN = token
    lua.execute(f"""
local P = Everloot.Plan
assert(P.Load('{CODE}', nil, TOKEN) == true, 'the talents load whatever the order')
assert(EverlootDB.plan == '{CODE}' and EverlootDB.planOrder == nil, 'the order is not kept')
assert(string.find(table.concat(printed, '\\n'), "Everloot: the plan's spend order {reason}, so the order is unknown. The talents still loaded.", 1, true), table.concat(printed, '\\n'))
local text = panel().body.text
assert(string.find(text, 'Spend order: unknown, so no point is named next. The order that came with this plan {reason}.', 1, true), text)
assert(not string.find(text, 'Next point', 1, true) and string.find(text, 'You can add any of these now', 1, true), text)
assert(P.Link() == 'https://everloot.app/tools/talents/mage#plan={CODE}', tostring(P.Link()))
""")

# A reload reads the order back from SavedVariables. One that no longer fits is dropped with the reason,
# and a set other than 2 is the first.
lua = fresh(saved=f"{{ plan = '{CODE}', planOrder = 'O1g-ABACC', planSet = 2 }}")
lua.execute(f"""
SlashCmdList.EVERLOOT('plan')
assert(string.find(panel().body.text, 'Next point (provisional order): Frost Nova (rank 1 of 1)', 1, true), panel().body.text)
assert(Everloot.Plan.Link() == 'https://everloot.app/tools/talents/mage#plan2={CODE}&order2=O1g-ABACC')
""")
lua = fresh(saved=f"{{ plan = '{CODE}', planOrder = 'O1p-AAB', planSet = 7 }}")
lua.execute(f"""
assert(EverlootDB.plan == '{CODE}' and EverlootDB.planOrder == nil and EverlootDB.planSet == nil)
SlashCmdList.EVERLOOT('plan')
assert(string.find(panel().body.text, 'The order that came with this plan leaves out points the plan has.', 1, true), panel().body.text)
assert(Everloot.Plan.Link() == 'https://everloot.app/tools/talents/mage#plan={CODE}')
""")
lua = fresh(saved="{ plan = 'EL1-mage-damaged', planOrder = 'O1p-AABCC', planSet = 2 }")
lua.execute("assert(EverlootDB.plan == nil and EverlootDB.planOrder == nil and EverlootDB.planSet == nil, 'a damaged code takes its order with it')")

# A different build warns; a different class and a bad code are refused.
lua = fresh("GetBuildInfo = function() return '1.60.2', '70611', 'x', 1 end")
lua.execute(f"""
SlashCmdList.EVERLOOT('plan {CODE}')
assert(string.find(panel().body.text, 'You are on build 1.60.2.70611: node ids may have moved', 1, true), panel().body.text)
""")
lua = fresh("CLASS = 'PRIEST'")
lua.execute(f"""
SlashCmdList.EVERLOOT('plan {CODE}')
assert(EverlootDB.plan == nil and panel() == nil, 'another class is refused')
assert(string.find(table.concat(printed, '\\n'), 'that plan is for MAGE and you are playing PRIEST', 1, true))
SlashCmdList.EVERLOOT('plan nonsense')
assert(string.find(table.concat(printed, '\\n'), 'not an Everloot share code', 1, true))
SlashCmdList.EVERLOOT('planet')
""")

# The paste box loads the code it is given.
lua = fresh()
lua.execute(f"""
SlashCmdList.EVERLOOT('plan')
local p = panel()
local box
for _, f in ipairs(frames) do if f.scripts.OnEnterPressed then box = f end end
assert(box, 'the panel has a paste box')
box.text = '{CODE}'
box.scripts.OnEnterPressed(box)
assert(EverlootDB.plan == '{CODE}' and box.text == '', 'Enter in the paste box loads the code and clears it')
""")

# --- Highlights sit on Blizzard's buttons without taking clicks ---
lua = fresh("""
BUTTONS = { [90001] = { name = 'b1' }, [90003] = { name = 'b3' } }
PlayerSpellsFrame = {
 IsShown = function() return true end,
 HookScript = function(self, kind, f) self[kind] = f end,
 TalentsFrame = { IsShown = function() return true end, GetTalentButtonByNodeID = function(self, id) return BUTTONS[id] end },
}
""")
lua.execute(f"""
NODES[90003].ranksPurchased = 1
SlashCmdList.EVERLOOT('plan {CODE}')
local shown = {{}}
for _, f in ipairs(frames) do if f.target and f.shown then shown[f.target.name] = true end end
assert(not shown.b1 and shown.b3, 'without an order no talent is outlined as next; the extra point is still flagged')
Everloot.Plan.Load('{CODE}', nil, 'O1p-AABCC')
local marks = {{}}
for _, f in ipairs(frames) do if f.target then marks[f.target.name] = f end end
assert(marks.b1 and marks.b1.shown and marks.b1.mouse == false, 'the next point is outlined, click-through')
assert(marks.b3 and marks.b3.shown and marks.b3.mouse == false, 'the extra point is flagged, click-through')
for _, m in pairs(marks) do
 assert(m.mouse == false, 'every overlay has mouse disabled')
 assert(m.parent == m.target, 'each overlay is a child of its talent button')
end
assert(PlayerSpellsFrame.OnShow and PlayerSpellsFrame.OnHide, 'the plan follows the talent window')
-- Closing the talent window takes the overlays off.
PlayerSpellsFrame.OnHide()
for _, m in pairs(marks) do assert(not m.shown, 'overlays are hidden with the talent window') end
-- Opening it brings the plan back, unless the player closed the panel.
panel().shown = false
PlayerSpellsFrame.OnShow()
assert(panel().shown, 'the plan shows with the talent window')
SlashCmdList.EVERLOOT('plan hide')
PlayerSpellsFrame.OnShow()
assert(not panel().shown, 'plan hide stays hidden when the talent window opens')
panel().shown = true
panel().scripts.OnHide(panel())
panel().shown = false
PlayerSpellsFrame.OnShow()
assert(not panel().shown, 'closing the panel with its X stays closed too')
SlashCmdList.EVERLOOT('plan show')
assert(panel().shown, 'plan show opens it again')
assert(calls.purchase == 0 and calls.select == 0 and calls.import == 0 and calls.commit == 0 and calls.view == 0 and calls.click == 0)
""")

# --- Trait events: nothing while the panel is hidden, one read per burst when it shows ---
lua = fresh("""
timers = {}
C_Timer = { After = function(seconds, fn) table.insert(timers, fn) end }
reads = 0
local get = C_Traits.GetTreeNodes
C_Traits.GetTreeNodes = function(t) reads = reads + 1; return get(t) end
""", "{ installId = 'abcd-1234', toggles = { talents = false }, records = {} }")  # talents off: only the plan's timer counts
lua.execute(f"""
SlashCmdList.EVERLOOT('plan {CODE}')
local base = reads
SlashCmdList.EVERLOOT('plan hide')
event('TRAIT_CONFIG_UPDATED'); event('TRAIT_NODE_CHANGED')
assert(#timers == 0 and reads == base, 'a hidden panel schedules nothing and reads nothing')
SlashCmdList.EVERLOOT('plan show')
base = reads
event('TRAIT_CONFIG_UPDATED'); event('TRAIT_NODE_CHANGED'); event('PLAYER_TALENT_UPDATE')
assert(#timers == 1 and reads == base, 'a burst schedules one refresh')
NODES[90001].ranksPurchased = 2
timers[1]()
assert(reads == base + 1 and string.find(panel().body.text, '2 of 5', 1, true), 'the refresh runs once after the burst')
""")

# --- Class and spec checks ---
lua = fresh("UnitClass = nil")
lua.execute(f"""
SlashCmdList.EVERLOOT('plan {CODE}')
assert(EverlootDB.plan == '{CODE}', 'an unreadable class does not block the plan')
assert(string.find(table.concat(printed, '\\n'), 'class could not be read yet', 1, true), 'but it says the class was not checked')
""")
lua = fresh("SPEC = 1485")
lua.execute(f"""
SlashCmdList.EVERLOOT('plan {CODE}')
assert(EverlootDB.plan == '{CODE}')
assert(string.find(table.concat(printed, '\\n'), 'spec id 1482 and the client reports 1485', 1, true), 'a different spec id warns')
""")
lua = fresh("SPEC = 1485")
lua.execute(f"""
SlashCmdList.EVERLOOT('plan {share_code("mage", 0, "1.60.1.70450", PLAN_TEXT)}')
assert(not string.find(table.concat(printed, '\\n'), 'spec id', 1, true), 'spec 0 means unknown: no warning')
""")

# --- No panel support, no trait API ---
lua = fresh("CreateFrame = function(kind, name) if name == 'EverlootPlanFrame' then error('no frames') end return { RegisterEvent=function() end, SetScript=function(self, _, f) self.onEvent=f end, HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks, f) end } end")
lua.execute(f"""
SlashCmdList.EVERLOOT('plan {CODE}')
assert(string.find(table.concat(printed, '\\n'), '1 of 5 planned points match', 1, true), 'without a panel the plan prints to chat')
""")
lua = fresh("C_Traits = nil")
lua.execute(f"""
assert(string.find(Everloot:Status(), 'plan: disabled', 1, true), 'no trait API disables the plan module')
SlashCmdList.EVERLOOT('plan {CODE}')
""")

# --- Saved builds from the Desktop App's EverlootBuilds slot addon ---
# The golden file is rendered by the Desktop App (desktop/test/builds.test.ts writes it with
# EVERLOOT_WRITE_FIXTURES=1). Typed text must come back from Lua exactly as the player typed it.
assert "EverlootBuilds" in toc.split("## OptionalDeps:")[1].splitlines()[0], "the builds slot addon must load before the main addon"
BUILDS = (Path(__file__).parent / "fixtures" / "EverlootBuilds.lua").read_text(encoding="utf-8")
TRICKY = 'Fire "burst" |T \\ v2\n]] --[[ end\r\x01'
FROST = "EL1-mage-1482-1.59.0.69000-OTAwMDE6MQ"
check = LuaRuntime()
before = set(check.globals().keys())
check.execute(BUILDS)
assert set(check.globals().keys()) - before == {"EverlootBuildsData"}, "the file sets one global and nothing else"
data = check.globals().EverlootBuildsData
assert data.version == 1 and data.syncedAt == "2026-10-20T12:00:00.000Z"
assert data.builds[3].name == TRICKY, repr(data.builds[3].name)
assert data.builds[5].character == "Ærîn" and data.builds[5].realm == "Doomhowl" and data.builds[3].code2.startswith("EL1-")
assert data.builds[1].character is None and data.builds[1].realm is None and data.builds[2].realm == "nightslayer" and data.builds[3].realm is None

me = "UnitName = function() return 'Aerin', nil end\nGetRealmName = function() return 'Night Slayer' end\n" + BUILDS
lua = fresh(me)
lua.execute(f"""
local list = Everloot.Plan.SavedBuilds()
local names = {{}}
for i, b in ipairs(list) do names[i] = b.name end
assert(#list == 4, 'four mage builds: ' .. table.concat(names, ' / '))
assert(list[1].active and list[1].character == 'aERIN', 'this character first (any case), the active one on top')
assert(names[2] == 'Arcane leveling' and names[3] == 'Frost AoE' and names[4] == "Alt's build", 'then this character, then the class: ' .. table.concat(names, ' / '))

SlashCmdList.EVERLOOT('plan')
local out = table.concat(printed, '\\n')
assert(string.find(out, 'your saved builds (/everloot plan <number> loads one, <number> 2 its second set)', 1, true), out)
assert(string.find(out, '  1. Fire "burst" ||T \\\\ v2 ]] --[[ end   - aERIN (active) [2 sets]', 1, true), 'one line, | escaped: ' .. out)
assert(string.find(out, '  4. Alt\\'s build - Ærîn\\n', 1, true) or out:sub(-#'  4. Alt\\'s build - Ærîn') == '  4. Alt\\'s build - Ærîn', 'no marker without a second set: ' .. out)
assert(not string.find(out, 'Healer', 1, true), 'another class is not listed')
assert(panel().shown and string.find(panel().body.text, '/everloot plan lists your saved builds', 1, true), 'the panel still opens')

SlashCmdList.EVERLOOT('plan 3')
assert(EverlootDB.plan == '{FROST}', 'plan 3 loads the third build like a pasted code: ' .. tostring(EverlootDB.plan))
assert(string.find(panel().body.text, 'MAGE plan, made on build 1.59.0.69000', 1, true), panel().body.text)
assert(string.find(table.concat(printed, '\\n'), 'loading saved build 3, Frost AoE.', 1, true))
printed = {{}}
SlashCmdList.EVERLOOT('plan 9')
assert(EverlootDB.plan == '{FROST}' and string.find(printed[1], 'there is no saved build 9', 1, true), printed[1])
SlashCmdList.EVERLOOT('plan 1')
assert(EverlootDB.plan == '{CODE}', 'the first set of the active build')
SlashCmdList.EVERLOOT('plan 1 2')
assert(EverlootDB.plan == '{CODE2}', 'plan 1 2 loads the second set: ' .. tostring(EverlootDB.plan))
assert(string.find(table.concat(printed, '\\n'), 'loading saved build 1 (second set)', 1, true))
printed = {{}}
SlashCmdList.EVERLOOT('plan 3 2')
assert(EverlootDB.plan == '{CODE2}' and printed[1] == 'Everloot: saved build 3 has no second talent set.', tostring(printed[1]))
printed = {{}}
SlashCmdList.EVERLOOT('plan 1 3')
assert(EverlootDB.plan == '{CODE2}' and string.find(printed[1], 'talent sets 1 and 2, not 3', 1, true), tostring(printed[1]))
SlashCmdList.EVERLOOT('plan 1 1')
assert(EverlootDB.plan == '{CODE}', 'plan 1 1 is the first set')
local keys = {{}}
for k in pairs(EverlootDB) do keys[#keys + 1] = k end
assert(EverlootDB.builds == nil and EverlootBuildsData.version == 1, 'nothing of the builds is saved: ' .. table.concat(keys, ','))
""")

# A label with a realm counts as this character only on that realm (any case, spaces ignored); without
# a readable realm it does not. A label without a realm matches on any realm.
for realm in ["'Doomhowl'", "nil"]:
    lua = fresh(f"UnitName = function() return 'Aerin' end\nGetRealmName = function() return {realm} end\n" + BUILDS)
    lua.execute("""
local names = {}
for i, b in ipairs(Everloot.Plan.SavedBuilds()) do names[i] = b.name end
assert(names[2] == 'Frost AoE' and names[3] == 'Arcane leveling', 'another realm: the label goes with the class: ' .. table.concat(names, ' / '))
assert(names[1]:find('^Fire'), 'the label without a realm still matches')
""")

# Accented names: the Latin-1 capitals fold to lower case as UTF-8, so "Ásh" is "ásh"; × is not a letter.
lua = fresh(f"""
UnitName = function() return 'Ásh' end
EverlootBuildsData = {{ version = 1, syncedAt = 'x', builds = {{
  {{ name = 'Other', class = 'mage', code = '{CODE}', active = false, gameBuild = '1.60.1.70450' }},
  {{ name = 'Mine', character = 'ásh', class = 'mage', code = '{CODE}', active = false, gameBuild = '1.60.1.70450' }},
}} }}
""")
lua.execute("""
local P = Everloot.Plan
assert(P.Fold('ÀÉÎÕÜÞ×Ab') == 'àéîõüþ×ab', P.Fold('ÀÉÎÕÜÞ×Ab'))
local list = P.SavedBuilds()
assert(list[1].name == 'Mine' and list[2].name == 'Other', 'Ásh matches the label ásh')
""")

# Another class sees its own builds only; the character name still puts them first.
lua = fresh("CLASS = 'PRIEST'\n" + me)
lua.execute("""
local list = Everloot.Plan.SavedBuilds()
assert(#list == 1 and list[1].name == 'Healer', 'only the priest build')
SlashCmdList.EVERLOOT('plan 1')
assert(EverlootDB.plan == 'EL1-priest-0-1.60.1.70450-MToxLDI6MQ')
""")

# Without the slot addon: today's panel, one line about the Desktop App, and a number explains itself.
lua = fresh("UnitName = function() return 'Aerin' end")
lua.execute("""
assert(Everloot.Plan.SavedBuilds() == nil)
printed = {}
SlashCmdList.EVERLOOT('plan')
assert(string.find(panel().body.text, 'No plan loaded', 1, true) and string.find(panel().body.text, 'after a Desktop App sync and /reload', 1, true), panel().body.text)
assert(#printed == 0, 'no list without the data')
SlashCmdList.EVERLOOT('plan 1')
assert(string.find(table.concat(printed, '\\n'), 'no saved builds here yet. Sync them with the Everloot Desktop App', 1, true))
assert(EverlootDB.plan == nil)
""")

# Workspace imports retain the existing click-through talent highlights without the old panel.
lua = fresh("""
BUTTONS = { [90001] = { name = 'b1' }, [90003] = { name = 'b3' } }
PlayerSpellsFrame = {
 IsShown = function() return true end,
 HookScript = function(self, kind, f) self[kind] = f end,
 TalentsFrame = { IsShown = function() return true end, GetTalentButtonByNodeID = function(self, id) return BUTTONS[id] end },
}
""")
lua.execute(f"""
Everloot.Planner = {{tab='talents', frame={{IsShown=function() return true end}}}}
assert(Everloot.Plan.Load('{CODE}', true, 'O1p-AABCC'))
assert(not panel(), 'workspace import does not create the legacy panel')
local found = false
for _, f in ipairs(frames) do if f.target == BUTTONS[90001] and f.shown then found = true end end
assert(found, 'next point is still highlighted for the visible workspace')
Everloot.Plan.HideMarks()
for _, f in ipairs(frames) do if f.target then assert(not f.shown) end end
""")

# Saved selection carries only the selected set's token and set marker, including on the return link.
lua = fresh(me)
lua.execute(f"""
local P = Everloot.Plan
local b = P.SavedBuilds()[1]
assert(b.order == 'O1p-ABACC' and b.order2 == 'O1g-BA', 'the shared golden carries both tokens')
assert(P.LoadSaved(1))
assert(EverlootDB.planOrder == 'O1p-ABACC' and EverlootDB.planSet == nil, 'saved first set keeps its order')
assert(P.Link() == 'https://everloot.app/tools/talents/mage#plan={CODE}&order=O1p-ABACC')
assert(P.LoadSaved(1, 2))
assert(EverlootDB.plan == '{CODE2}' and EverlootDB.planOrder == 'O1g-BA' and EverlootDB.planSet == 2)
assert(P.Link() == 'https://everloot.app/tools/talents/mage#plan2={CODE2}&order2=O1g-BA')
assert(string.find(panel().body.text, 'Spend order: provisional', 1, true))
b.order2 = nil
assert(P.LoadSaved(1, 2))
assert(EverlootDB.planOrder == nil and EverlootDB.planSet == 2, 'missing second order never borrows the first')
assert(string.find(panel().body.text, 'Spend order: unknown', 1, true))
-- Legacy slot readers use only the ranks; a version 1 file without metadata remains readable.
assert(P.Decode(b.code) and P.Decode(b.code2))
b.order = nil
assert(P.LoadSaved(1))
assert(EverlootDB.planOrder == nil and EverlootDB.planSet == nil)
assert(P.Link() == 'https://everloot.app/tools/talents/mage#plan={CODE}')
""")
for token in ["O2p-BA", "O1p-AA", "O1p-BA B", "O1p-" + "A" * 65]:
    lua.globals().TOKEN = token
    lua.execute(f"""
local P = Everloot.Plan
P.SavedBuilds()[1].order2 = TOKEN
assert(P.LoadSaved(1, 2))
assert(EverlootDB.plan == '{CODE2}' and EverlootDB.planOrder == nil and EverlootDB.planSet == 2)
assert(string.find(panel().body.text, 'Spend order: unknown', 1, true))
assert(P.Link() == 'https://everloot.app/tools/talents/mage#plan2={CODE2}')
""")

print("Lua 5.1 plan: EL1 share code (independent base64url check), spend order token (shared vectors, exact whitespace), "
      "next point only from an order, mismatches, panel, display only, saved builds list")
