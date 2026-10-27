"""Run with: uv run --with lupa python addon/tests/plan_contract.py"""
import base64
import json
import re
from pathlib import Path
from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\plan.lua" in toc, "plan module must be in the TOC"


def share_code(cls: str, spec: int, build: str, text: str) -> str:
    """The documented share code, built here without the addon's encoder."""
    payload = base64.urlsafe_b64encode(text.encode("ascii")).decode("ascii").rstrip("=")
    return f"EL1-{cls}-{spec}-{build}-{payload}"


# Nodes in ascending id order, as the site writes them: 90001 at rank 2, the choice node 90002 at its
# second entry, 90004 at rank 2. The order of the items is not a spend order.
PLAN_TEXT = "90001:2,90002:1:1,90004:2"
CODE = share_code("mage", 1482, "1.60.1.70450", PLAN_TEXT)
CODE2 = "EL1-mage-0-1.60.1.70450-MToxLDI6MQ"
# The spend order vectors every reader and writer of the token shares (docs/2026-10-17-talent-share-code.md).
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
    lua.execute(f"CODE, CODE2 = '{CODE}', '{CODE2}'")
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

# --- Point order tokens: every shared vector, read by this addon ---
codec = fresh()
read_order = codec.eval("""function(token, ranks)
  local plan = { entries = {} }
  for i = 1, #ranks do plan.entries[i] = { nodeId = ranks[i][1], rank = ranks[i][2], choice = ranks[i][3] } end
  local got, err = Everloot.Plan.DecodeOrder(token, plan)
  if not got then return 'error:' .. err end
  return got.origin .. ':' .. table.concat(got.order, ',')
end""")


def ranks_table(ranks):
    return codec.table_from([codec.table_from(r) for r in ranks])


def read(token, ranks):
    return read_order(token, ranks_table(ranks))


for v in VECTORS["decode"]:
    want = f"error:{v['error']}" if "error" in v else f"{v['origin']}:{','.join(map(str, v['order']))}"
    assert read(v["token"], v["ranks"]) == want, f"decode: {v['name']}: {read(v['token'], v['ranks'])}"
# The writer's vectors: each token read back is the order and maker it was written from.
for v in VECTORS["encode"]:
    if v["token"] is not None:
        assert read(v["token"], v["ranks"]) == f"{v['origin']}:{','.join(map(str, v['order']))}", f"encode, read back: {v['name']}"
assert read(42, [[1, 1]]) == "error:malformed" and read("O1p-A", []) == "error:extra-points"

# Whitespace around a token is exactly the code points the share-code doc lists (those ECMAScript's
# String.prototype.trim removes), matched as UTF-8, and nothing else: every code point of the Basic
# Multilingual Plane is tried at both ends. No code point above it is ECMAScript whitespace.
doc = (root.parent / "docs" / "2026-10-17-talent-share-code.md").read_text(encoding="utf-8")
listed = doc[doc.index("Whitespace means exactly"):doc.index("A reader in another language")]
SPACE = set()
for first, last in re.findall(r"U\+([0-9A-F]{4})(?: to U\+([0-9A-F]{4}))?", listed):
    SPACE.update(range(int(first, 16), int(last or first, 16) + 1))
assert len(SPACE) == 25, sorted(map(hex, SPACE))
pair = ranks_table([[1, 1], [2, 1]])
# Not whitespace to ECMAScript, though other trims take some of them, so a token they touch is damaged.
for cp, name in [(0x0085, "NEXT LINE"), (0x200B, "ZERO WIDTH SPACE"), (0x180E, "MONGOLIAN VOWEL SEPARATOR"), (0x2060, "WORD JOINER")]:
    assert cp not in SPACE
    for token in [chr(cp) + "O1p-AB", "O1p-AB" + chr(cp)]:
        assert read_order(token, pair) == "error:malformed", f"U+{cp:04X} {name} at an end damages a token"
trimmed = set()
for cp in range(0x10000):
    if 0xD800 <= cp <= 0xDFFF:
        continue  # surrogates have no UTF-8 form
    got = read_order(chr(cp) + "O1p-AB" + chr(cp), pair)
    if got == "planned:1,2":
        trimmed.add(cp)
    else:
        assert got == "error:malformed", f"U+{cp:04X}: {got}"
