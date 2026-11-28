-- Where crafting estimates take auction prices from: Everloot's own (the default: a fresh scan of this house, else the
-- price file), or a price another installed addon hands out through its documented public call. Reads only: it
-- registers no events, starts no scan or search and keeps no price. A quote lives in the caller's context for one
-- refresh; only the player's choice is saved.
--   Everloot.CraftingSources.Available(name) -> true, how; or false and why: "not loaded", "documented price call
--     missing", "price source AHDBMedianBuyout not available", "API error", "unknown source".
--   Everloot.CraftingSources.Quote(name, itemId, realm, house) -> { unit, source, observed, scope, label } or nil and
--     why ("bad item", "no price", "invalid price", "item not recognised", "API error" or Available's reason).
--     Neither addon's call reports a price's age or the realm and faction it is for: observed and scope are then
--     "unknown", never the realm and house asked for. Everloot's quote keeps its real source ("scan" or "community"),
--     date and scope.
--   Everloot.CraftingSources.Choice() -> name, fallback; SetChoice(name, fallback) saves only those two.
--   Everloot.CraftingSources.Describe(state) -> one sentence on a context's source, or nil for Everloot; Short(state)
--     the same in a few words.
--
-- Documentation basis (neither adapter verified on Forever 1.60.1 / interface 16001):
--   Auctionator: author's Source/API/v1/README.md shipped with retail v327, whose TOC lacks interface 16001.
--     Current v354 documentation repository returns 404: https://github.com/TheMouseNest/Auctionator
--   TSM: archived official API documentation generated 2022-12-21, captured 2025-12-03:
--     https://web.archive.org/web/20251203084633id_/http://api.tradeskillmaster.com/addon/
--     Live https://api.tradeskillmaster.com/addon/ had an expired certificate at verification; never bypassed.
-- Both addons are absent from the Forever validation install and report unavailable (not loaded).
-- Runtime feature checks are required; these documentation versions do not verify current Forever compatibility.
-- The documented calls:
--   Auctionator: Auctionator.API.v1.GetAuctionPriceByItemID(callerID, itemID) -> "the last scanned price ... in
--     coppers, or nil if one wasn't found" (Source/API/v1/README.md). Nothing else of Auctionator is called.
--   TSM: TSM_API.IsCustomPriceValid(str), TSM_API.ToItemString(item) and TSM_API.GetCustomPriceValue(str, itemString)
--     -> copper or nil, error (TSM_API reference). The price source is AHDBMedianBuyout, named in TSM's Forever
--     release notes; it is used only while this TSM says it is valid.
-- Each call runs in pcall, and the functions are looked up at every use: an addon that is missing, changed or broken
-- makes that source unavailable with its reason, never another source.

local E = Everloot
local S = {}
E.CraftingSources = S

S.NAMES = { "everloot", "auctionator", "tsm" }
S.LABEL = { everloot = "Everloot", auctionator = "Auctionator", tsm = "TSM" }
S.CALLER = "Everloot"              -- Auctionator's callerID
S.TSM_PRICE = "AHDBMedianBuyout"   -- the TSM price source key
S.UNKNOWN = "unknown"
-- What each external price is, in a label's words.
S.BASIS = { auctionator = "Auctionator", tsm = "TSM " .. S.TSM_PRICE }

local KNOWN = { everloot = true, auctionator = true, tsm = true }

--- The source name for a value, or nil.
function S.Valid(name)
  return type(name) == "string" and KNOWN[name] and name or nil
end

function S.Label(name) return S.LABEL[name] or tostring(name) end

--- How a quote from an external source is shown: "TSM AHDBMedianBuyout, age and market unknown".
function S.QuoteLabel(name)
  return (S.BASIS[name] or S.Label(name)) .. ", age and market unknown"
end

--- True for an external source name.
function S.External(name) return name == "auctionator" or name == "tsm" end

-- Each adapter's documented functions, looked up now; nil and why when the addon or its call is missing.
local function auctionator()
  local A = _G.Auctionator
  if A == nil then return nil, "not loaded" end
  local api = type(A) == "table" and type(A.API) == "table" and A.API.v1
  if type(api) ~= "table" or type(api.GetAuctionPriceByItemID) ~= "function" then
    return nil, "documented price call missing"
  end
  return api
end

local function tsm()
  local T = _G.TSM_API
  if T == nil then return nil, "not loaded" end
  if type(T) ~= "table" or type(T.GetCustomPriceValue) ~= "function" or type(T.ToItemString) ~= "function"
    or type(T.IsCustomPriceValid) ~= "function" then
    return nil, "documented price call missing"
  end
  return T
end

function S.Available(name)
  if name == "everloot" then return true, "Everloot scans, price file and vendor prices" end
  if name == "auctionator" then
    local api, why = auctionator()
    if not api then return false, why end
    return true, "Auctionator.API.v1.GetAuctionPriceByItemID"
  end
  if name == "tsm" then
    local T, why = tsm()
    if not T then return false, why end
    local ok, valid = pcall(T.IsCustomPriceValid, S.TSM_PRICE)
    if not ok then return false, "API error" end
    if not E.Readable(valid) then return false, "price source " .. S.TSM_PRICE .. " not available" end
    return true, "TSM_API.GetCustomPriceValue(\"" .. S.TSM_PRICE .. "\")"
  end
  return false, "unknown source"
end

-- A price in whole copper, at least 1: anything else from another addon is not used.
local function copper(value)
  value = E.Readable(value)
  if type(value) ~= "number" or value ~= value or value < 1 or value == math.huge or value % 1 ~= 0 then return nil end
  return value
end

local function external(name, unit)
  return { unit = unit, source = name, observed = S.UNKNOWN, scope = S.UNKNOWN, label = S.QuoteLabel(name) }
end

function S.Quote(name, itemId, realm, house)
  if not S.Valid(name) then return nil, "unknown source" end
  if type(itemId) ~= "number" or itemId < 1 or itemId % 1 ~= 0 then return nil, "bad item" end
  if name == "everloot" then
    local C = E.Crafting
    if not (C and C.Context) then return nil, "no price" end
    local context = C.Context(realm, house, { scan = true, source = "everloot" })
    local unit, source, observed = context:Market(itemId)
    if not unit then return nil, "no price" end
    if source == "scan" then observed = context.own and context.own.at end
    return { unit = unit, source = source, observed = observed, scope = { realm = realm, house = house },
      label = source == "scan" and "your scan" or "community" }
  end
  local ok, why = S.Available(name)
  if not ok then return nil, why end
  local value
  if name == "auctionator" then
    local called, price = pcall(auctionator().GetAuctionPriceByItemID, S.CALLER, itemId)
    if not called then return nil, "API error" end
    value = price
  else
    local T = tsm()
    local converted, itemString = pcall(T.ToItemString, "item:" .. itemId)
    itemString = converted and E.Readable(itemString) or nil
    if type(itemString) ~= "string" or itemString == "" then return nil, converted and "item not recognised" or "API error" end
    local called, price, err = pcall(T.GetCustomPriceValue, S.TSM_PRICE, itemString)
    if not called or err ~= nil then return nil, "API error" end
    value = price
  end
  if value == nil then return nil, "no price" end
  -- A value the client will not let an addon read is a price that cannot be used, not a missing one.
  local unit = copper(value)
  if not unit then return nil, "invalid price" end
  return external(name, unit)
end

--- The player's choice: the source name and whether Everloot's prices fill in where it has none. A hand-edited or
--- unknown value reads as Everloot without fallback. Everloot has nothing to fall back from.
function S.Choice()
  local saved = type(EverlootDB) == "table" and EverlootDB.craftSource
  local name = type(saved) == "table" and S.Valid(saved.name) or "everloot"
  return name, name ~= "everloot" and type(saved) == "table" and saved.fallback == true
end

--- Saves the choice: the name and the fallback switch, nothing else.
function S.SetChoice(name, fallback)
  name = S.Valid(name) or "everloot"
  EverlootDB.craftSource = { name = name, fallback = name ~= "everloot" and fallback == true }
end

--- A context's price source in a few words, or nil for Everloot: "TSM AHDBMedianBuyout, age and market unknown",
--- "TSM unavailable (not loaded)", with ", else Everloot" when the fallback is on.
function S.Short(state)
  if type(state) ~= "table" or not S.External(state.name) then return nil end
  local said = state.available and S.QuoteLabel(state.name)
    or (S.Label(state.name) .. " unavailable (" .. tostring(state.reason) .. ")")
  return said .. (state.fallback and ", else Everloot" or "")
end

--- One sentence on a context's price source (context.priceSource), or nil for Everloot, whose lines are unchanged.
function S.Describe(state)
  if type(state) ~= "table" or not S.External(state.name) then return nil end
  local label = S.Label(state.name)
  local said
  if state.available then
    said = "Prices: " .. S.BASIS[state.name] .. " from the " .. label .. " addon; their age and realm or faction are unknown."
    said = said .. (state.fallback and " Items it has no price for use Everloot prices, marked as fallback."
      or " No Everloot fallback: items it has no price for stay unpriced.")
  else
    said = "Prices: " .. label .. " unavailable (" .. tostring(state.reason) .. ")."
    said = said .. (state.fallback and " Everloot prices are used, marked as fallback."
      or " No Everloot fallback: auction prices are unknown. Choose Everloot or turn on the fallback.")
  end
  return said .. " Your scans' depth and history are your own full scans only."
end
