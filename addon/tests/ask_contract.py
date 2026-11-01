"""Run with: uv run --with lupa python addon/tests/ask_contract.py"""
from pathlib import Path
from lupa.lua51 import LuaRuntime


def adler32(text: str) -> int:
    a, b = 1, 0
    for byte in text.encode("utf-8"):
        a = (a + byte) % 65521
        b = (b + a) % 65521
    return b * 65536 + a


lua = LuaRuntime()
lua.execute("""
date = function() return '2026-10-09T00:00:00Z' end
time = function() return 123456 end
printed = {}
print = function(msg) printed[#printed + 1] = tostring(msg) end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function() end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
""")
root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "## OptionalDeps: EverlootAnswers" in toc, "answers must load before the main addon"
assert "modules\\ask.lua" in toc, "ask module must be in the TOC"
for file in ["core.lua", "modules/ask.lua"]:
    lua.execute((root / file).read_text(encoding="utf-8"))

lua.execute("""
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
SLASH_ASK = SlashCmdList.EVERLOOTASK
assert(SLASH_ASK and SLASH_EVERLOOTASK1 == '/ask', '/ask is registered')
SLASH_ASK('  Who is Thrall?  ')
SlashCmdList.EVERLOOT('ask Where is Molten Core?')
SLASH_ASK('')
SLASH_ASK(string.rep('x', 501))
assert(#EverlootDB.asks == 2, 'two real questions stored, blank and oversized refused; got ' .. #EverlootDB.asks)
assert(EverlootDB.asks[1].question == 'Who is Thrall?' and EverlootDB.asks[1].askedAt)
assert(EverlootDB.asks[1].id ~= EverlootDB.asks[2].id, 'ids are unique')
assert(string.find(printed[#printed], 'too long'), 'oversized question is explained')
first, second = EverlootDB.asks[1].id, EverlootDB.asks[2].id
""")