assert trimmed == SPACE, f"trimmed, not listed: {sorted(map(hex, trimmed - SPACE))}; listed, not trimmed: {sorted(map(hex, SPACE - trimmed))}"
for cp in SPACE:
    assert read_order("O1p-A" + chr(cp) + "B", pair) == "error:malformed", f"U+{cp:04X} inside a token damages it"

# --- Plan links: the shared vectors, read and written by this addon ---
read_link = codec.eval("""function(link)
  local sets = Everloot.Plan.ReadLink(link)
  return sets.first, sets.second, sets.firstOrder, sets.secondOrder
end""")
for v in VECTORS["links"]["read"]:
    assert read_link(v["link"]) == (v["first"], v["second"], v["firstOrder"], v["secondOrder"]), f"read a link: {v['name']}: {read_link(v['link'])}"
fragment = codec.eval("function(...) return Everloot.Plan.Fragment(...) end")
for v in VECTORS["links"]["write"]:
    assert fragment(v["first"], v["second"], v["firstOrder"], v["secondOrder"]) == v["fragment"], f"write a link: {v['name']}"
# A value ends at the first character the site's reader does not take (letters, digits, _ . -), where
# addon 0.3.12 read on to the next &. Only the #fragment is read, as the site reads location.hash.
assert read_link(f"https://everloot.app/tools/talents/mage#plan={CODE})&order=O1p-AABCC%20") == (CODE, None, "O1p-AABCC", None)
assert read_link(f"https://everloot.app/tools/talents/mage?x=1&plan={CODE}#plan2={CODE2}") == (None, CODE2, None, None)
assert read_link(f"https://everloot.app/tools/talents/mage#order=O1p-AABCC&plan={CODE}") == (CODE, None, "O1p-AABCC", None)
assert read_link(None) == (None, None, None, None)

