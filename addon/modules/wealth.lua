-- Everloot lifetime gold for WoW: Forever: the logged-in character's own Wealth and auction statistics.
-- Runs with the gold switch (Settings, "Your gold") and under the character key every module shares (core.lua).
--
--   wealth_owned      one row per character key: stats = { ["328"] = copper, ... }, the statistic ids below that the
--                     game could read. Latest state only: each read replaces this character's row.
-- Copper: 328 total acquired, 333 looted, 326 quest rewards, 921 vendors, 919 auctions earned, 334 most ever owned,
-- 331 most expensive bid, 332 most expensive sale, 1146 travel, 1147 barber shops, 1148 postage, 1150 talent respecs.
-- Counts: 329 auctions posted, 330 auction purchases, 1149 talent respecs.
--
-- Only the logged-in character is read; no name, realm or other player. A statistic the game cannot give (nil, "--",
-- text that is not a number or coins, an error, a value the client hides) is left out, never written as 0, and nothing
-- is read in combat. wealth_owned is never in an upload (web/src/lib/upload-batches.ts LOCAL_ONLY_KINDS); the Everloot
-- Desktop App sends a linked character's row through private sync, where everloot.app keeps it only if the player
-- switched gold on.
--
-- Calls (mainline API; Forever loads the mainline UI). Not yet checked in game:
--   GetStatistic(id)   the text the achievement window shows: a count ("1,077") or coins
--                      ("115|TInterface\MoneyFrame\UI-GoldIcon:0:0:2:0|t 9|T...SilverIcon...|t 5|T...CopperIcon...|t")

local E = Everloot
local W = {}
E.Wealth = W

W.KINDS = { "wealth_owned" }
W.IDS = { 328, 333, 326, 921, 919, 334, 331, 332, 1146, 1147, 1148, 1150, 329, 330, 1149 }

local MAX = 9007199254740991 -- 2^53 - 1, the largest whole number the site keeps exactly
local LOGIN_SECONDS, MONEY_SECONDS, COMBAT_RETRY_SECONDS = 10, 30, 15
local COINS = { GoldIcon = 10000, SilverIcon = 100, CopperIcon = 1 }

local state = { combat = false, pending = false, waiting = false }

local function valid(n)
  return n and n >= 0 and n <= MAX and n == math.floor(n) and n or nil
end

--- A count with optional group separators (",", ".", a space or a no-break space): the first group 1-3 digits, each
--- after a separator exactly 3. "1.5" is nil, never 15.
local function count(text)
  text = text:gsub("\194\160", " ")
  if text:find("^%d+$") then return valid(tonumber(text)) end
  if not text:find("^%d%d?%d?[,%. ]%d%d%d") then return nil end
  local rest = text:gsub("^%d%d?%d?", "")
  while rest ~= "" do
    local tail = rest:match("^[,%. ]%d%d%d(.*)$")
    if not tail then return nil end
    rest = tail
  end
  return valid(tonumber((text:gsub("%D", ""))))
end

--- The number a GetStatistic text shows, in copper for coins, or nil when it shows none.
function W.ParseStatistic(text)
  text = E.Readable(text)
  if type(text) ~= "string" then return nil end
  text = text:gsub("^%s+", ""):gsub("%s+$", "")
  if text == "" or text == "--" then return nil end
  if not text:find("|T", 1, true) then return count(text) end
  local total, seen, rest = 0, {}, text
  while rest ~= "" do
    local digits, texture, tail = rest:match("^([^|]+)|T([^|]*)|t%s*(.*)$")
    if not digits then return nil end
    local n = count((digits:gsub("%s+$", "")))
    local unit = texture:match("(%a+Icon)")
    if not n or not COINS[unit] or seen[unit] then return nil end
    seen[unit] = true
    total = total + n * COINS[unit]
    rest = tail
  end
  return valid(total)
end

--- In combat from PLAYER_REGEN_DISABLED until PLAYER_REGEN_ENABLED, or while the lockdown says so.
local function inCombat()
  return state.combat or (type(InCombatLockdown) == "function" and InCombatLockdown() and true or false)
end

--- Read every statistic and replace this character's row. True when a row was written.
function W.Read()
  if not E:IsEnabled("gold") or inCombat() then return false end
  local key, class, level = E.CharacterKey()
  if not key then return false end
  local stats, any = {}, false
  for _, id in ipairs(W.IDS) do
    local ok, value = pcall(GetStatistic, id)
    local n = ok and W.ParseStatistic(value) or nil
    if n then stats[tostring(id)] = n; any = true end
  end
  if not any then return false end
  local kept = {}
  for _, row in ipairs(EverlootDB.records.wealth_owned or {}) do
    if type(row) == "table" and row.characterKey ~= key then kept[#kept + 1] = row end
  end
  EverlootDB.records.wealth_owned = kept
  return E:Store("wealth_owned", {
    characterKey = key, class = class, level = level, capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    installId = EverlootDB.installId, stats = stats,
  })
end

local retry

--- A due read: now, or after the fight.
local function attempt()
  state.pending = false
  if not E:IsEnabled("gold") then return end
  if inCombat() then
    if not state.waiting then state.waiting = true; C_Timer.After(COMBAT_RETRY_SECONDS, retry) end
    return
  end
  pcall(W.Read)
end

--- The end of combat and the retry timer both call this; only the first one reads.
retry = function()
  if not state.waiting then return end
  state.waiting = false
  attempt()
end

local function schedule(delay)
  if state.pending or state.waiting then return end
  state.pending = true
  C_Timer.After(delay, attempt)
end

--- The gold switch turned off: delete every row this module wrote.
function W.Withdraw()
  for _, kind in ipairs(W.KINDS) do
    EverlootDB.records[kind] = nil
    if EverlootDB.paused then EverlootDB.paused[kind] = nil end
  end
end

E:RegisterModule("wealth", function()
  if type(GetStatistic) ~= "function" then error("missing GetStatistic, records nothing", 0) end
  if not (C_Timer and type(C_Timer.After) == "function") then error("missing C_Timer.After, records nothing", 0) end
  local f = E.frame
  local watched = {}
  for _, event in ipairs({ "PLAYER_ENTERING_WORLD", "PLAYER_MONEY", "PLAYER_LOGOUT", "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED" }) do
    if pcall(function() f:RegisterEvent(event) end) then watched[event] = true end
  end
  f:HookScript("OnEvent", function(_, event)
    if not watched[event] then return end
    if event == "PLAYER_REGEN_DISABLED" or event == "PLAYER_REGEN_ENABLED" then
      state.combat = event == "PLAYER_REGEN_DISABLED"
      if not state.combat and state.waiting then C_Timer.After(0, retry) end
      return
    end
    if not E:IsEnabled("gold") then return end
    if event == "PLAYER_ENTERING_WORLD" then schedule(LOGIN_SECONDS)
    elseif event == "PLAYER_MONEY" then schedule(MONEY_SECONDS)
    elseif event == "PLAYER_LOGOUT" then pcall(W.Read) end
  end)
  return "ready: your lifetime gold statistics; kept on this computer; never in an upload; the Everloot Desktop App sends a linked character's row and everloot.app keeps it only if you switched gold on"
end, "gold")
