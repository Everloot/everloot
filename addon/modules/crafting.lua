-- The crafting calculator the native profession window and the window's Crafting costs page share: one quote policy
-- and one profit calculation. Display only: it registers no events and records nothing.
-- Profit and margin are per craft; Sale computes totals with rounding for the requested craft count.
--   Everloot.Crafting.Context(realm, house, options) -> the lookups for one refresh, each item looked up once.
--     options.scan: let a fresh scan of this house (under a day old, not older than the community day) price items.
--     options.oldFile: the price file is old, so every community quote is old.
--     options.destination: 'ah' (default; the house's own cut) or 'vendor' (the client's sell price, no cut).
--     options.source, options.fallback: the auction price source (crafting_sources.lua), else the player's choice.
--     context.priceSource = { name, label, fallback, available, reason }. An estimate keeps it, and marks external
--     prices (external, unknownAge), fallback prices (fallback = why) and prices the source lacked (missing = why).
--   Everloot.Crafting.Evaluate(recipe, context, crafts) -> one recipe's estimate. A missing price stays unknown.
--     profit, margin, saleGross and cutCopper follow the context's destination; ahProfit and vendorProfit are both
--     kept for Details.
--   Everloot.Crafting.Sale(estimate, crafts[, destination]) -> sale, cut, profit for that many crafts, rounded once.
--   Everloot.Crafting.Plan(recipe, context, crafts, options) -> CraftingPlan.Resolve's plan for that many crafts of one
--     recipe: options = { strategy = 'buy'|'cheapest', owned, known, noCooldown }. known defaults to this character's
--     proven recipes; the cooldown evidence defaults to CooldownEvidence() and this character's current reads.
--     nil when the planner is not loaded.
--   Everloot.Crafting.PlanOptions(characterKey, strategy) -> Resolve's options with that default evidence.
--   Everloot.Crafting.CooldownEvidence() -> what the client cooldown data (recipe_cooldown_data.lua) says for the
--     running build: { status = 'match'|'mismatch'|'unknown build'|'missing', build, running, noCooldown, limited,
--     basis, disclosure }. noCooldown is filled only on an exact build match.
--   Everloot.Crafting.PlanSale(estimate, crafts, cost[, destination]) -> sale, cut, profit for that many crafts with a
--     plan's material cost; profit is nil when the cost is.
--   Everloot.Crafting.VendorSell(itemId) -> the client's vendor sell price for one unit, or nil (and true while the
--     client is still loading the item).
--   Everloot.Crafting.Ranked(recipes, context, options) -> estimates in order; Rank(estimates, options) orders
--     estimates already evaluated. options = { sort = 'profit'|'name', profitableOnly }. Profit per craft first,
--     unknown profit last and never profitable; ties by name, then recipe ID.
--   Everloot.Crafting.Tag(estimate, mode, checking) -> the short signed text of a recipe row ('money'|'margin'|'both').
--   Everloot.Crafting.TrainerEstimate(service, context) -> a trainer recipe's estimate and training payback, or nil and
--     why. service = { spellId, trainingCostCopper[, name] }: the recipe's exact spell ID, never an item ID or a name.
--   Everloot.Crafting.BreakEven(recipe, itemId, context, crafts[, options]) -> the highest whole unit price of one bought
--     material that keeps the profit for that many crafts at or above zero, other materials at their quotes, through
--     Sale's rounding, cut and destination; or nil and why.
--   Everloot.Crafting.NativeEnabled() -> whether the profession window shows Everloot's estimates, and why.

local E = Everloot
local C = {}
E.Crafting = C

-- What the calculator reads, indexed once and then only for the rows stored since, as prices.lua indexes its own
-- rows: the newest reagent list of each known recipe and every item id this install saw for each item name (recipes
-- name their reagents, prices are by item id; a name seen with two ids is ambiguous and gets no price). A kind with
-- fewer rows than were read was cleared, and everything is read again. Vendor rows are not read: their price is the
-- merchant's offer, which names no purchase quantity or extra cost, so it is not a unit price. Vendor quotes come only
-- from this install's own unit evidence (openworld.lua, EverlootDB.vendorUnitPrices).
local index
local function resetIndex() index = { recipes = {}, ids = {}, names = {}, read = {} } end
resetIndex()