# --- Comparing a plan with the client ---
lua.execute(f"GHOST = '{share_code('mage', 0, '1.59.0.1', '90001:1,99999:1')}'")
lua.execute(f"""
local P, T = Everloot.Plan, Everloot.Talents
local plan = P.Decode('{CODE}')
local function state(nodes)
  local s = {{ order = {{ 90001, 90002, 90003, 90004 }}, nodes = {{}} }}
  for id, n in pairs(nodes) do s.nodes[id] = n end
  return s
end
local function node(ranks, canBuy, choice) return {{ ranks = ranks, max = 3, canBuy = canBuy, choice = choice }} end
local function ids(entries) local out = {{}} for i, e in ipairs(entries) do out[i] = e.nodeId end return table.concat(out, ',') end
local base = {{ [90001] = node(1, true), [90002] = node(0, true), [90003] = node(0, false), [90004] = node(0, true) }}

-- Without an order nothing is next, not the first item and not the lowest node id: the points the game
-- shows as open now are listed, unranked.
local r = P.Evaluate(plan, state(base))
assert(r.total == 5 and r.done == 1 and #r.mismatches == 0, 'one of five points placed')
assert(r.next == nil and r.steps == nil, 'no order, no next point')
assert(ids(r.open) == '90001,90002,90004' and r.waiting == 0, 'the open points: ' .. ids(r.open))
base[90004] = node(0, false)
r = P.Evaluate(plan, state(base))
assert(r.next == nil and ids(r.open) == '90001,90002' and r.waiting == 1, 'a gated point is not open: ' .. ids(r.open))
base[90002] = node(0, nil)
r = P.Evaluate(plan, state(base))
assert(ids(r.open) == '90001' and r.waiting == 2, 'a point the game says nothing about is not called open')
base[90002] = node(0, true)
base[90001] = node(2, true)
r = P.Evaluate(plan, state(base))
assert(ids(r.open) == '90002' and r.waiting == 1, 'a finished node is not open')
base[90001] = node(1, true)

-- O1p-ACBAC is 90001, 90004, 90002, 90001, 90004. After one point in 90001 the order names 90004, where
-- node order would name 90001 again.
local interleaved = assert(P.DecodeOrder('O1p-ACBAC', plan))
base[90004] = node(0, true)
r = P.Evaluate(plan, state(base), interleaved)
assert(r.next.entry.nodeId == 90004 and r.next.step == 2 and r.steps == 5 and r.origin == 'planned', 'the order names the next point')
assert(r.next.blocked == false and not r.next.unsure and not r.next.missing and r.ahead == 0, 'open, and the build is on the order')
assert(r.open == nil, 'with an order nothing is listed unranked')
assert(P.Evaluate(plan, state(base), assert(P.DecodeOrder('O1g-ACBAC', plan))).origin == 'provisional')

-- The order's next point is never passed over for a later one the game would sell.
base[90004] = node(0, false)
r = P.Evaluate(plan, state(base), interleaved)
assert(r.next.entry.nodeId == 90004 and r.next.blocked == true, 'a gated next point stays next, blocked')
base[90004] = node(0, nil)
r = P.Evaluate(plan, state(base), interleaved)
assert(r.next.entry.nodeId == 90004 and r.next.blocked == false and r.next.unsure == true, 'the game does not say: unsure, not open')

-- Spent off the order: both points of 90001 and none of 90004. Next is still the order's first point
-- the build lacks, and the point spent ahead of it is counted.
base[90001] = node(2, true); base[90004] = node(0, true)
r = P.Evaluate(plan, state(base), interleaved)
assert(r.next.entry.nodeId == 90004 and r.next.step == 2 and r.ahead == 1, 'one point ahead of the order')

-- A node the tree does not have stops the order there.
local stray = P.Decode(GHOST)
r = P.Evaluate(stray, state(base), assert(P.DecodeOrder('O1p-AB', stray)))
assert(r.next.entry.nodeId == 99999 and r.next.step == 2 and r.next.missing == true and r.next.blocked == true, 'the order stops at a node the tree lacks')
base[90001] = node(1, true); base[90004] = node(0, false)

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
assert(r.done == 5 and r.next == nil and #r.open == 0 and r.waiting == 0 and #r.mismatches == 0, 'a finished plan has nothing left')
r = P.Evaluate(plan, state(base), interleaved)
assert(r.done == 5 and r.next == nil and r.ahead == 0, 'a finished order has no next point')

local ghost = P.Decode('{share_code("mage", 0, "1.59.0.1", "99999:1")}')
r = P.Evaluate(ghost, state(base))
assert(r.mismatches[1].kind == 'unknown' and r.mismatches[1].nodeId == 99999, 'a node the tree does not have')
""")

