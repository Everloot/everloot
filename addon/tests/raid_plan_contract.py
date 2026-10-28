"""Website raid plans import without changing the real raid or recording its names."""
import base64
from pathlib import Path
from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]
lua = LuaRuntime(unpack_returned_tuples=True)
lua.execute("Everloot = { RegisterModule = function() end }; EverlootDB = { clientBuild = '1.60.1.70532' }; print = function() end")
lua.execute((root / 'modules/raid.lua').read_text(encoding='utf-8'))

def code(payload, size=10, build='1.60.1.70532'):
    return f'ELR1-{size}-{build}-' + base64.urlsafe_b64encode(payload.encode()).decode().rstrip('=')

lua.globals().valid = code('731000000020')
lua.execute("""
local R = Everloot.Raid
local p = assert(R.Decode(valid))
assert(p.size == 10 and p.slots[1].class == 'MAGE' and p.slots[1].tree == 3)
assert(p.slots[2].class == 'WARRIOR' and p.slots[6].class == 'PALADIN')
assert(p.slots[3] == false and p.slots[10] == false)
assert(R.Decode('https://everloot.app/tools/raid#raid=' .. valid))
assert(R.Decode('https://everloot.app/tools/raid/r/' .. valid))
assert(R.Decode('https://everloot.app/tools/raid/?utm_source=profile#raid=' .. valid))
assert(R.Decode('http://127.0.0.1:3315/tools/raid/r/' .. valid))
assert(R.Decode(valid .. '=='))
assert(R.Load(valid))
assert(EverlootDB.raidPlan == valid)
local old = EverlootDB.raidPlan
assert(not R.Load('broken'))
assert(EverlootDB.raidPlan == old, 'invalid imports preserve the existing plan')
local compared = R.Compare(p, {
 {group=1, class='WARRIOR', name='private'}, {group=1, class='MAGE'},
 {group=2, class='MAGE'}, {group=2, class='MAGE'},
})
assert(compared[1].matched == 2 and compared[1].planned == 2 and compared[1].actual == 2)
assert(#compared[1].differences == 0, 'slot order within a group does not matter')
assert(compared[2].matched == 0 and compared[2].planned == 1 and compared[2].actual == 2)
assert(compared[2].differences[1].class == 'PALADIN' and compared[2].differences[1].need == 1)
assert(compared[2].differences[2].class == 'MAGE' and compared[2].differences[2].extra == 2)
local text = table.concat(R.PlanLines({}), '\\n')
assert(text:find('talent choices', 1, true), 'explain tree verification limits')
EverlootDB.clientBuild = '1.60.1.99999'
assert(table.concat(R.PlanLines({}), '\\n'):find('different build', 1, true))
R.ClearPlan()
assert(EverlootDB.raidPlan == nil)
""")
for bad in [code('04'), code('14'), code('1'), code('10' * 11), code('ab'),
            code('10', size=15), code('10', build='1..2'), code('10').replace('ELR1', 'ELR2'),
            'ELR1-10-1.2-A', 'ELR1-10-1.2-!!!', 'x' * 2049]:
    result = lua.eval('Everloot.Raid.Decode')(bad)
    assert isinstance(result, tuple) and result[0] is None, bad
lua.globals().valid = code('90', size=40)
lua.execute("""
assert(Everloot.Raid.Load(valid))
assert(#Everloot.Raid.Compare(assert(Everloot.Raid.Decode(valid)), {{ group=8, class='DRUID' }}) == 8)
""")
print('raid plan contract: PASS')
