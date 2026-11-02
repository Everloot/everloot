-- Everloot character links: `/everloot link <code>` ties the character you are playing to your everloot.app
-- account. The site shows a signed-in player a code (EL-7K3Q-9P, live 15 minutes, good once); typed here it
-- becomes one character_link row in this file. Nothing runs on its own: no event, no toggle, no row until the
-- player types the command.
--
-- The row, in the shape the link endpoint takes: the code, your character's name, realm, race, class, level and
-- faction, its GUID and the completion module's key for it. The Everloot Desktop App, signed in with permission to
-- link characters, sends it to the account's own link endpoint (/api/me/characters/links) and nowhere else: an
-- upload never carries it, and the site's intake drops it. The server swaps the GUID for a keyed hash and keeps
-- nothing else of it (docs/design/specs/2026-10-28-owned-character-identity.md).
--
-- A link is a claim made from this file, not proof of who owns the character. A new code on the same character
-- replaces its older row. At most 10 rows are kept, the oldest going first; `/everloot link clear` deletes them.
-- Only your own character is read, through "player": never another unit.

local E = Everloot
local L = {}
E.Link = L

local MAX_ROWS = 10
local MAX_LEVEL = 60
local GUID = "^Player%-%d+%-[%dA-F]+$"   -- upper-case hex only, as the protocol requires
local RACE = "^%a+$"                       -- 2 to 24 letters, e.g. Scourge
local CLASS = "^%u+$"                      -- 3 to 16 capitals, e.g. HUNTER
local NAME = "^[%a\128-\255]+$"            -- letters only; accented letters are multi-byte, so 2 to 48 bytes
-- EL-, four characters, a hyphen and two more, from Crockford's base 32: no I, L, O or U.
local SYMBOL = "[%dA-HJKMNP-TV-Z]"
local CODE = "^EL%-" .. SYMBOL:rep(4) .. "%-" .. SYMBOL:rep(2) .. "$"

-- Every call this module makes to the game. A test scans the source against this list.
L.API = { "UnitGUID", "UnitName", "UnitLevel", "UnitRace", "UnitClass", "UnitFactionGroup", "GetRealmName" }

local function rows()
  local list = EverlootDB.records.character_link
  if not list then list = {}; EverlootDB.records.character_link = list end
  return list
end

local function token(value, pattern, min, max)
  return type(value) == "string" and #value >= min and #value <= max and value:find(pattern) ~= nil
end

--- Same rule as the protocol's validRealm, in bytes: letters, digits, spaces, apostrophes, hyphens.
local function realmOf(value)
  if type(value) ~= "string" then return nil end
  value = value:gsub("^%s+", ""):gsub("%s+$", "")
  if #value < 2 or #value > 40 or not value:find("^[%w\128-\255][%w\128-\255 '%-]*$") then return nil end
  return value
end

local function hex8(n)
  return string.format("%04x%04x", math.floor(n / 65536) % 65536, n % 65536)
end

--- "character_link:<n>". The number only goes up, and holds nothing about the character.
local function eventId()
  local n = (tonumber(EverlootDB.linkNext) or 0) + 1
  EverlootDB.linkNext = n
  return "character_link:" .. string.format("%.0f", n)
end

--- The character you are playing, as the row needs it, or nil and what is missing.
local function own()
  local guid = E.Readable(UnitGUID("player"))
  if type(guid) ~= "string" or not guid:find(GUID) then return nil, "the game did not give your character's id" end
  local name = E.Readable(UnitName("player"))
  if not token(name, NAME, 2, 48) then return nil, "the game did not give your character's name" end
  local realm = realmOf(E.Readable(GetRealmName()))
  if not realm then return nil, "the game did not give your realm" end
  local race = E.Readable((select(2, UnitRace("player"))))
  local class = E.Readable((select(2, UnitClass("player"))))
  if not token(race, RACE, 2, 24) or not token(class, CLASS, 3, 16) then return nil, "the game did not give your race and class" end
  local level = E.Readable(UnitLevel("player"))
  if type(level) ~= "number" or level < 1 or level > MAX_LEVEL then return nil, "the game did not give your level" end
  local faction = E.Readable((UnitFactionGroup("player")))
  if faction ~= "Alliance" and faction ~= "Horde" then return nil, "a character needs a faction, Alliance or Horde, to be linked" end
  -- The completion module's key for this character (completion.lua, C.Identity), so its rows can be joined later.
  local completionKey = hex8(E.Adler32((EverlootDB.installId or "") .. ":" .. guid))
  return { name = name, realm = realm, race = race, class = class, level = math.floor(level), faction = faction, guid = guid, completionKey = completionKey }
end

--- Writes the row for `code` on the character you are playing. True, or false and why not.
function L.Write(code)
  code = type(code) == "string" and code:upper():gsub("^%s+", ""):gsub("%s+$", "") or ""
  if not code:find(CODE) then return false, "that is not a link code. Codes look like EL-7K3Q-9P; make one on everloot.app/account" end
  local me, why = own()
  if not me then return false, why end
  local list = rows()
  -- An older code on this character is spent or expired by now: the newest replaces it.
  for i = #list, 1, -1 do
    if list[i].guid == me.guid then table.remove(list, i) end
  end
  me.installId = EverlootDB.installId
  me.eventId = eventId()
  me.capturedAt = date("!%Y-%m-%dT%H:%M:%SZ")
  me.code = code
  list[#list + 1] = me
  while #list > MAX_ROWS do table.remove(list, 1) end
  return true, me
end

--- /everloot link clear: delete every link row in this file.
function L.Clear()
  EverlootDB.records.character_link = nil
end

--- `/everloot link`, `/everloot link <code>` and `/everloot link clear`.
function L.Command(arg)
  arg = type(arg) == "string" and arg:gsub("^%s+", ""):gsub("%s+$", "") or ""
  if arg == "" then
    print(string.format("Everloot: /everloot link <code> links this character to your everloot.app account. Make the code on everloot.app/account; it works for 15 minutes. %d link %s in this file; /everloot link clear deletes them.",
      E:Count("character_link"), E:Count("character_link") == 1 and "row" or "rows"))
  elseif arg:lower() == "clear" then
    L.Clear()
    print("Everloot: every link row was deleted from this file.")
  else
    local ok, result = L.Write(arg)
    if not ok then
      print("Everloot: not linked: " .. result .. ".")
    else
      print(string.format("Everloot: %s of %s is ready to link with %s. Type /reload so the game saves it; the Everloot Desktop App, signed in to your account, then sends it.",
        result.name, result.realm, result.code))
    end
  end
end