# --- /everloot plan: loads, shows, remembers, and never acts ---
lua = fresh()
lua.execute(f"""
SlashCmdList.EVERLOOT('plan {CODE}')
assert(EverlootDB.plan == '{CODE}', 'the plan is kept in SavedVariables, case intact')
assert(EverlootDB.planOrder == nil and EverlootDB.planSet == nil and EverlootDB.planOrderProblem == nil, 'a code alone has no order')
local p = panel()
assert(p and p.shown, 'the panel opens')
assert(string.find(p.body.text, 'MAGE plan, made on build 1.60.1.70450', 1, true), p.body.text)
assert(string.find(p.body.text, 'Point order unavailable: none came with this plan, so no next point is ranked.', 1, true), p.body.text)
assert(string.find(p.body.text, '1 of 5 planned points match', 1, true), p.body.text)
assert(string.find(p.body.text, 'Points you can spend now, in no order: Arcane Power (rank 2 of 2), Frost Nova (rank 1 of 1)', 1, true),
  'the open points by name, the choice node at its planned option, the gated 90004 left out: ' .. p.body.text)
assert(not string.find(p.body.text, 'Next point', 1, true), 'item order is not a spend order: nothing is next')
assert(not string.find(p.body.text, 'node ids may have moved', 1, true), 'same build, no warning')
""")
lua.execute("""
NODES[90001].ranksPurchased = 2
event('TRAIT_CONFIG_UPDATED')
local p = panel()
assert(string.find(p.body.text, '2 of 5 planned points match', 1, true), 'the panel follows spent points: ' .. p.body.text)
assert(string.find(p.body.text, 'Points you can spend now, in no order: Frost Nova (rank 1 of 1)', 1, true)
  and not string.find(p.body.text, 'Arcane Power', 1, true), 'a finished node leaves the list: ' .. p.body.text)
NODES[90002].canPurchaseRank = false
event('TRAIT_CONFIG_UPDATED')
assert(string.find(p.body.text, "The game shows none of the plan's remaining points as available now.", 1, true), p.body.text)
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

# A website link belongs in the Talents Import panel, not a typed command: it is refused with where to paste it.
lua = fresh()
lua.execute(f"""
SlashCmdList.EVERLOOT('plan https://everloot.app/tools/talents/mage#plan={CODE}&order=O1p-AABCC')
assert(EverlootDB.plan == nil, 'a typed link loads nothing')
assert(string.find(table.concat(printed, '\\n'), 'paste a website link into /everloot > Talents > Import', 1, true), table.concat(printed, '\\n'))
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
local marks = {{}}
for _, f in ipairs(frames) do if f.target then marks[f.target.name] = f end end
assert(not (marks.b1 and marks.b1.shown), 'without an order no talent is outlined as next')
assert(marks.b3 and marks.b3.shown and marks.b3.mouse == false, 'the extra point is flagged, click-through')
-- O1p-AABCC spends both points of 90001 first: with one spent, its second is next.
Everloot.Plan.Load('{CODE}', false, 'O1p-AABCC')
for _, f in ipairs(frames) do if f.target then marks[f.target.name] = f end end
assert(marks.b1 and marks.b1.shown and marks.b1.mouse == false, 'the next point of the order is outlined, click-through')
assert(marks.b3 and marks.b3.shown and marks.b3.mouse == false, 'the extra point is still flagged')
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
# Copy plan link still works from the saved plan, and checks the saved order itself, since a disabled
# module never read it.
for saved_order, back in [(" O1p-AABCC\\n", f"#plan2={CODE}&order2=O1p-AABCC"), ("O1p-AAAAA", f"#plan2={CODE}")]:
    lua = fresh("C_Traits = nil", f"{{ plan = '{CODE}', planOrder = '{saved_order}', planSet = 2 }}")
    lua.execute(f"""
assert(string.find(Everloot:Status(), 'plan: disabled', 1, true))
assert(Everloot.Plan.Link() == 'https://everloot.app/tools/talents/mage{back}', tostring(Everloot.Plan.Link()))
""")

# More open points than fit: the first eight by name, then a count. By name, not by node id.
lua = fresh("""
local ids = { 90001, 90002, 90003, 90004 }
for id = 91001, 91010 do
  NODES[id] = { ranksPurchased = 0, maxRanks = 1, canPurchaseRank = true, entryIDs = { id } }
  SPELLS[id] = 'Talent ' .. (id - 91000)
  ids[#ids + 1] = id
end
C_Traits.GetTreeNodes = function() return ids end
""")
lua.execute(f"""
SlashCmdList.EVERLOOT('plan {share_code("mage", 1482, "1.60.1.70450", ",".join(f"{n}:1" for n in range(91001, 91011)))}')
local text = panel().body.text
assert(string.find(text, 'Points you can spend now, in no order: Talent 1 (rank 1 of 1), Talent 10 (rank 1 of 1), Talent 2 (rank 1 of 1), '
  .. 'Talent 3 (rank 1 of 1), Talent 4 (rank 1 of 1), Talent 5 (rank 1 of 1), Talent 6 (rank 1 of 1), Talent 7 (rank 1 of 1), and 2 more', 1, true), text)
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
assert(EverlootDB.planSet == 2 and Everloot.Plan.Link() == 'https://everloot.app/tools/talents/mage#plan2={CODE2}', 'a second set goes back as a second set: ' .. tostring(Everloot.Plan.Link()))
printed = {{}}
SlashCmdList.EVERLOOT('plan 3 2')
assert(EverlootDB.plan == '{CODE2}' and printed[1] == 'Everloot: saved build 3 has no second talent set.', tostring(printed[1]))
printed = {{}}
SlashCmdList.EVERLOOT('plan 1 3')
assert(EverlootDB.plan == '{CODE2}' and string.find(printed[1], 'talent sets 1 and 2, not 3', 1, true), tostring(printed[1]))
SlashCmdList.EVERLOOT('plan 1 1')
assert(EverlootDB.plan == '{CODE}' and EverlootDB.planSet == nil, 'plan 1 1 is the first set')
assert(Everloot.Plan.Link() == 'https://everloot.app/tools/talents/mage#plan={CODE}')
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
assert(Everloot.Plan.Load('{CODE}', true))
assert(not panel(), 'workspace import does not create the legacy panel')
for _, f in ipairs(frames) do if f.target == BUTTONS[90001] then assert(not f.shown, 'no order, no next point outlined') end end
assert(Everloot.Plan.Load('{CODE}', true, 'O1p-AABCC'))
local found = false
for _, f in ipairs(frames) do if f.target == BUTTONS[90001] and f.shown then found = true end end
assert(found, 'the next point of the order is still highlighted for the visible workspace')
Everloot.Plan.HideMarks()
for _, f in ipairs(frames) do if f.target then assert(not f.shown) end end
""")

# --- A point order: its maker shows, it names the next point, and nothing is played ---
lua = fresh("SPELLS[601] = 'Blizzard'; NODES[90004].entryIDs = { 601 }")
lua.execute("""
local P = Everloot.Plan
-- O1p-ACBAC: 90001, 90004, 90002, 90001, 90004. 90001 has one point, so 90004 is next.
assert(P.Load(CODE, false, ' O1p-ACBAC\\n') == true, 'a code loads with its order token')
assert(EverlootDB.plan == CODE and EverlootDB.planOrder == 'O1p-ACBAC', 'the validated token is kept whole, its ends trimmed: ' .. tostring(EverlootDB.planOrder))
local text = panel().body.text
assert(string.find(text, 'Point order: planned in the talent calculator, not recorded play.', 1, true), text)
assert(string.find(text, 'Next point: Blizzard (rank 1 of 2), point 2 of 5 in the planned order - not available yet (a gate or no point to spend)', 1, true), text)
assert(not string.find(text, 'Points you can spend now', 1, true), 'an ordered plan lists nothing unranked')
NODES[90004].canPurchaseRank = true
event('TRAIT_CONFIG_UPDATED')
text = panel().body.text
assert(string.find(text, 'Next point: Blizzard (rank 1 of 2), point 2 of 5 in the planned order', 1, true) and not string.find(text, 'order -', 1, true), text)
NODES[90004].canPurchaseRank = nil
event('TRAIT_CONFIG_UPDATED')
assert(string.find(panel().body.text, 'point 2 of 5 in the planned order - the game does not say whether it is available yet', 1, true), panel().body.text)
NODES[90004].canPurchaseRank = true
NODES[90001].ranksPurchased = 2
event('TRAIT_CONFIG_UPDATED')
text = panel().body.text
assert(string.find(text, 'Next point: Blizzard (rank 1 of 2), point 2 of 5 in the planned order', 1, true), text)
assert(string.find(text, 'Your build is off this order: you have 1 point it spends later.', 1, true), text)
NODES[90001].ranksPurchased = 1

-- A provisional order says so wherever it shows, and keeps saying so until the plan is replaced or cleared.
assert(P.Load(CODE, false, 'O1g-ACBAC'))
text = panel().body.text
assert(string.find(text, 'Point order: provisional, made by a tool, not a recommendation or recorded play.', 1, true), text)
assert(string.find(text, 'point 2 of 5 in the provisional order', 1, true), text)
NODES[90004].ranksPurchased = 1
event('TRAIT_CONFIG_UPDATED')
text = panel().body.text
assert(string.find(text, 'Point order: provisional', 1, true) and string.find(text, 'point 3 of 5 in the provisional order', 1, true), 'spending keeps the label: ' .. text)
NODES[90004].ranksPurchased = 0
assert(P.Load(CODE, false, 'O1p-ACBAC'))
text = panel().body.text
assert(string.find(text, 'Point order: planned', 1, true) and not string.find(text, 'provisional', 1, true), 'a new token brings its own maker')
assert(P.Load(CODE))
text = panel().body.text
assert(string.find(text, 'Point order unavailable: none came with this plan', 1, true) and not string.find(text, 'Next point', 1, true), 'a code alone replaces the order too')
assert(EverlootDB.planOrder == nil)
assert(P.Load(CODE2, false, 'O1g-AB', 2) and EverlootDB.planSet == 2 and EverlootDB.planOrder == 'O1g-AB')
SlashCmdList.EVERLOOT('plan clear')
assert(EverlootDB.plan == nil and EverlootDB.planOrder == nil and EverlootDB.planSet == nil and EverlootDB.planOrderProblem == nil, 'clear forgets the order with the plan')
assert(P.Link() == nil)
assert(calls.purchase == 0 and calls.select == 0 and calls.import == 0 and calls.commit == 0 and calls.view == 0 and calls.click == 0, 'an order only shows; nothing is spent, picked or clicked')
""")

# A reload reads the saved token again: the label comes back with the plan.
lua = fresh("", f"{{ plan = '{CODE}', planOrder = 'O1g-ACBAC', planSet = 2 }}")
lua.execute("""
SlashCmdList.EVERLOOT('plan')
local text = panel().body.text
assert(string.find(text, 'Point order: provisional', 1, true) and string.find(text, 'in the provisional order', 1, true), text)
assert(Everloot.Plan.Link() == 'https://everloot.app/tools/talents/mage#plan2=' .. CODE .. '&order2=O1g-ACBAC', tostring(Everloot.Plan.Link()))
""")

# An order that cannot be used never stops the talents loading: the ranks load, the order is unknown and
# the panel says why, nothing is ranked next, and the copy link leaves the order out.
for token, why in [
    ("O1p-AB.AB", "the order is damaged"),
    ("O2p-AABCC", "a newer version of Everloot made it"),
    ("O1x-AABCC", "it is a kind of order this addon does not read"),
    ("O1p-" + "A" * 65, "it is for more than 64 points, the most an order carries"),
    ("O1p-AABCCC", "it lists points the plan does not have"),
    ("O1p-AABC", "it leaves out points the plan has"),
]:
    lua = fresh()
    lua.execute(f"""
assert(Everloot.Plan.Load(CODE, false, '{token}') == true, 'the talents load whatever the order')
assert(EverlootDB.plan == CODE and EverlootDB.planOrder == nil, 'only a validated token is kept')
local text = panel().body.text
assert(string.find(text, 'Point order unknown: {why}, so no next point is ranked.', 1, true), text)
assert(not string.find(text, 'Next point', 1, true), 'no next point is made up')
assert(string.find(text, 'Points you can spend now, in no order', 1, true), 'the open points are listed instead')
assert(Everloot.Plan.Link() == 'https://everloot.app/tools/talents/mage#plan=' .. CODE, tostring(Everloot.Plan.Link()))
""")

# The reason survives a reload. A saved token that no longer fits its code is dropped, not repaired, and a
# reason this addon does not know is ignored.
for saved, line in [
    (f"{{ plan = '{CODE}', planOrderProblem = 'newer-version' }}", "Point order unknown: a newer version of Everloot made it"),
    (f"{{ plan = '{CODE}', planOrder = 'O1p-AAAAA' }}", "Point order unknown: it lists points the plan does not have"),
    (f"{{ plan = '{CODE}', planOrderProblem = 'bogus' }}", "Point order unavailable: none came with this plan"),
]:
    lua = fresh("", saved)
    lua.execute(f"""
assert(EverlootDB.planOrder == nil)
SlashCmdList.EVERLOOT('plan')
assert(string.find(panel().body.text, '{line}', 1, true), panel().body.text)
assert(Everloot.Plan.Link() == 'https://everloot.app/tools/talents/mage#plan=' .. CODE)
""")

print("Lua 5.1 plan: EL1 share code (independent base64url check), O1 point order (shared vectors, exact trim set), plan links, "
      "next point only from an order, open points without one, panel, display only, saved builds list")