local INDEX_ROWS = {
  recipe_observed = function(r)
    if r.learned == false or type(r.profession) ~= "string" or type(r.recipe) ~= "string" or type(r.reagents) ~= "table" then return end
    local reagents = {}
    for _, g in ipairs(r.reagents) do
      if type(g) == "table" and type(g.item) == "string" and type(g.count) == "number" and g.count >= 1 then
        reagents[#reagents + 1] = { item = g.item, count = g.count }
      end
    end
    -- A recipe whose slot takes several items is stored without reagents (professions.lua): it has no cost here.
    if #reagents == 0 then return end
    local key = r.profession .. "|" .. tostring(r.recipeId ~= nil and r.recipeId or r.recipe)
    index.recipes[key] = { key = key, profession = r.profession, name = r.recipe, reagents = reagents, id = r.recipeId,
      product = type(r.productItemId) == "number" and r.productItemId or nil }
  end,
  item_seen = function(r)
    if type(r.itemId) ~= "number" or type(r.name) ~= "string" or r.name == "" then return end
    local ids = index.ids[r.name] or { n = 0 }
    if not ids[r.itemId] then ids[r.itemId] = true; ids.n = ids.n + 1; ids.id = r.itemId end
    index.ids[r.name] = ids
    index.names[r.itemId] = index.names[r.itemId] or r.name
  end,
}

--- The latest unit price a merchant asked this character for exactly one of the item with no other cost, or nil.
--- openworld.lua keeps it per character with when it was seen and the client build: it counts only for the current
--- character, on the build it was seen on, from the last VENDOR_UNIT_DAYS days and never from the future. A price with
--- no owner, time or build proves nothing.
local VENDOR_UNIT_DAYS = 14
C.VENDOR_UNIT_DAYS = VENDOR_UNIT_DAYS
local function vendorUnit(itemId)
  local units = type(EverlootDB) == "table" and EverlootDB.vendorUnitPrices
  local key = E.CharacterKey and E.CharacterKey()
  local build = type(EverlootDB) == "table" and EverlootDB.clientBuild
  local mine = type(units) == "table" and type(key) == "string" and units[key]
  local entry = type(mine) == "table" and mine[itemId]
  if type(entry) ~= "table" or type(build) ~= "string" or entry.build ~= build then return nil end
  local unit, at, now = entry.copper, entry.at, time()
  if type(unit) ~= "number" or unit < 1 or unit % 1 ~= 0 or unit >= math.huge then return nil end
  if type(at) ~= "number" or at > now or now - at > VENDOR_UNIT_DAYS * 86400 then return nil end
  return unit
end

local function indexRows()
  for kind in pairs(INDEX_ROWS) do
    if #E:Rows(kind) < (index.read[kind] or 0) then resetIndex(); break end
  end
  for kind, each in pairs(INDEX_ROWS) do
    local rows = E:Rows(kind)
    for i = (index.read[kind] or 0) + 1, #rows do
      if type(rows[i]) == "table" then each(rows[i]) end
    end
    index.read[kind] = #rows
  end
end

--- Every recipe this install recorded with its reagents, by "profession|recipe id or name". Read only.
function C.Recipes()
  indexRows()
  return index.recipes
end

-- A recent scan of this house only; anything else leaves the community quotes.
local function freshScan(realm, house)
  local own = house and E.OwnScan and E:OwnScan(realm, house)
  local age = own and type(own.at) == "number" and time() - own.at
  if not age or age < 0 or age > 86400 or own.house ~= house or not own.items then return nil end
  return own
end

-- One refresh's prices, each item looked up once: the price file's market value (or a fresh scan of this house, when
-- asked), or this install's lowest verified merchant unit price when that is lower or the only one. A reagent named by a recipe
-- gets its id from this install's item rows, else from the client when it has the item loaded. A name this install saw
-- with two ids stays ambiguous: the client's lookup by name would only pick one of them.
local AMBIGUOUS = "ambiguous"
local Context = {}
Context.__index = Context

-- The auction price source for one context (crafting_sources.lua): options.source and options.fallback, else the
-- player's choice. An external source is checked once per context; whether it can price anything is said, never
-- swapped for another source unless the player turned the fallback on.
local function priceSource(options)
  local CS = E.CraftingSources
  local name, fallback = options.source, options.fallback
  if name == nil and CS then name, fallback = CS.Choice() end
  if not (CS and CS.Valid(name)) then name = "everloot" end
  local state = { name = name, fallback = name ~= "everloot" and fallback == true, available = true }
  if name ~= "everloot" then state.available, state.reason = CS.Available(name) end
  state.label = CS and CS.Label(name) or "Everloot"
  return state
end

function C.Context(realm, house, options)
  indexRows()
  options = options or {}
  return setmetatable({
    realm = realm, house = house, own = options.scan and freshScan(realm, house) or nil, oldFile = options.oldFile,
    cut = E.SellCheck and math.floor(E.SellCheck.Cut(house) * 100 + 0.5) or 5,
    destination = options.destination == "vendor" and "vendor" or "ah",
    priceSource = priceSource(options),
    ids = {}, quotes = {}, community = {}, sell = {}, external = {}, fellBack = {}, missing = {},
  }, Context)
end

--- What a vendor pays for one unit: the sell price C_Item.GetItemInfo returns as its 11th value. Never the price a
--- vendor asked this install for (a purchase price). It returns nothing until the client has loaded the item: then
--- the load is requested and the second value is true, so the caller can look again. 0 is an item vendors don't buy.
function C.VendorSell(itemId)
  local info = type(C_Item) == "table" and C_Item.GetItemInfo
  if type(info) ~= "function" or type(itemId) ~= "number" then return nil end
  local result = { pcall(info, itemId) }
  if not result[1] then return nil end
  if result[2] == nil then
    if C_Item.RequestLoadItemDataByID then pcall(C_Item.RequestLoadItemDataByID, itemId) end
    return nil, true
  end
  local sell = E.Readable(result[12])
  if type(sell) == "number" and sell > 0 and sell % 1 == 0 then return sell end
end

--- The vendor sell price of an item, looked up once per context. While the client loads an item that the vendor
--- destination needs, context.pending is true.
function Context:VendorSell(itemId)
  local sell = self.sell
  if sell[itemId] == nil then
    local unit, pending = C.VendorSell(itemId)
    sell[itemId] = unit or (pending and "pending") or false
    if pending and self.destination == "vendor" then self.pending = true end
  end
  if sell[itemId] == "pending" then return nil, true end
  return sell[itemId] or nil
end

--- The item id for a reagent name, or nil and true when the name is ambiguous.
function Context:Id(name)
  local ids = self.ids
  if ids[name] == nil then
    local seen = index.ids[name]
    if seen and seen.n > 1 then ids[name] = AMBIGUOUS
    else ids[name] = seen and seen.id or (E.ItemIdFrom and E.ItemIdFrom(name)) or false end
  end
  if ids[name] == AMBIGUOUS then return nil, true end
  return ids[name] or nil
end

--- An item's name for a plan's lists: the client's when it has the item, else the name this install saw it with.
function Context:Name(itemId)
  local get = type(C_Item) == "table" and C_Item.GetItemNameByID
  if type(get) == "function" then
    local ok, name = pcall(get, itemId)
    name = ok and E.Readable(name) or nil
    if type(name) == "string" and name ~= "" then return name end
  end
  return index.names[itemId]
end

--- The community price row for an item on this realm, or nil.
function Context:Community(itemId)
  local community = self.community
  if community[itemId] == nil then
    community[itemId] = self.realm and E.CommunityPrice and E:CommunityPrice(self.realm, itemId, self.house) or false
  end
  return community[itemId] or nil
end

--- An item's auction value: unit, source ("scan", "community", "auctionator" or "tsm") and the community day, or
--- nil. With an external source selected, its price only; where it gives none, nil (the reason in missing[itemId]),
--- or with the player's fallback Everloot's value with the reason in fellBack[itemId]. External quotes stay in this
--- context.
function Context:Market(itemId)
  local ps = self.priceSource
  if ps and ps.name ~= "everloot" then
    local q = self.external[itemId]
    if q == nil then
      local why
      if ps.available then q, why = E.CraftingSources.Quote(ps.name, itemId, self.realm, self.house)
      else why = ps.reason end
      if not q then self.missing[itemId] = why or "no price"; q = false end
      self.external[itemId] = q
    end
    if q then return q.unit, q.source end
    if not ps.fallback then return nil end
    local unit, source, observed = self:EverlootMarket(itemId)
    if unit then self.fellBack[itemId] = self.missing[itemId] end
    return unit, source, observed
  end
  return self:EverlootMarket(itemId)
end

--- Everloot's own auction value: a fresh scan of this house, else the community day's market value.
function Context:EverlootMarket(itemId)
  local row = self:Community(itemId)
  local own = self.own
  local listing = own and own.items[itemId]
  local observed = listing and row and E.DayNumber(row.day)
  -- Community observations are dated to the day. Prefer a recent own scan on that day or later.
  if listing and type(listing[5]) == "number" and listing[5] > 0
    and (not observed or math.floor(own.at / 86400) >= observed) then
    return listing[5], "scan"
  end
  if row and row.market then return row.market, "community", row.day end
end

--- What one unit costs to buy: { unit, source, observed, vendor }, or nil when there is no price.
function Context:Quote(itemId)
  local quotes = self.quotes
  if quotes[itemId] == nil then
    local market, source, observed = self:Market(itemId)
    local vendor = vendorUnit(itemId)
    if vendor and (not market or vendor < market) then quotes[itemId] = { unit = vendor, vendor = true }
    elseif market then quotes[itemId] = { unit = market, source = source, observed = observed, vendor = false }
    else quotes[itemId] = false end
  end
  return quotes[itemId] or nil
end

--- Sale, auction cut and profit for `crafts` crafts: the copper is rounded once, for the whole count. The destination
--- is the estimate's own unless another is asked for; a vendor takes no cut.
function C.Sale(estimate, crafts, destination)
  if (destination or estimate.destination) == "vendor" then
    local sale = math.floor(estimate.vendorValue * estimate.yield * crafts)
    return sale, 0, sale - estimate.cost * crafts
  end
  local sale = math.floor(estimate.value * estimate.yield * crafts)
  local net = math.floor(sale * (100 - estimate.cut) / 100)
  return sale, sale - net, net - estimate.cost * crafts
end

--- The same sale and cut for `crafts` crafts, against a plan's total material cost (already for every craft). nil when
--- the destination has no price for the finished item; profit nil when the plan has no cost.
function C.PlanSale(estimate, crafts, cost, destination)
  local vendor = (destination or estimate.destination) == "vendor"
  local unit = vendor and estimate.vendorValue or (not vendor and estimate.value)
  if not unit or estimate.yieldUnknown then return nil end
  local sale = math.floor(unit * estimate.yield * crafts)
  local net = vendor and sale or math.floor(sale * (100 - estimate.cut) / 100)
  return sale, sale - net, cost and (net - cost) or nil
end

-- An output that pins the product: its item, and a whole minimum and maximum of at least one.
local function knownOutput(output, product)
  local function whole(n) return type(n) == "number" and n >= 1 and n % 1 == 0 and n < math.huge end
  return type(output) == "table" and output.itemId ~= nil and output.itemId == product and whole(output.minimum)
    and whole(output.maximum) and output.minimum <= output.maximum
end

--- A recipe as the planner reads it, by item IDs only: reagents is nil when any reagent has no single item ID (an
--- ambiguous name, a slot several items fill, an unreadable slot), so the route stays unknown rather than cheaper.
function C.PlanRecipe(recipe, context)
  local reagents = {}
  for _, g in ipairs(type(recipe.reagents) == "table" and recipe.reagents or {}) do
    local id, ambiguous = g.id, g.ambiguous
    if not id and not ambiguous then id, ambiguous = context:Id(g.item) end
    if ambiguous or type(id) ~= "number" or type(g.count) ~= "number" then reagents = nil; break end
    reagents[#reagents + 1] = { itemId = id, count = g.count }
  end
  local output = recipe.output
  if not recipe.live then output = recipe.id and EverlootDB.recipeOutput and EverlootDB.recipeOutput[recipe.id] end
  local out = { reagents = reagents }
  if knownOutput(output, recipe.product) then
    out.itemId, out.minimum, out.maximum = output.itemId, output.minimum, output.maximum
  end
  return out
end

-- The running client's version and build, as the data files stamp it ("1.60.1.71139"), or nil.
local function runningBuild()
  if type(GetBuildInfo) ~= "function" then return nil end
  local ok, version, build = pcall(GetBuildInfo)
  version, build = ok and E.Readable(version), ok and E.Readable(build)
  if type(version) ~= "string" or (type(build) ~= "string" and type(build) ~= "number") then return nil end
  return version .. "." .. tostring(build)
end

local evidence
function C.CooldownEvidence()
  local data, running = E.RECIPE_COOLDOWNS, runningBuild()
  if evidence and evidence.data == data and evidence.running == running then return evidence end
  local out = { data = data, running = running, noCooldown = {}, limited = {} }
  if type(data) ~= "table" or type(data.covered) ~= "table" or type(data.limited) ~= "table" or type(data.build) ~= "string" then
    out.status = "missing"
  else
    out.build = data.build
    -- A recorded cooldown makes a recipe limited on any build: that only ever withholds a route.
    for id, entry in pairs(data.limited) do
      if type(id) == "number" and type(entry) == "table" then out.limited[id] = { ms = entry.ms, category = entry.category } end
    end
    if not running then out.status = "unknown build"
    elseif running ~= data.build then out.status = "mismatch"
    else
      out.status = "match"
      for _, id in ipairs(data.covered) do
        if type(id) == "number" and not out.limited[id] then out.noCooldown[id] = true end
      end
    end
    local hidden = type(data.encrypted) == "table" and data.encrypted or {}
    out.basis = "No cooldown recorded in client data, build " .. data.build
    out.disclosure = "From the game files of build " .. data.build .. ": " .. tostring(hidden.SpellCooldowns or "?")
      .. " SpellCooldowns and " .. tostring(hidden.SpellCategories or "?") .. " SpellCategories blocks could not be read,"
      .. " and server changes are not in the files. Not a guarantee the craft is available."
  end
  evidence = out
  return out
end

-- Why a recipe without a recorded limit cannot count, for the plan's exclusions.
local DETAIL = { mismatch = "data for another build", ["unknown build"] = "client build unknown", missing = "no cooldown data",
  match = "not in client cooldown data" }

--- Resolve's default evidence for one character: the build-matched client cooldown data and that character's own
--- current cooldown reads (none for any other character). Recipe plans pass their owner's key.
function C.PlanOptions(characterKey, strategy)
  local ev = C.CooldownEvidence()
  return {
    strategy = strategy,
    noCooldown = ev.noCooldown,
    limited = ev.limited,
    capacityDetail = DETAIL[ev.status],
    noCooldownBasis = ev.basis,
    -- Only this character's own open window for that profession: never a saved or closed-window read.
    readCooldown = E.CurrentRecipeCooldown and function(r)
      return E.CurrentRecipeCooldown(characterKey, r.professionId, r.recipeId)
    end or nil,
  }
end

function C.Plan(recipe, context, crafts, options)
  local CP = E.CraftingPlan
  if not CP then return nil end
  options = options or {}
  local key = E.CharacterKey and E.CharacterKey() or nil
  local known = options.known or CP.Known(key)
  local id = type(recipe.id) == "number" and recipe.id or nil
  local resolve = C.PlanOptions(key, options.strategy)
  if options.noCooldown then resolve.noCooldown = options.noCooldown end
  return CP.Resolve({ { recipeId = id, crafts = crafts, recipe = C.PlanRecipe(recipe, context) } }, context, known,
    options.owned or {}, resolve)
end

local function old(context, source, observed)
  return (E.StaleDay(observed) or (context.oldFile and source == "community")) and true or false
end

--- A recipe's material cost, item price and estimated profit per craft at the context's destination: after the
--- auction house cut, or at the vendor sell price.
function C.Evaluate(recipe, context, crafts)
  crafts = crafts or 1
  local out = { key = recipe.key, id = recipe.id, name = recipe.name, parts = {}, unpriced = 0, cut = context.cut,
    yield = 1, crafts = crafts, destination = context.destination }
  local output = recipe.output
  if not recipe.live then output = recipe.id and EverlootDB.recipeOutput and EverlootDB.recipeOutput[recipe.id] end
  if knownOutput(output, recipe.product) then
    out.output = output
    out.yield = (output.minimum + output.maximum) / 2
  end
  -- No output for the product (a stored row this install never saw make it, or the open window without one): the
  -- cost stands, the sale is unknown. One item is never assumed.
  out.yieldUnknown = not out.output or nil
  local cost = 0
  for _, g in ipairs(recipe.reagents) do
    local id, ambiguous = g.id, g.ambiguous
    if not id and not ambiguous then id, ambiguous = context:Id(g.item) end
    local q = id and context:Quote(id)
    out.parts[#out.parts + 1] = { item = g.item, id = id, count = g.count, unit = q and q.unit, vendor = q and q.vendor,
      ambiguous = ambiguous, source = q and q.source, observed = q and q.observed,
      fallback = q and not q.vendor and id and context.fellBack[id] or nil,
      missing = not q and id and context.missing[id] or nil }
    if q then cost = cost + q.unit * g.count else out.unpriced = out.unpriced + 1 end
  end
  if out.unpriced == 0 then out.cost = cost end
  if recipe.product then
    out.value, out.source, out.observed = context:Market(recipe.product)
    out.fallback = out.value and context.fellBack[recipe.product] or nil
    out.missing = not out.value and context.missing[recipe.product] or nil
    out.vendorValue, out.vendorPending = context:VendorSell(recipe.product)
  end
  -- Which source priced it: an external price has no known age or market; a fallback price says why.
  out.priceSource = context.priceSource
  local CS = E.CraftingSources
  local function externalSource(source) return CS and CS.External(source) or false end
  out.external = externalSource(out.source) or nil
  out.usedFallback = out.fallback and true or nil
  for _, part in ipairs(out.parts) do
    if not part.vendor and externalSource(part.source) then out.external = true end
    if part.fallback then out.usedFallback = true end
  end
  out.unknownAge = out.external
  if out.cost and out.output then
    if out.value then out.ahSale, out.ahCutCopper, out.ahProfit = C.Sale(out, 1, "ah") end
    if out.vendorValue then
      local sale, _, profit = C.Sale(out, 1, "vendor")
      out.vendorSale, out.vendorProfit = sale, profit
    end
  end
  local vendor = out.destination == "vendor"
  if vendor then
    out.profit, out.saleGross, out.cutCopper = out.vendorProfit, out.vendorSale, out.vendorSale and 0
  else
    out.profit, out.saleGross, out.cutCopper = out.ahProfit, out.ahSale, out.ahCutCopper
  end
  -- Net profit over materials cost; a craft that costs nothing has no margin.
  if out.profit and out.cost > 0 then out.margin = out.profit / out.cost end
  -- The client's sell price is current; an auction quote can be old.
  out.oldQuote = not vendor and old(context, out.source, out.observed)
  for _, part in ipairs(out.parts) do
    out.oldQuote = out.oldQuote or old(context, part.source, part.observed)
  end
  return out
end

--- The most one unit of a bought material can cost with `crafts` crafts still not losing money: every other material
--- at its quote, the sale, cut and destination exactly as Sale rounds them for that count. Every slot of that item
--- varies together. nil and why: "no count", "not an input" (no slot is that single item, or the recipe makes it),
--- "made" (the cheapest route crafts it from a recipe this character proved: its cost is not a buy price), "unpriced"
--- (another material has no quote or is ambiguous), "no sale price", "no yield" or "loss" (no price of 0 or more
--- breaks even). options go to Plan (known, noCooldown) for the made check.
function C.BreakEven(recipe, itemId, context, crafts, options)
  if type(crafts) ~= "number" or crafts < 1 or crafts % 1 ~= 0 then return nil, "no count" end
  local est = C.Evaluate(recipe, context, crafts)
  local count, other = 0, 0
  for _, part in ipairs(est.parts) do
    if part.id == itemId and not part.ambiguous then
      count = count + part.count
    elseif part.unit then
      other = other + part.unit * part.count
    else
      other = nil
      break
    end
  end
  if count == 0 or itemId == recipe.product then return nil, "not an input" end
  if not other then return nil, "unpriced" end
  local vendor = est.destination == "vendor"
  if not (vendor and est.vendorValue or (not vendor and est.value)) then return nil, "no sale price" end
  if est.yieldUnknown then return nil, "no yield" end
  local plan = C.Plan(recipe, context, crafts, { strategy = "cheapest", known = options and options.known,
    noCooldown = options and options.noCooldown })
  for _, d in ipairs(plan and plan.decisions or {}) do
    if d.itemId == itemId and type(d.made) == "number" and d.made > 0 then return nil, "made" end
  end
  -- Sale with the material at u: profit = net - (other + u * count) * crafts. net does not depend on u.
  local function profitAt(u)
    local probe = setmetatable({ cost = other + u * count }, { __index = est })
    local _, _, profit = C.Sale(probe, crafts)
    return profit
  end
  local _, _, atZero = C.Sale(setmetatable({ cost = other }, { __index = est }), crafts)
  if atZero < 0 then return nil, "loss" end
  local u = math.floor(atZero / (count * crafts))
  -- The same rounding decides: step to the exact edge if division ever lands one off.
  while u > 0 and profitAt(u) < 0 do u = u - 1 end
  while profitAt(u + 1) >= 0 do u = u + 1 end
  return u
end

-- Profit first, highest first; then the recipes whose product has no price, then those whose cost is unknown.
local function rankOf(r) return r.profit and 1 or (r.cost and 2 or 3) end
local function byNameThenId(a, b)
  local na, nb = a.name or "", b.name or ""
  if na ~= nb then return na < nb end
  local ia, ib = tonumber(a.id), tonumber(b.id)
  if ia and ib and ia ~= ib then return ia < ib end
  if (ia == nil) ~= (ib == nil) then return ia ~= nil end
  return tostring(a.key) < tostring(b.key)
end
local function byProfit(a, b)
  local ra, rb = rankOf(a), rankOf(b)
  if ra ~= rb then return ra < rb end
  if a.profit and a.profit ~= b.profit then return a.profit > b.profit end
  return byNameThenId(a, b)
end

--- Estimates already evaluated, in a new list: sorted, and with profitableOnly only those with a known gain.
function C.Rank(estimates, options)
  options = options or {}
  local out = {}
  for _, r in ipairs(estimates) do
    if not options.profitableOnly or (r.profit and r.profit > 0) then out[#out + 1] = r end
  end
  table.sort(out, options.sort == "name" and byNameThenId or byProfit)
  return out
end

--- Every recipe evaluated once for one craft with the same context, then ranked.
function C.Ranked(recipes, context, options)
  local all = {}
  for _, recipe in ipairs(recipes) do
    local estimate = C.Evaluate(recipe, context, 1)
    if options and options.tag then estimate.tag = C.Tag(estimate, options.tag) end
    all[#all + 1] = estimate
  end
  return C.Rank(all, options)
end

local function money(copper)
  local U = E.Window
  if U and U.MoneyShort then return U.MoneyShort(copper) end
  return tostring(copper) .. "c"
end

--- A recipe row's tag in words and signs, so it reads without colour: "+1g 20s", "-34s", "+18%", "no price",
--- "checking", and " old" after a figure from an old quote. A craft with no cost has no margin: the money is shown.
function C.Tag(estimate, mode, checking)
  local profit = estimate and estimate.profit
  if not profit then
    local loading = estimate and estimate.destination == "vendor" and estimate.vendorPending
    return (checking or loading) and "checking" or "no price"
  end
  local cash = (profit > 0 and "+" or "") .. money(profit)
  local margin = estimate.margin and string.format("%+d%%", math.floor(estimate.margin * 100 + 0.5))
  local text
  if mode == "margin" then text = margin or cash
  elseif mode == "both" then text = margin and (cash .. " " .. margin) or cash
  else text = cash end
  return estimate.oldQuote and (text .. " old") or text
end

--- What learning a trainer's recipe pays back: the schematic the client returns for exactly that spell ID
--- (C_TradeSkillUI.GetRecipeSchematic; the client can read it only while it has the recipe's profession data), one
--- craft priced with the context like every other estimate, and payback = ceil(training cost / profit) for a complete,
--- positive profit only. Returns { spellId, trainingCost, row, profit, payback, why } and why when there is no
--- payback: "unpriced" (a reagent, the item or the yield has no price), "zero", "loss" or "no cost" (training cost
--- unknown). nil and "no spell ID", "no schematic" or "other recipe" (the client answered for another recipe) when
--- there is no estimate. Reads only; a trainer offering is never recorded as a learned recipe.
function C.TrainerEstimate(service, context)
  local spellId = type(service) == "table" and E.Readable(service.spellId)
  if type(spellId) ~= "number" or spellId < 1 or spellId % 1 ~= 0 then return nil, "no spell ID" end
  local T = C_TradeSkillUI
  if type(T) ~= "table" or type(T.GetRecipeSchematic) ~= "function" or type(E.NativeRecipe) ~= "function" then
    return nil, "no schematic"
  end
  local ok, schematic = pcall(T.GetRecipeSchematic, spellId, false)
  schematic = ok and E.Readable(schematic) or nil
  if type(schematic) ~= "table" then return nil, "no schematic" end
  local answered = E.Readable(schematic.recipeID)
  if answered ~= nil and answered ~= spellId then return nil, "other recipe" end
  -- The client's own recipe info when it answers for this spell (name, gathering and recraft flags).
  local info
  if type(T.GetRecipeInfo) == "function" then
    local got, value = pcall(T.GetRecipeInfo, spellId)
    value = got and E.Readable(value)
    if type(value) == "table" and E.Readable(value.recipeID) == spellId then info = value end
  end
  local name = E.Readable(service.name)
  info = info or { recipeID = spellId, name = type(name) == "string" and name or nil }
  local recipe = E.NativeRecipe(info, schematic)
  if not recipe then return nil, "no schematic" end
  -- An unlearned trainer schematic can have its output before its inputs load. It is not evidence of a free craft.
  if type(recipe.reagents) ~= "table" or #recipe.reagents == 0 then return nil, "no materials" end
  local row = C.Evaluate(recipe, context, 1)
  local cost = E.Readable(service.trainingCostCopper)
  if type(cost) ~= "number" or cost < 0 or cost % 1 ~= 0 then cost = nil end
  local out = { spellId = spellId, trainingCost = cost, row = row, profit = row.profit }
  if not row.profit then out.why = "unpriced"
  elseif row.profit == 0 then out.why = "zero"
  elseif row.profit < 0 then out.why = "loss"
  elseif not cost then out.why = "no cost"
  else out.payback = math.ceil(cost / row.profit) end
  return out, out.why
end

--- Whether Everloot's estimates show in the profession and trainer windows: false, "recorder" while the Everloot window is off
--- (Collect data only); else this character's own choice; else off, "craftprofit", while CraftProfit is loaded.
function C.NativeEnabled()
  if E.Options and E.Options.NativeCrafting then return E.Options.NativeCrafting() end
  return E:IsEnabled("window"), E:IsEnabled("window") and "default" or "recorder"
end
