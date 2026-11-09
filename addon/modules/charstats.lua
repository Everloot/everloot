-- Everloot character sheet numbers for WoW: Forever: this character's attributes, attack power, hit, crit, haste,
-- spell power and defense, as the paper doll shows them.
-- Runs with the completion tracker (/everloot completion on|off) and under its key.
--
--   stats_owned  one row per character: { stats = { strength = n, ... } }, latest state only. Each read replaces this
--                character's row; a read the client cannot answer (in combat, values it hides, a missing call) leaves
--                the last row alone. A stat whose call is missing or unreadable is left out, never a zero, and with
--                fewer than the five attributes readable there is no row at all.
-- The row stays on this computer: no uploader sends it (web/src/lib/upload-batches.ts LOCAL_ONLY_KINDS) and the
-- site's intake does not know it. It is for the private sync of a character the player linked.
--
-- Numbers: the percent stats (every *Hit, *Crit, *Haste, expertise, dodge, parry, block) are rounded to 2 decimals. Every other
-- stat is a whole number, ROUNDED to the nearest (not floored).
--
-- Calls, each read from Forever's Camelot paper doll files (PaperDollFrame.lua, PaperDollFrameStats.lua):
--   UnitStat("player", 1..5)           strength agility stamina intellect spirit: the second return (effective stat)
--   UnitAttackPower / UnitRangedAttackPower   base + posBuff + negBuff
--   GetCritChance / GetRangedCritChance / GetSpellCritChance
--   GetHitModifier / GetRangedHitModifier / GetSpellHitModifier, plus GetCombatRatingBonus(CR_HIT_MELEE|RANGED|SPELL)
--                                      when that global and the function both exist
--   GetMeleeHaste / UnitSpellHaste("player"); GetRangedHaste first + second return (ammo haste, 0 if absent)
--   GetExpertise                       first return (main hand), a percent
--   GetSpellBonusDamage(2..7)          the lowest school; GetSpellBonusHealing
--   UnitArmor                          second return (effective); UnitDefenseSkill base + modifier, at least 0
--   GetDodgeChance / GetParryChance / GetBlockChance
-- Not yet checked in game.

local E = Everloot
local S = {}
E.CharStats = S

S.KINDS = { "stats_owned" }

local API = { "UnitStat", "UnitAttackPower", "UnitRangedAttackPower", "GetCritChance", "GetRangedCritChance",
  "GetSpellCritChance", "GetHitModifier", "GetRangedHitModifier", "GetSpellHitModifier", "GetMeleeHaste",
  "GetRangedHaste", "UnitSpellHaste", "GetExpertise", "GetSpellBonusDamage", "GetSpellBonusHealing", "UnitArmor",
  "UnitDefenseSkill", "GetDodgeChance", "GetParryChance", "GetBlockChance" }

local EVENTS = { "PLAYER_ENTERING_WORLD", "UNIT_STATS", "PLAYER_EQUIPMENT_CHANGED", "PLAYER_LEVEL_UP", "PLAYER_REGEN_ENABLED" }
local DEBOUNCE_SECONDS = 2
local ATTRIBUTES = { "strength", "agility", "stamina", "intellect", "spirit" }
local MAX_STAT = 1000000

local missing = {}

--- One guarded call; an error is a nil. Values the client will not let an addon read are nil too.
local function call(name, ...)
  local fn = _G[name]
  if type(fn) ~= "function" then return nil end
  local out = { pcall(fn, ...) }
  if not out[1] then return nil end
  for i = 2, 15 do out[i] = E.Readable(out[i]) end
  return unpack(out, 2, 15)
end

local function number(n)
  if type(n) == "number" and n == n and n > -MAX_STAT and n < MAX_STAT then return n end
  return nil
end

local function percent(n)
  n = number(n)
  return n and math.floor(n * 100 + 0.5) / 100 or nil
end

local function whole(n)
  n = number(n)
  return n and math.floor(n + 0.5) or nil
end

--- The first `count` returns added together; any one unreadable leaves the stat out.
local function sum(count, ...)
  local total = 0
  for i = 1, count do
    local n = number((select(i, ...)))
    if not n then return nil end
    total = total + n
  end
  return total
end

--- A hit modifier plus the combat rating bonus; without the rating's global or function, the modifier alone.
--- A rating that is there but unreadable leaves the stat out.
local function hit(modifierCall, ratingName)
  local modifier = number((call(modifierCall)))
  if not modifier then return nil end
  local rating = ratingName and _G[ratingName]
  if rating ~= nil and type(_G.GetCombatRatingBonus) == "function" then
    local bonus = number((call("GetCombatRatingBonus", rating)))
    if not bonus then return nil end
    return modifier + bonus
  end
  return modifier
end

local function now() return date("!%Y-%m-%dT%H:%M:%SZ") end

local function lowestSpellPower()
  local lowest
  for school = 2, 7 do
    local n = number((call("GetSpellBonusDamage", school)))
    if not n then return nil end
    if not lowest or n < lowest then lowest = n end
  end
  return lowest
end

