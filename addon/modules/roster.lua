-- Own characters only: one row per character the player logs in with, for the window's Home. Name, realm,
-- class token, level, faction, gold (only while the gold module is on) and professions, under the same opaque
-- key the completion module uses (core.lua, E.CharacterKey). It is not a record: nothing here goes through
-- E:Store, EverlootDB.records is never written, and the rows stay in EverlootDB.roster, never uploaded.
-- No other player's name is read.
--
-- Calls, each guarded and read through E.Readable; a missing or unreadable value records nothing for that field:
--   UnitName, GetRealmName, UnitClass, UnitLevel, UnitFactionGroup, GetMoney, GetProfessions, GetProfessionInfo
-- Events: PLAYER_ENTERING_WORLD, PLAYER_LEVEL_UP, SKILL_LINES_CHANGED, PLAYER_MONEY (only while gold is on).

local E = Everloot
local R = {}
E.Roster = R

local MAX_TEXT = 64

--- Bumped by every write to EverlootDB.roster, so a reader that caches by realm membership (the ledger's item history)
--- sees a change without walking the roster.
R.revision = 0

--- One guarded call to a global game function: its values, or nothing on a missing function or an error.
local function call(name, ...)
  local fn = _G[name]
  if type(fn) ~= "function" then return nil end
  local ok, a, b, c, d = pcall(fn, ...)
  if not ok then return nil end
  return E.Readable(a), E.Readable(b), E.Readable(c), E.Readable(d)
end

local function text(value)
  if type(value) ~= "string" or value == "" or #value > MAX_TEXT then return nil end
  return value
end

local function whole(value)
  if type(value) ~= "number" or value < 0 or value ~= math.floor(value) then return nil end
  return value
end

--- The profession list, or nil when this client has no profession API. Each entry: name, icon, rank, maxRank.
local function readProfessions()
  if type(GetProfessions) ~= "function" or type(GetProfessionInfo) ~= "function" then return nil end
  -- Five slots (two professions, archaeology, fishing, cooking); one the character has not filled is nil.
  local got = { pcall(GetProfessions) }
  if not got[1] then return nil end
  local list = {}
  for slot = 2, 6 do
    local index = got[slot]
    if type(index) == "number" then
      local okInfo, name, icon, rank, maxRank = pcall(GetProfessionInfo, index)
      name = okInfo and E.Readable(name)
      if text(name) then
        list[#list + 1] = { name = name, icon = whole(E.Readable(icon)), rank = whole(E.Readable(rank)), maxRank = whole(E.Readable(maxRank)) }
      end
    end
  end
  return list
end

--- This character's own facts into EverlootDB.roster[key]; a value that cannot be read leaves that field as it was.
function R.Update()
  if not E:IsEnabled("roster") then return end
  local key, class, level = E.CharacterKey()
  if not key then return end
  EverlootDB.roster = EverlootDB.roster or {}
  local row = EverlootDB.roster[key] or {}
  EverlootDB.roster[key] = row
  R.revision = R.revision + 1
  row.name = text((call("UnitName", "player"))) or row.name
  row.realm = text((call("GetRealmName"))) or row.realm
  row.class = class
  row.level = level
  row.faction = text((call("UnitFactionGroup", "player"))) or row.faction
  row.lastSeen = time()
  if E:IsEnabled("gold") then
    local copper = whole((call("GetMoney")))
    if copper then
      row.copper = copper
      row.peakCopper = math.max(whole(row.peakCopper) or 0, copper)
    end
  else
    row.copper, row.peakCopper = nil, nil
  end
  local professions = readProfessions()
  if professions then
    row.professions = professions
    E:SetNote("roster", "ready")
  else
    row.professions = row.professions or {}
    E:SetNote("roster", "ready; professions: no API")
  end
end

--- The key of the character logged in now, or nil when it cannot be read.
function R.Current()
  return (E.CharacterKey())
end

--- Every stored character as { key, name, realm, class, level, faction, professions, lastSeen, copper, peakCopper },
--- sorted by realm, then name.
function R.Rows()
  local out = {}
  for key, row in pairs(EverlootDB and EverlootDB.roster or {}) do
    local copy = { key = key }
    for field, value in pairs(row) do copy[field] = value end
    copy.professions = copy.professions or {}
    out[#out + 1] = copy
  end
  table.sort(out, function(a, b)
    local ra, rb = a.realm or "", b.realm or ""
    if ra ~= rb then return ra < rb end
    local na, nb = a.name or "", b.name or ""
    if na ~= nb then return na < nb end
    return a.key < b.key
  end)
  return out
end

--- Removes one character from the roster.
function R.Forget(key)
  if EverlootDB and EverlootDB.roster then EverlootDB.roster[key] = nil end
  R.revision = R.revision + 1
end

E:RegisterModule("roster", function()
  local f = E.frame
  for _, name in ipairs({ "PLAYER_ENTERING_WORLD", "PLAYER_LEVEL_UP", "SKILL_LINES_CHANGED", "PLAYER_MONEY" }) do
    pcall(function() f:RegisterEvent(name) end)
  end
  f:HookScript("OnEvent", function(_, event)
    if event == "PLAYER_MONEY" and not E:IsEnabled("gold") then return end
    R.Update()
  end)
  return "ready"
end)