# The companion answered the first question correctly and the second with a corrupted checksum.
g = lua.globals()
lua.execute(f"""
EverlootAnswersDB = {{
  [first] = {{ answer = "Warchief of the Horde.", source = "warcraft.wiki.gg/wiki/Thrall", answeredAt = "x", sum = {adler32("Warchief of the Horde.")} }},
  [second] = {{ answer = "Tampered.", source = "none", answeredAt = "x", sum = 1 }},
}}
printed = {{}}
Everloot:InitModules()
""")
lua.execute("""
local all = table.concat(printed, '\\n')
assert(string.find(all, 'Who is Thrall%?') and string.find(all, 'Warchief of the Horde%.') and string.find(all, 'warcraft.wiki.gg'), all)
assert(not string.find(all, 'Tampered'), 'a failed checksum is never shown')
assert(string.find(all, 'checksum'), 'a failed checksum is reported')
assert(#EverlootDB.asks == 1 and EverlootDB.asks[1].id == second, 'answered question leaves the queue; the bad one stays for a retry')
printed = {}
Everloot:InitModules()
assert(not string.find(table.concat(printed, '\\n'), 'Warchief'), 'an answer is shown once')
""")
# A failure the companion will try again is shown once, and the question waits for the real answer; old answers
# without the retry flag are handled as before. The player is told how many questions still wait.
lua.execute(f"""
EverlootDB.asks = {{}}
EverlootAnswersDB = {{}}
SLASH_ASK('Where is Gnomeregan?')
retried = EverlootDB.asks[1].id
EverlootAnswersDB = {{ [retried] = {{ answer = "Could not answer yet (offline).", source = "none", answeredAt = "x", sum = {adler32("Could not answer yet (offline).")}, retry = true }} }}
printed = {{}}
Everloot:InitModules()
local said = table.concat(printed, '\\n')
assert(string.find(said, 'Could not answer yet', 1, true), 'the failure is shown: ' .. said)
assert(#EverlootDB.asks == 1 and EverlootDB.asks[1].id == retried, 'the question stays for the retry')
assert(string.find(said, '1 question is still waiting', 1, true), 'the wait is said: ' .. said)
printed = {{}}
Everloot:InitModules()
said = table.concat(printed, '\\n')
assert(not string.find(said, 'Could not answer yet', 1, true), 'the failure is shown once: ' .. said)
assert(string.find(said, 'still waiting', 1, true), 'the wait is said again')
EverlootAnswersDB = {{ [retried] = {{ answer = "Dun Morogh.", source = "everloot.app", answeredAt = "x", sum = {adler32("Dun Morogh.")} }} }}
printed = {{}}
Everloot:InitModules()
said = table.concat(printed, '\\n')
assert(string.find(said, 'Dun Morogh.', 1, true) and #EverlootDB.asks == 0, 'the retried answer reaches the player: ' .. said)
assert(not string.find(said, 'still waiting', 1, true), 'nothing waits now')
-- Without the answers addon loaded at all, the waiting questions are still counted.
SLASH_ASK('Who sells Linen Cloth?')
EverlootAnswersDB = nil
printed = {{}}
Everloot:InitModules()
assert(string.find(table.concat(printed, '\\n'), '1 question is still waiting', 1, true) and #EverlootDB.asks == 1)
assert(not string.find(table.concat(printed, '\\n'), 'no answer arrived', 1, true), 'the first load only wrote the question to the file')
""")
# The player is never left waiting in silence. A question with nothing at all for it after a second load (the first
# only wrote it to the file) says once that no answer arrived and names the Desktop App with Ask turned on, then
# keeps waiting for its answer. A retry or a failed checksum means the app is answering, so those are not counted.
lua.execute("""
local all = table.concat(printed, '\\n')
assert(not string.find(all, 'companion', 1, true), 'players are not told about a companion: ' .. all)
printed = {}
SLASH_ASK('Who sells Mageweave?')
assert(string.find(printed[1], 'question saved', 1, true) and string.find(printed[1], 'Everloot Desktop App (with Ask turned on)', 1, true), printed[1])
printed = {}
Everloot:InitModules()
local said = table.concat(printed, '\\n')
assert(string.find(said, 'no answer arrived for 1 question.', 1, true), 'the question from before the last load is overdue: ' .. said)
assert(string.find(said, 'Everloot Desktop App (with Ask turned on)', 1, true) and string.find(said, 'everloot.app/addon', 1, true) and string.find(said, '/reload', 1, true), said)
assert(string.find(said, '2 questions are still waiting', 1, true) and #EverlootDB.asks == 2, 'both still wait: ' .. said)
printed = {}
Everloot:InitModules()
said = table.concat(printed, '\\n')
assert(string.find(said, 'no answer arrived for 1 question.', 1, true), 'the newer question is told once on its second load: ' .. said)
printed = {}
Everloot:InitModules()
said = table.concat(printed, '\\n')
assert(not string.find(said, 'no answer arrived', 1, true) and string.find(said, '2 questions are still waiting', 1, true), 'said once each: ' .. said)
assert(not string.find(said, 'companion', 1, true), said)
""")
# A full queue refuses the new question and keeps every waiting one: an unanswered question is never dropped to
# make room, because its answer could then never be matched.
lua.execute("""
EverlootDB.asks = {}
EverlootAnswersDB = {}
printed = {}
for i = 1, 20 do SLASH_ASK('question ' .. i) end
assert(#EverlootDB.asks == 20, 'twenty questions fit; got ' .. #EverlootDB.asks)
counter = EverlootDB.askCounter
ids = {}
for i, ask in ipairs(EverlootDB.asks) do ids[i] = ask.id end
printed = {}
SLASH_ASK('question 21')
assert(#EverlootDB.asks == 20, 'the 21st question is refused; got ' .. #EverlootDB.asks)
for i, ask in ipairs(EverlootDB.asks) do
  assert(ask.id == ids[i] and ask.question == 'question ' .. i, 'every waiting question survives; slot ' .. i .. ' is ' .. tostring(ask.question))
end
assert(EverlootDB.askCounter == counter, 'a refused question uses no id')
local said = table.concat(printed, '\\n')
assert(not string.find(said, 'saved'), 'a refused question is not reported as saved: ' .. said)
assert(string.find(said, '20 questions', 1, true) and string.find(said, 'waiting', 1, true) and string.find(said, '/reload', 1, true) and string.find(said, 'ask again', 1, true), 'the refusal says what to do: ' .. said)
""")
lua.execute(f"""
-- A bad checksum frees nothing: that answer was never shown.
EverlootAnswersDB = {{ [ids[1]] = {{ answer = "Tampered.", source = "none", answeredAt = "x", sum = 1 }} }}
Everloot:InitModules()
assert(#EverlootDB.asks == 20, 'a failed checksum keeps its slot; got ' .. #EverlootDB.asks)
printed = {{}}
SLASH_ASK('question 21')
assert(#EverlootDB.asks == 20 and string.find(table.concat(printed, '\\n'), '20 questions', 1, true), 'still refused')
-- A verified answer frees exactly one slot, and the next question then fits behind the others.
EverlootAnswersDB = {{ [ids[1]] = {{ answer = "Done.", source = "none", answeredAt = "x", sum = {adler32("Done.")} }} }}
Everloot:InitModules()
assert(#EverlootDB.asks == 19 and EverlootDB.asks[1].id == ids[2], 'the answered question leaves; got ' .. #EverlootDB.asks)
printed = {{}}
SLASH_ASK('question 21')
assert(#EverlootDB.asks == 20 and EverlootDB.asks[20].question == 'question 21' and EverlootDB.asks[1].id == ids[2], 'the freed slot takes the new question')
assert(string.find(table.concat(printed, '\\n'), 'question saved', 1, true), 'and it is saved')
""")
# A price question needs a realm. The ask carries the one the player is on, so "price 2589" can be answered;
# an ask made where the game gives no usable realm name stays as it was, and the companion asks which realm.
lua.execute("""
EverlootDB.asks = {}
EverlootAnswersDB = {}
SLASH_ASK('before the realm is known')
assert(EverlootDB.asks[1].realm == nil, 'no GetRealmName: the ask has no realm')
GetRealmName = function() return 'Forever' end
SLASH_ASK('price 2589')
assert(EverlootDB.asks[2].realm == 'Forever', 'the ask carries the realm the player is on; got ' .. tostring(EverlootDB.asks[2].realm))
GetRealmName = function() return "  Dawn's Reach  " end
SLASH_ASK('price 2589 again')
assert(EverlootDB.asks[3].realm == "Dawn's Reach", 'the realm is trimmed; got ' .. tostring(EverlootDB.asks[3].realm))
for i, bad in ipairs({ '', 'X', string.rep('a', 41), 'Fore\\nver', 'a|cffff0000b' }) do
  GetRealmName = function() return bad end
  SLASH_ASK('bad realm ' .. i)
  assert(EverlootDB.asks[3 + i].realm == nil and EverlootDB.asks[3 + i].question == 'bad realm ' .. i, 'an unusable realm name is left out, the question is kept: ' .. bad)
end
GetRealmName = function() return 42 end
SLASH_ASK('a number is not a realm')
assert(EverlootDB.asks[9].realm == nil, 'only a string is a realm')
assert(EverlootDB.asks[2].id ~= nil and EverlootDB.asks[2].askedAt ~= nil and EverlootDB.asks[2].question == 'price 2589', 'the realm adds a field and changes none')
""")
# Who is asking goes with the question for its answer: the class token, the level and the zone, each left out
# when the game gives nothing usable, and the question kept either way.
lua.execute("""
EverlootDB.asks = {}
SLASH_ASK('no player functions')
assert(EverlootDB.asks[1].class == nil and EverlootDB.asks[1].level == nil and EverlootDB.asks[1].zone == nil, 'nothing known, nothing added')
UnitClass = function(unit) assert(unit == 'player'); return 'Mago', 'MAGE', 8 end
UnitLevel = function(unit) assert(unit == 'player'); return 34 end
GetRealZoneText = function() return '  Stranglethorn Vale ' end
SLASH_ASK('where is the flight master here')
local a = EverlootDB.asks[2]
assert(a.class == 'MAGE' and a.level == 34 and a.zone == 'Stranglethorn Vale', 'class token, level and trimmed zone; got ' .. tostring(a.class) .. ' ' .. tostring(a.level) .. ' ' .. tostring(a.zone))
assert(a.question == 'where is the flight master here' and a.id ~= nil and a.askedAt ~= nil, 'the other fields are unchanged')
UnitClass = function() return 'x', 'mage' end
UnitLevel = function() return 0 end
GetRealZoneText = function() return 'Zone|cffff0000' end
SLASH_ASK('bad player values')
local b = EverlootDB.asks[3]
assert(b.class == nil and b.level == nil and b.zone == nil and b.question == 'bad player values', 'unusable values are left out, the question kept')
UnitClass, UnitLevel, GetRealZoneText = nil, nil, nil
""")
print("Lua 5.1 ask: /ask stores bounded questions with the player's realm, class, level and zone when the game gives usable ones, a full queue refuses a new one and keeps every waiting question, verified answers show once, bad checksums are refused")