--- The stats table, or nil when fewer than the five attributes are readable.
function S.Collect()
  local stats = {}
  local attributes, nonzero = 0, false
  for i, name in ipairs(ATTRIBUTES) do
    local value = whole(select(2, call("UnitStat", "player", i)))
    if value then
      stats[name] = value
      attributes = attributes + 1
      if value ~= 0 then nonzero = true end
    end
  end
  -- Five zeros are a client with no data yet, not a character: no row.
  if attributes < #ATTRIBUTES or not nonzero then return nil end

  local function put(key, value) if value ~= nil then stats[key] = value end end
  put("meleeAttackPower", whole(sum(3, call("UnitAttackPower", "player"))))
  put("meleeHit", percent(hit("GetHitModifier", "CR_HIT_MELEE")))
  put("meleeCrit", percent((call("GetCritChance"))))
  put("meleeHaste", percent((call("GetMeleeHaste"))))
  -- A percent in Forever: the paper doll formats it "%.1F%%" (Camelot PaperDollFrameStats.lua).
  put("expertise", percent((call("GetExpertise"))))

  put("rangedAttackPower", whole(sum(3, call("UnitRangedAttackPower", "player"))))
  put("rangedHit", percent(hit("GetRangedHitModifier", "CR_HIT_RANGED")))
  put("rangedCrit", percent((call("GetRangedCritChance"))))
  -- The paper doll adds the ammo haste (second return) to the base; a missing second return is 0.
  local baseHaste, ammoHaste = call("GetRangedHaste")
  baseHaste = number(baseHaste)
  put("rangedHaste", baseHaste and percent(baseHaste + (number(ammoHaste) or 0)) or nil)

  put("spellPower", whole(lowestSpellPower()))
  put("healing", whole((call("GetSpellBonusHealing"))))
  put("spellHit", percent(hit("GetSpellHitModifier", "CR_HIT_SPELL")))
  put("spellCrit", percent((call("GetSpellCritChance"))))
  put("spellHaste", percent((call("UnitSpellHaste", "player"))))

  put("armor", whole(select(2, call("UnitArmor", "player"))))
  -- Never below 0, as the paper doll's GetEffectiveDefenseSkill does.
  local defense = sum(2, call("UnitDefenseSkill", "player"))
  put("defense", defense and whole(math.max(0, defense)) or nil)
  put("dodge", percent((call("GetDodgeChance"))))
  put("parry", percent((call("GetParryChance"))))
  put("block", percent((call("GetBlockChance"))))
  return stats
end

--- Replace this character's row with what the paper doll shows now. Out of combat only; a read that cannot be
--- answered leaves the last row alone. Returns true when a row was written.
function S.Read()
  -- The completion module can still be missing at load, so its key is read here, at event time.
  local identity = E.Completion and E.Completion.Identity
  local key, class, level
  if identity then key, class, level = identity() end
  if not key then return false end
  if type(_G.InCombatLockdown) == "function" and _G.InCombatLockdown() then return false end
  local stats = S.Collect()
  if not stats then return false end
  local kept = {}
  for _, row in ipairs(EverlootDB.records.stats_owned or {}) do
    if type(row) == "table" and row.characterKey ~= key then kept[#kept + 1] = row end
  end
  EverlootDB.records.stats_owned = kept
  return E:Store("stats_owned", {
    kind = "stats_owned", characterKey = key, installId = EverlootDB.installId, capturedAt = now(),
    class = class, level = level, stats = stats,
  })
end

--- /everloot completion off: delete every row this module wrote.
function S.Withdraw()
  for _, kind in ipairs(S.KINDS) do
    EverlootDB.records[kind] = nil
    if EverlootDB.paused then EverlootDB.paused[kind] = nil end
  end
end

local function describe()
  if #missing == 0 then return "stats ready" end
  return "stats missing " .. table.concat(missing, ", ") .. " (those stats are left out)"
end

E:RegisterModule("charstats", function()
  if not (E.Completion and E.Completion.Identity) then error("needs the completion module's character key", 0) end
  missing = {}
  for _, name in ipairs(API) do
    if type(_G[name]) ~= "function" then missing[#missing + 1] = name end
  end
  if type(_G.UnitStat) ~= "function" then error("needs UnitStat for the five attributes; " .. describe(), 0) end
  local f = E.frame
  local watched = {}
  for _, event in ipairs(EVENTS) do
    if pcall(function() f:RegisterEvent(event) end) then watched[event] = true end
  end
  -- Stat events come in bursts (every buff, every swap); read once after they settle. PLAYER_REGEN_ENABLED (combat
  -- ended) reads too, so a read skipped in combat is not left stale.
  local pending = false
  local function schedule()
    if C_Timer and type(C_Timer.After) == "function" then
      if pending then return end
      pending = true
      C_Timer.After(DEBOUNCE_SECONDS, function()
        pending = false
        -- Switched off while waiting: write nothing.
        if E:IsEnabled("completion") then pcall(S.Read) end
      end)
    else
      pcall(S.Read)
    end
  end
  f:HookScript("OnEvent", function(_, event, unit)
    if not watched[event] or not E:IsEnabled("completion") then return end
    if event == "UNIT_STATS" and unit ~= "player" then return end
    schedule()
  end)
  return "ready: " .. describe() .. "; kept on this computer; never in an upload; the Everloot Desktop App sends a linked character's row and everloot.app keeps only the categories you switched on"
end, "completion")
