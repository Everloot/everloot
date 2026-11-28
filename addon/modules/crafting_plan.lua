-- Everloot crafting plan: what the current character itself can craft, kept on this computer only.
-- EverlootDB.craftingKnown[characterKey][professionId] = {
--   complete = bool,   -- true only after a read that proved the whole profession; window reads never do
--   updatedAt = time(),
--   recipes = { [recipeId] = { recipeId, professionId, learned = true, itemId?, minimum?, maximum?,
--                              reagents? = { { itemId, count } }, available? = bool, cooldownCheckedAt? } },
-- }
-- Cooldown evidence also retains cooldownReturned, cooldown, isDayCooldown, charges and maxCharges.
-- cooldownLimited stays true once observed; a ready read must not erase a known cooldown restriction.
-- characterKey is E.CharacterKey(): opaque, per install and character. A call without one stores and returns
-- nothing; there is no shared or default key. Nothing here is a record: it is never stored with E:Store,
-- uploaded or joined to the install-wide recipe observations, which do not prove what a character learned.
-- professions.lua fills it from the player's own profession window.

local E = Everloot
local CP = {}
E.CraftingPlan = CP

local function whole(n)
  return type(n) == "number" and n >= 1 and n <= 9007199254740991 and n == math.floor(n)
end

local function validKey(key)
  return type(key) == "string" and #key == 8 and key:find("^%x+$") ~= nil
end

local function copyRecipe(professionId, r)
  local out = { recipeId = r.recipeId, professionId = professionId, learned = true }
  if whole(r.itemId) and whole(r.minimum) and whole(r.maximum) and r.minimum <= r.maximum then
    out.itemId, out.minimum, out.maximum = r.itemId, r.minimum, r.maximum
  end
  if type(r.reagents) == "table" then
    local reagents = {}
    for _, reagent in ipairs(r.reagents) do
      if type(reagent) ~= "table" or not whole(reagent.itemId) or not whole(reagent.count) then reagents = nil; break end
      reagents[#reagents + 1] = { itemId = reagent.itemId, count = reagent.count }
    end
    out.reagents = reagents
  end
  -- Availability is a fact only when a cooldown read succeeded; anything else stays unknown (nil).
  if type(r.cooldownCheckedAt) == "number" then
    out.cooldownCheckedAt = r.cooldownCheckedAt
    if type(r.available) == "boolean" then out.available = r.available end
    if type(r.cooldownReturned) == "boolean" then out.cooldownReturned = r.cooldownReturned end
    if type(r.isDayCooldown) == "boolean" then out.isDayCooldown = r.isDayCooldown end
    for _, field in ipairs({ "cooldown", "charges", "maxCharges" }) do
      local n = r[field]
      if type(n) == "number" and n >= 0 and n < math.huge then out[field] = n end
    end
  end
  if r.cooldownLimited == true then out.cooldownLimited = true end
  return out
end

--- The recipes this character is proven to know, by recipe ID, across its professions. Copies: editing them
--- changes nothing saved. An unknown character knows nothing.
function CP.Known(characterKey)
  local result = {}
  if not validKey(characterKey) then return result end
  local professions = EverlootDB and EverlootDB.craftingKnown and EverlootDB.craftingKnown[characterKey]
  for professionId, profession in pairs(type(professions) == "table" and professions or {}) do
    for recipeId, r in pairs(type(profession) == "table" and type(profession.recipes) == "table" and profession.recipes or {}) do
      if whole(recipeId) and type(r) == "table" and r.learned == true then
        result[recipeId] = copyRecipe(professionId, r)
      end
    end
  end
  return result
end

--- Record one profession's recipes for a character. Entries with learned exactly true are stored; entries with
--- learned exactly false remove that recipe; anything else is not evidence and changes nothing.
--- complete = true replaces the profession (recipes not listed are gone). Otherwise the read only adds and
--- removes what it explicitly proved, and the profession is no longer claimed complete. Returns true when stored.
function CP.ReplaceKnown(characterKey, professionId, recipes, complete)
  if not validKey(characterKey) or not whole(professionId) or type(recipes) ~= "table" or not EverlootDB then return false end
  EverlootDB.craftingKnown = EverlootDB.craftingKnown or {}
  local professions = EverlootDB.craftingKnown[characterKey] or {}
  local previous = professions[professionId]
  local kept = {}
  if complete ~= true and type(previous) == "table" and type(previous.recipes) == "table" then
    for recipeId, r in pairs(previous.recipes) do kept[recipeId] = r end
  end
  for _, r in pairs(recipes) do
    if type(r) == "table" and whole(r.recipeId) then
      if r.learned == true then
        local copied = copyRecipe(professionId, r)
        local old = type(previous) == "table" and type(previous.recipes) == "table" and previous.recipes[r.recipeId]
        if type(old) == "table" and old.cooldownLimited == true then copied.cooldownLimited = true end
        kept[r.recipeId] = copied
      elseif r.learned == false then
        kept[r.recipeId] = nil
      end
    end
  end
  professions[professionId] = { complete = complete == true, updatedAt = time and time() or nil, recipes = kept }
  EverlootDB.craftingKnown[characterKey] = professions
  if E.Shopping and E.Shopping.Invalidate then E.Shopping.Invalidate("recipes") end
  return true
end

-- Buy versus craft ----------------------------------------------------------------------------------------------
-- CP.Resolve(requests, context, known, owned, options) -> plan
--   requests: { { recipeId, crafts[, recipe] } }. crafts is a whole number; their sum is at most LIMITS.crafts.
--     recipe (optional) is the root's own definition by item IDs, { itemId, minimum, maximum, reagents =
--     { { itemId, count } } }, for a root the character has not proven (a native schematic or a public row). Without
--     it the root comes from known[recipeId]. Intermediates only ever come from known: recipes this character
--     itself proved, matched by recipe and item ID, never by name.
--   context: anything with :Quote(itemId) -> { unit } or nil (crafting.lua's Context). Flat unit quotes.
--   known: CP.Known(characterKey). owned: { [itemId] = count }; {} for a valuation, bag counts for shopping.
--   options: { strategy = 'buy' (default) | 'cheapest', noCooldown = { [recipeId] = true },
--     limited = { [recipeId] = { ms, category? } }, readCooldown = function(record) -> read | nil, why,
--     capacityDetail, noCooldownBasis, catalog = { { recipeId, itemId } } }. See CP.Capacity.
--     noCooldown: recipes with no cooldown recorded in build-matched client data (crafting.lua supplies it from
--     recipe_cooldown_data.lua); build-scoped evidence, not proof. limited: recipes the client data says have a
--     cooldown, with their shared category. readCooldown: a current GetRecipeCooldown read taken only in the
--     character's own open window for that profession (professions.lua, E.CurrentRecipeCooldown); nil when there is
--     none. capacityDetail says why a recipe outside noCooldown is unknown; noCooldownBasis labels plans that use one.
--     catalog only names recipes this character has not learned, as exclusions; it is never a route.
-- The plan: { strategy, purchases = { { id, item, count, unit?, vendor? } }, steps = { { recipeId, crafts } },
--   leftovers, possibleLeftovers, used, unpriced = { { id, count } }, exclusions = { { recipeId, itemId, reason,
--   detail? } }, limits = { { kind, ... } }, decisions = { { itemId, item, need, made, bought, recipeId?, crafts } },
--   omitted, assumed = { recipeId }, basis?, cost, cashCost, buyCost, complete, optimality, rejected? }.
--   assumed lists make steps that rely on noCooldown; basis is options.noCooldownBasis then.
--   cost: the economic valuation of the route chosen without stock. cashCost: what the purchases cost after owned
--   stock is used once. buyCost: the all-buy route. Any of them is nil when an input is unpriced; never zero.
--   Steps are in dependency order: an intermediate before anything that uses it. Leftovers are the guaranteed
--   surplus (minimum yield); possibleLeftovers the most a variable yield could leave. Neither lowers a cost.
-- 'cheapest' is a bounded search, not a proven optimum: per item it compares buying, and for each usable recipe
-- whole batches rounded down or up with any remainder bought, over the whole combined plan, a few passes, keeping
-- only strictly better complete routes (buy wins a tie; lower recipe IDs first). optimality says 'bounded'.
-- The 500-candidate bound counts recipes in breadth-first order of the items they make (recipe ID order within one
-- item), so near the bound a deeper item's recipes are the ones left out.
-- Capacity: a cooldown recipe is used only up to what a current read allows, shared by its cooldown category (or by
-- its profession when the category is unknown) across requested crafts and intermediates. A requested root over that
-- capacity keeps its valuation but makes the plan incomplete.

local LIMITS = { depth = 12, recipes = 500, purchases = 50, crafts = 9999, passes = 4 }
CP.LIMITS = LIMITS

local function reagentList(list)
  if type(list) ~= "table" then return nil end
  local out = {}
  for _, g in ipairs(list) do
    if type(g) ~= "table" or not whole(g.itemId) or not whole(g.count) then return nil end
    out[#out + 1] = { itemId = g.itemId, count = g.count }
  end
  return out
end

-- A cooldown the character's own reads saw (sticky), or one the client data records for the recipe. Either one
-- overrides a ready read and the absence of a recorded cooldown.
local function showsLimit(r, limited)
  return r.cooldownLimited == true or (r.cooldownReturned == true and ((type(r.cooldown) == "number" and r.cooldown > 0)
    or r.isDayCooldown == true or (type(r.maxCharges) == "number" and r.maxCharges > 0)))
    or (type(limited) == "table" and limited[r.recipeId] ~= nil)
end

-- Cooldown recipes that share a category share one capacity; without a known category, the whole profession does.
local function groupOf(r, limited)
  local data = type(limited) == "table" and limited[r.recipeId]
  if type(data) == "table" and whole(data.category) then return "category " .. data.category end
  return "profession " .. tostring(r.professionId)
end

local function countable(n) return n == nil or (type(n) == "number" and n >= 0 and n < math.huge) end

--- How many crafts of one character-proven recipe a plan may count on now: count, reason[, detail].
--- evidence = { noCooldown, limited, readCooldown, detail } (Resolve's options).
--- No limitation seen or recorded: unlimited when noCooldown lists it ('no cooldown recorded'), else 0 ('capacity',
--- with evidence.detail). A limitation: only a current read counts, never an older saved one. Charges when the read
--- has them; else one craft when it reads ready, which is Blizzard's nil cooldown or an explicit 0 ('ready');
--- otherwise 0 ('cooldown', with 'cooling', 'no charges', 'unreadable' or why there was no current read).
function CP.Capacity(r, evidence)
  evidence = evidence or {}
  if not showsLimit(r, evidence.limited) then
    if type(evidence.noCooldown) == "table" and evidence.noCooldown[r.recipeId] == true then
      return math.huge, "no cooldown recorded"
    end
    return 0, "capacity", evidence.detail
  end
  local read, why
  if type(evidence.readCooldown) == "function" then read, why = evidence.readCooldown(r) end
  if type(read) ~= "table" then return 0, "cooldown", why or "no current read" end
  if not (countable(read.cooldown) and countable(read.charges) and countable(read.maxCharges)) then
    return 0, "cooldown", "unreadable"
  end
  if read.maxCharges and read.maxCharges > 0 then
    if read.charges and read.charges >= 1 then return math.floor(read.charges), "charges" end
    return 0, "cooldown", "no charges"
  end
  if read.cooldown == nil or read.cooldown == 0 then return 1, "ready" end
  return 0, "cooldown", "cooling"
end

-- A capacity that comes from a current read of the recipe (a group's shared slot is set only by these).
local function currentRead(reason, detail)
  return reason == "charges" or reason == "ready" or detail == "cooling" or detail == "no charges"
end

local function itemName(id, context)
  local named = context and context.Name and context:Name(id)
  if type(named) == "string" and named ~= "" then return named end
  local get = type(C_Item) == "table" and C_Item.GetItemNameByID
  if type(get) ~= "function" then return "Item " .. id end
  local ok, name = pcall(get, id)
  name = ok and E.Readable(name) or nil
  return type(name) == "string" and name ~= "" and name or ("Item " .. id)
end

local function sortedKeys(map)
  local keys = {}
  for k in pairs(map) do keys[#keys + 1] = k end
  table.sort(keys)
  return keys
end

local INVALID = { invalid = true }

-- a better than b: an invalid route never is; fewer unknown inputs (a strict subset) is; with the same unknown inputs
-- the lower priced total is. Anything else is not comparable, and the earlier option stays.
local function better(a, b)
  if a.invalid then return false end
  if b.invalid then return true end
  local same, subset = true, true
  for id, n in pairs(a.unpriced) do
    local m = b.unpriced[id]
    if m ~= n then same = false end
    if not m or n > m then subset = false end
  end
  for id in pairs(b.unpriced) do if a.unpriced[id] == nil then same = false end end
  if same then return a.cost < b.cost end
  return subset
end

local function reject(plan, reason)
  plan.rejected, plan.cost, plan.cashCost, plan.buyCost, plan.complete = reason, nil, nil, nil, false
  return plan
end

function CP.Resolve(requests, context, known, owned, options)
  options = type(options) == "table" and options or {}
  known = type(known) == "table" and known or {}
  local strategy = options.strategy == "cheapest" and "cheapest" or "buy"
  -- Each recipe's current cooldown is read at most once per resolution.
  local reads = {}
  local evidence = { noCooldown = options.noCooldown, limited = options.limited, detail = options.capacityDetail }
  if type(options.readCooldown) == "function" then
    evidence.readCooldown = function(r)
      local got = reads[r.recipeId]
      if not got then
        local read, why = options.readCooldown(r)
        got = { read = type(read) == "table" and read or nil, why = why }
        reads[r.recipeId] = got
      end
      return got.read, got.why
    end
  end
  local plan = { strategy = strategy, purchases = {}, steps = {}, leftovers = {}, possibleLeftovers = {}, used = {},
    unpriced = {}, exclusions = {}, limits = {}, decisions = {}, omitted = {}, complete = false,
    optimality = strategy == "cheapest" and "bounded" or "buy" }
  local excludedOnce, limitedOnce = {}, {}
  local function exclude(recipeId, itemId, reason, detail)
    local key = tostring(recipeId) .. "|" .. tostring(itemId) .. "|" .. reason
    if excludedOnce[key] then return end
    excludedOnce[key] = true
    plan.exclusions[#plan.exclusions + 1] = { recipeId = recipeId, itemId = itemId, reason = reason, detail = detail }
  end
  local function limit(entry, once)
    if once then
      if limitedOnce[entry.kind] then return end
      limitedOnce[entry.kind] = true
    end
    plan.limits[#plan.limits + 1] = entry
  end

  -- Roots: the requested crafts, summed per recipe, and what they consume.
  if type(requests) ~= "table" or #requests == 0 then return reject(plan, "no request") end
  local roots, rootNeed, total, rootsKnown = {}, {}, 0, true
  for i, req in ipairs(requests) do
    if type(req) ~= "table" or not whole(req.crafts) then return reject(plan, "invalid count") end
    if not whole(req.recipeId) and type(req.recipe) ~= "table" then return reject(plan, "invalid recipe") end
    total = total + req.crafts
    if total > LIMITS.crafts then return reject(plan, "crafts") end
    local key = req.recipeId or ("request " .. i)
    local root = roots[key]
    if not root then
      local def = type(req.recipe) == "table" and req.recipe
        or (type(known[req.recipeId]) == "table" and known[req.recipeId].learned == true and known[req.recipeId]) or nil
      root = { key = key, recipeId = req.recipeId, crafts = 0, reagents = def and reagentList(def.reagents) }
      if not def then exclude(req.recipeId, nil, "unknown"); rootsKnown = false
      elseif not root.reagents then exclude(req.recipeId, def.itemId, "reagents"); rootsKnown = false end
      roots[key] = root
      roots[#roots + 1] = root
    end
    root.crafts = root.crafts + req.crafts
  end
  for _, root in ipairs(roots) do
    for _, g in ipairs(root.reagents or {}) do rootNeed[g.itemId] = (rootNeed[g.itemId] or 0) + g.count * root.crafts end
  end
  local rootItems = sortedKeys(rootNeed)

  -- Candidate routes: this character's proven recipes, by the item they make, lowest recipe ID first.
  local outputs, groupCap = {}, {}
  for _, r in pairs(known) do
    if type(r) == "table" and whole(r.recipeId) and whole(r.itemId) then
      outputs[r.itemId] = outputs[r.itemId] or {}
      table.insert(outputs[r.itemId], r)
      if r.learned == true and showsLimit(r, evidence.limited) then
        -- One slot per cooldown category; a current read of any member that is cooling closes it for all of them.
        local cap, reason, detail = CP.Capacity(r, evidence)
        if currentRead(reason, detail) then
          local group = groupOf(r, evidence.limited)
          groupCap[group] = math.min(groupCap[group] or math.huge, cap)
        end
      end
    end
  end
  for _, list in pairs(outputs) do table.sort(list, function(a, b) return a.recipeId < b.recipeId end) end
  -- Requested crafts of a cooldown recipe use its capacity first; intermediates get what is left.
  local rootUse, rootGroupUse, overCapacity = {}, {}, false
  for _, root in ipairs(roots) do
    local r = whole(root.recipeId) and known[root.recipeId]
    if type(r) == "table" and r.learned == true and showsLimit(r, evidence.limited) then
      local group = groupOf(r, evidence.limited)
      rootUse[root.recipeId] = root.crafts
      rootGroupUse[group] = (rootGroupUse[group] or 0) + root.crafts
    end
  end
  for _, root in ipairs(roots) do
    if rootUse[root.recipeId] then
      local r = known[root.recipeId]
      local cap, reason, detail = CP.Capacity(r, evidence)
      local group = groupOf(r, evidence.limited)
      local room = math.min(cap, groupCap[group] or 0)
      if root.crafts > room or rootGroupUse[group] > (groupCap[group] or 0) then
        overCapacity = true
        limit({ kind = "cooldown", recipeId = root.recipeId, crafts = root.crafts, capacity = math.max(0, room),
          reason = reason, detail = detail })
      end
    end
  end
  local catalog = {}
  for _, entry in ipairs(type(options.catalog) == "table" and options.catalog or {}) do
    if type(entry) == "table" and whole(entry.recipeId) and whole(entry.itemId) then
      catalog[entry.itemId] = catalog[entry.itemId] or {}
      table.insert(catalog[entry.itemId], entry.recipeId)
    end
  end

  local order, choices, candidates = {}, {}, {}
  if strategy == "cheapest" then
    local level, queue, head, count = {}, {}, 1, 0
    for _, item in ipairs(rootItems) do level[item] = 1; queue[#queue + 1] = item end
    while head <= #queue do
      local item = queue[head]
      head = head + 1
      order[#order + 1] = item
      local opts = { { kind = "buy" } }
      for _, r in ipairs(outputs[item] or {}) do
        local reason, detail, cap, basis
        local reagents = reagentList(r.reagents)
        if r.learned ~= true then reason = "not learned"
        elseif not (whole(r.minimum) and whole(r.maximum) and r.minimum <= r.maximum) then reason = "output"
        elseif not reagents then reason = "reagents"
        else
          for _, g in ipairs(reagents) do if g.itemId == item then reason = "cycle" end end
          if not reason then
            cap, reason, detail = CP.Capacity(r, evidence)
            basis = reason
            if cap - (rootUse[r.recipeId] or 0) >= 1 then reason, detail = nil, nil
            elseif cap >= 1 then reason, detail = "cooldown", "used by the requested crafts" end
          end
        end
        if reason then exclude(r.recipeId, item, reason, detail)
        elseif level[item] > LIMITS.depth then limit({ kind = "depth", itemId = item, depth = level[item] }, true)
        elseif count >= LIMITS.recipes then limit({ kind = "recipes", limit = LIMITS.recipes }, true)
        else
          count = count + 1
          local c = { id = r.recipeId, itemId = item, reagents = reagents, min = r.minimum, max = r.maximum,
            cap = cap - (rootUse[r.recipeId] or 0), basis = basis,
            group = showsLimit(r, evidence.limited) and groupOf(r, evidence.limited) or nil }
          candidates[#candidates + 1] = c
          opts[#opts + 1] = { kind = "make", c = c, mode = "floor" }
          opts[#opts + 1] = { kind = "make", c = c, mode = "ceil" }
          for _, g in ipairs(reagents) do
            if not level[g.itemId] then level[g.itemId] = level[item] + 1; queue[#queue + 1] = g.itemId end
          end
        end
      end
      for _, recipeId in ipairs(catalog[item] or {}) do
        local r = known[recipeId]
        if type(r) ~= "table" or r.learned ~= true then exclude(recipeId, item, "not learned") end
      end
      choices[item] = opts
    end
    -- A recipe whose reagents can lead back to its own product is named. It is still used where a purchase breaks
    -- the loop; a route that actually loops is never valid.
    local byItem = {}
    for _, c in ipairs(candidates) do byItem[c.itemId] = byItem[c.itemId] or {}; table.insert(byItem[c.itemId], c) end
    for _, c in ipairs(candidates) do
      local seen, stack, loops = {}, {}, false
      for _, g in ipairs(c.reagents) do stack[#stack + 1] = g.itemId end
      while #stack > 0 and not loops do
        local item = table.remove(stack)
        if item == c.itemId then loops = true
        elseif not seen[item] then
          seen[item] = true
          for _, d in ipairs(byItem[item] or {}) do
            for _, g in ipairs(d.reagents) do stack[#stack + 1] = g.itemId end
          end
        end
      end
      if loops then exclude(c.id, c.itemId, "cycle") end
    end
  end

  -- One route's quantities and prices: parents before reagents, so every need is summed before it is rounded.
  local function evaluate(choice, stock)
    local state, topo, cyclic = {}, {}, false
    local function visit(item)
      if state[item] == 2 or cyclic then return end
      if state[item] == 1 then cyclic = true; return end
      state[item] = 1
      local opt = choice[item]
      if opt then for _, g in ipairs(opt.c.reagents) do visit(g.itemId) end end
      state[item] = 2
      topo[#topo + 1] = item
    end
    for _, item in ipairs(rootItems) do visit(item) end
    if cyclic then return INVALID end
    local res = { cost = 0, unpriced = {}, buy = {}, made = {}, leftovers = {}, possible = {}, used = {}, need = {},
      topo = topo }
    local need, level, have, groupUsed = res.need, {}, {}, {}
    for group, n in pairs(rootGroupUse) do groupUsed[group] = n end
    for item, n in pairs(rootNeed) do need[item] = n; level[item] = 1 end
    for id, n in pairs(stock) do have[id] = n end
    for i = #topo, 1, -1 do
      local item = topo[i]
      local n = need[item] or 0
      if n > 0 then
        local use = math.min(n, have[item] or 0)
        if use > 0 then have[item] = have[item] - use; res.used[item] = use end
        local net, opt = n - use, choice[item]
        local remainder = net
        if opt and net > 0 then
          if level[item] > LIMITS.depth then return INVALID end
          local c = opt.c
          local k = opt.mode == "ceil" and math.ceil(net / c.min) or math.floor(net / c.min)
          local room = c.cap
          if c.group then room = math.min(room, (groupCap[c.group] or 0) - (groupUsed[c.group] or 0)) end
          k = math.max(0, math.min(k, room))
          if k > 0 then
            if c.group then groupUsed[c.group] = (groupUsed[c.group] or 0) + k end
            remainder = math.max(0, net - k * c.min)
            local consumed = net - remainder
            res.made[item] = { recipeId = c.id, crafts = k, made = consumed }
            if k * c.min > consumed then res.leftovers[item] = k * c.min - consumed end
            if k * c.max > consumed then res.possible[item] = k * c.max - consumed end
            for _, g in ipairs(c.reagents) do
              need[g.itemId] = (need[g.itemId] or 0) + g.count * k
              level[g.itemId] = math.max(level[g.itemId] or 0, level[item] + 1)
            end
          end
        end
        if remainder > 0 then
          res.buy[item] = remainder
          local q = context and context.Quote and context:Quote(item)
          if q and type(q.unit) == "number" then res.cost = res.cost + q.unit * remainder
          else res.unpriced[item] = remainder end
        end
      end
    end
    return res
  end
  local function priced(res) return not res.invalid and next(res.unpriced) == nil and rootsKnown end

  local choice = {}
  local allBuy = evaluate(choice, {})
  local current = allBuy
  if strategy == "cheapest" then
    -- Seed: a per-unit estimate that ignores whole batches, walked without revisiting an item on its own path, so a
    -- long chain of unpriced intermediates can be seen to end in a priced input. Only a seed: every decision after it
    -- compares whole-plan integer costs, which is where the fractional trap is caught.
    local unit = {}
    local function estimate(item, depth, path)
      if unit[item] ~= nil then return unit[item] or nil end
      local q = context and context.Quote and context:Quote(item)
      local best = q and type(q.unit) == "number" and q.unit or nil
      local pick
      path[item] = true
      for _, opt in ipairs(depth <= LIMITS.depth and choices[item] or {}) do
        if opt.kind == "make" and opt.mode == "ceil" then
          local sum = 0
          for _, g in ipairs(opt.c.reagents) do
            local u = not path[g.itemId] and estimate(g.itemId, depth + 1, path) or nil
            if not u then sum = nil; break end
            sum = sum + u * g.count
          end
          if sum and (not best or sum / opt.c.min < best) then best, pick = sum / opt.c.min, opt end
        end
      end
      path[item] = nil
      unit[item] = best or false
      if pick then choice[item] = pick end
      return best
    end
    for _, item in ipairs(rootItems) do estimate(item, 1, {}) end
    current = evaluate(choice, {})
    if current.invalid or not better(current, allBuy) then choice, current = {}, allBuy end
    local function tie(a, b) return not a.invalid and not b.invalid and not better(a, b) and not better(b, a)
      and a.cost == b.cost end
    local changed, passes = true, 0
    while changed and passes < LIMITS.passes do
      changed, passes = false, passes + 1
      for _, item in ipairs(order) do
        local opts = choices[item]
        if #opts > 1 and (current.need[item] or 0) > 0 then
          local before = choice[item]
          local bestOpt, bestRes = before, current
          for _, opt in ipairs(opts) do
            local candidate = opt.kind == "make" and opt or nil
            if candidate ~= before then
              choice[item] = candidate
              local res = evaluate(choice, {})
              -- Buy wins an exact tie; between make routes, the lower recipe ID.
              if better(res, bestRes) or (tie(res, bestRes) and (not candidate
                or (bestOpt and candidate.c.id < bestOpt.c.id))) then
                bestOpt, bestRes = candidate, res
              end
            end
          end
          choice[item] = bestOpt
          if bestOpt ~= before then changed = true end
          current = bestRes
        end
      end
    end
    if changed then limit({ kind = "passes", limit = LIMITS.passes }, true) end
  end

  local valued = evaluate(choice, {})
  local stock = {}
  for id, n in pairs(type(owned) == "table" and owned or {}) do if whole(id) and whole(n) then stock[id] = n end end
  local shop = next(stock) and evaluate(choice, stock) or valued

  plan.cost = priced(valued) and valued.cost or nil
  plan.cashCost = priced(shop) and shop.cost or nil
  plan.buyCost = priced(allBuy) and allBuy.cost or nil
  for _, id in ipairs(sortedKeys(shop.buy)) do
    local q = context and context.Quote and context:Quote(id)
    local unit = q and type(q.unit) == "number" and q.unit or nil
    local entry = { id = id, item = itemName(id, context), count = shop.buy[id], unit = unit, vendor = q and q.vendor or nil }
    if #plan.purchases < LIMITS.purchases then plan.purchases[#plan.purchases + 1] = entry
    else plan.omitted[#plan.omitted + 1] = entry end
    if not unit then plan.unpriced[#plan.unpriced + 1] = { id = id, count = shop.buy[id] } end
  end
  if #plan.omitted > 0 then limit({ kind = "purchases", limit = LIMITS.purchases, omitted = #plan.omitted }) end
  local stepAt = {}
  for _, item in ipairs(shop.topo) do
    local made = shop.made[item]
    if made then
      plan.steps[#plan.steps + 1] = { recipeId = made.recipeId, crafts = made.crafts }
      stepAt[made.recipeId] = plan.steps[#plan.steps]
    end
  end
  for _, root in ipairs(roots) do
    local step = whole(root.recipeId) and stepAt[root.recipeId]
    if step then step.crafts = step.crafts + root.crafts
    else plan.steps[#plan.steps + 1] = { recipeId = root.recipeId, crafts = root.crafts } end
  end
  plan.leftovers, plan.possibleLeftovers, plan.used = shop.leftovers, shop.possible, shop.used
  for i = #valued.topo, 1, -1 do
    local item = valued.topo[i]
    local need = valued.need[item] or 0
    if need > 0 then
      local made = valued.made[item]
      plan.decisions[#plan.decisions + 1] = { itemId = item, item = itemName(item, context), need = need,
        made = made and made.made or 0,
        bought = valued.buy[item] or 0, recipeId = made and made.recipeId, crafts = made and made.crafts or 0,
        unpriced = valued.unpriced[item] ~= nil }
    end
  end
  -- Make steps that rely on no cooldown being recorded in the client data, labelled with that basis.
  local byId = {}
  for _, c in ipairs(candidates) do byId[c.id] = c end
  plan.assumed = {}
  for _, step in ipairs(plan.steps) do
    local c = byId[step.recipeId]
    if c and c.basis == "no cooldown recorded" then plan.assumed[#plan.assumed + 1] = step.recipeId end
  end
  if #plan.assumed > 0 then plan.basis = options.noCooldownBasis end
  plan.complete = plan.cost ~= nil and plan.cashCost ~= nil and #plan.omitted == 0 and not overCapacity
  return plan
end

-- Recipe plans ---------------------------------------------------------------------------------------------------
-- What a character means to craft, kept on this computer only and never uploaded:
-- EverlootDB.craftingPlans[characterKey] = { name?, strategy = 'buy' (default) | 'cheapest', recipes = {
--   [recipeId] = { recipeId, professionId, crafts, itemId?, minimum?, maximum?,
--                  reagents? = { { itemId, count } } (one craft, from the owner's proven recipe),
--                  needs = { { itemId, count } } (the full requirement for every craft, never bag-adjusted),
--                  unresolved? = { { item, count } } (reagent slots without one known item ID) } } }
-- A recipe is keyed by its ID, so planning it again replaces its count. Different recipes aggregate in Preview, which
-- recomputes the whole route from these saved requests, the owner's proven recipes and the saved strategy. Only the
-- owner's own current bags (Inventory.CurrentBags) lower what to buy, once across every plan; nothing about the bags
-- is saved. Legacy manual shopping lists (shopping.lua) are separate and never merged with these.
CP.MAX_PLANS = 50    -- recipes per character
CP.MAX_OWNERS = 50   -- characters with plans
CP.MAX_UNRESOLVED = 8
CP.revision = 0      -- changes with every stored change, so a queued search for an older plan is dropped

local function changed()
  CP.revision = CP.revision + 1
  local S = E.Shopping
  if S and S.Invalidate then pcall(S.Invalidate, "plan") end
end

local function thousands(n)
  local s = tostring(math.floor(n))
  while true do
    local k
    s, k = s:gsub("^(%d+)(%d%d%d)", "%1,%2")
    if k == 0 then return s end
  end
end

local function plural(n, word) return thousands(n) .. " " .. word .. (n == 1 and "" or "s") end

-- The saved plans of one character. With create, the table is made (within the owner cap); invalid entries are
-- skipped wherever they are read, never trusted.
local function store(characterKey, create)
  if not validKey(characterKey) or type(EverlootDB) ~= "table" then return nil end
  local all = type(EverlootDB.craftingPlans) == "table" and EverlootDB.craftingPlans or nil
  local mine = all and type(all[characterKey]) == "table" and all[characterKey] or nil
  if not mine and create then
    local owners = 0
    for _ in pairs(all or {}) do owners = owners + 1 end
    if owners >= CP.MAX_OWNERS then return nil, "owners" end
    all = all or {}
    EverlootDB.craftingPlans = all
    mine = { strategy = "buy", recipes = {} }
    all[characterKey] = mine
  end
  if mine and type(mine.recipes) ~= "table" then mine.recipes = {} end
  return mine
end

local function validEntry(recipeId, e)
  return whole(recipeId) and type(e) == "table" and e.recipeId == recipeId and whole(e.crafts) and e.crafts <= LIMITS.crafts
end

local function copyList(list, max)
  local out = {}
  for _, g in ipairs(type(list) == "table" and list or {}) do
    if #out >= (max or math.huge) then break end
    if type(g) == "table" then
      local item = type(g.item) == "string" and g.item:sub(1, 64) or nil
      local count = whole(g.count) and g.count or nil
      if g.itemId ~= nil then
        if whole(g.itemId) and count then out[#out + 1] = { itemId = g.itemId, count = count } end
      elseif item then out[#out + 1] = { item = item, count = count or 1 } end
    end
  end
  return out
end

--- One character's plans: { name, strategy, entries = { { recipeId, professionId, crafts, itemId, minimum, maximum,
--- reagents, needs, unresolved } } } in recipe ID order. Copies; no entries when the character has none.
function CP.Plans(characterKey)
  local mine = store(characterKey)
  local out = { strategy = "buy", entries = {} }
  if not mine then return out end
  out.name = type(mine.name) == "string" and mine.name or nil
  out.strategy = mine.strategy == "cheapest" and "cheapest" or "buy"
  for recipeId, e in pairs(mine.recipes) do
    if validEntry(recipeId, e) then
      out.entries[#out.entries + 1] = { recipeId = recipeId, professionId = e.professionId, crafts = e.crafts,
        itemId = e.itemId, minimum = e.minimum, maximum = e.maximum, reagents = reagentList(e.reagents),
        needs = copyList(e.needs), unresolved = e.unresolved and copyList(e.unresolved, CP.MAX_UNRESOLVED) or nil }
    end
  end
  table.sort(out.entries, function(a, b) return a.recipeId < b.recipeId end)
  return out
end

--- Characters with at least one plan: this character first, then the others by key.
function CP.Owners()
  local current = E.CharacterKey and E.CharacterKey() or nil
  local keys = {}
  local all = type(EverlootDB) == "table" and type(EverlootDB.craftingPlans) == "table" and EverlootDB.craftingPlans or {}
  for key in pairs(all) do
    if key ~= current and #CP.Plans(key).entries > 0 then keys[#keys + 1] = key end
  end
  table.sort(keys)
  if validKey(current) then table.insert(keys, 1, current) end
  return keys
end

-- The entry a Put or a preview would store, from the owner's proven recipe; or nil, the reason and the sentence.
local function entryFor(characterKey, professionId, recipeId, crafts, opts)
  if not validKey(characterKey) then return nil, "character", "Not saved: no character to plan for." end
  if not whole(crafts) or crafts > LIMITS.crafts then
    return nil, "count", "Not saved: the craft count must be a whole number from 1 to 9,999."
  end
  local r = whole(recipeId) and CP.Known(characterKey)[recipeId]
  if type(r) ~= "table" or r.learned ~= true then
    return nil, "unknown", "Not saved: this character has not proven it knows the recipe. Open it in this"
      .. " character's own profession window first."
  end
  if professionId ~= nil and professionId ~= r.professionId then
    return nil, "profession", "Not saved: the recipe belongs to another profession."
  end
  local reagents = reagentList(r.reagents)
  local entry = { recipeId = recipeId, professionId = r.professionId, crafts = crafts, reagents = reagents, needs = {} }
  if whole(r.itemId) and whole(r.minimum) and whole(r.maximum) then
    entry.itemId, entry.minimum, entry.maximum = r.itemId, r.minimum, r.maximum
  end
  for _, g in ipairs(reagents or {}) do entry.needs[#entry.needs + 1] = { itemId = g.itemId, count = g.count * crafts } end
  if not reagents then
    local named = type(opts) == "table" and copyList(opts.unresolved, CP.MAX_UNRESOLVED) or {}
    entry.unresolved = #named > 0 and named or { { item = "Reagents unknown", count = 1 } }
  end
  return entry
end

local function sameEntry(a, b)
  if a.crafts ~= b.crafts or a.professionId ~= b.professionId or type(a.needs) ~= "table" or #a.needs ~= #b.needs then
    return false
  end
  for i, g in ipairs(a.needs) do
    if type(g) ~= "table" or b.needs[i].itemId ~= g.itemId or b.needs[i].count ~= g.count then return false end
  end
  return (a.unresolved == nil) == (b.unresolved == nil)
end

local function otherCrafts(mine, recipeId)
  local total = 0
  for id, e in pairs(mine and mine.recipes or {}) do
    if id ~= recipeId and validEntry(id, e) then total = total + e.crafts end
  end
  return total
end

local function countRecipes(mine)
  local n = 0
  for id, e in pairs(mine and mine.recipes or {}) do if validEntry(id, e) then n = n + 1 end end
  return n
end

local function totalRefusal(others)
  return "Not saved: all plans together allow 9,999 crafts; the others already have " .. thousands(others) .. "."
end

--- Plans `crafts` crafts of a recipe this character proved it knows, replacing any count already planned for it.
--- professionId may be nil (the recipe's own is used). opts.unresolved names reagent slots without one item ID.
--- Returns a receipt: { ok, recipeId, crafts, previous, replaced, changed, partial, needs, unresolved, reason, said }.
--- A count that is not a whole number from 1 to 9,999, or that takes every plan past 9,999 crafts, is refused, never cut.
function CP.Put(characterKey, professionId, recipeId, crafts, opts)
  local entry, reason, said = entryFor(characterKey, professionId, recipeId, crafts, opts)
  if not entry then return { ok = false, recipeId = recipeId, crafts = crafts, reason = reason, said = said } end
  local mine = store(characterKey)
  local old = mine and validEntry(recipeId, mine.recipes[recipeId]) and mine.recipes[recipeId] or nil
  local others = otherCrafts(mine, recipeId)
  if others + crafts > LIMITS.crafts then
    return { ok = false, recipeId = recipeId, crafts = crafts, reason = "total", said = totalRefusal(others) }
  end
  if not old and countRecipes(mine) >= CP.MAX_PLANS then
    return { ok = false, recipeId = recipeId, crafts = crafts, reason = "full",
      said = "Not saved: a character keeps up to " .. CP.MAX_PLANS .. " recipe plans. Remove one first." }
  end
  local receipt = { ok = true, recipeId = recipeId, crafts = crafts, previous = old and old.crafts or nil,
    replaced = old ~= nil, needs = entry.needs, unresolved = entry.unresolved, partial = entry.unresolved ~= nil }
  if old and sameEntry(old, entry) then
    receipt.changed = false
  else
    local why
    mine, why = store(characterKey, true)
    if not mine then
      return { ok = false, recipeId = recipeId, crafts = crafts, reason = why,
        said = "Not saved: plans are kept for up to " .. CP.MAX_OWNERS .. " characters." }
    end
    entry.updatedAt = time and time() or nil
    mine.recipes[recipeId] = entry
    -- The character's name, for showing its plans to the player's other characters on this computer.
    if characterKey == (E.CharacterKey and E.CharacterKey()) and UnitName then
      local ok, name = pcall(UnitName, "player")
      name = ok and E.Readable(name) or nil
      if type(name) == "string" and name ~= "" then mine.name = name:sub(1, 48) end
    end
    receipt.changed = true
    changed()
  end
  receipt.said = "Saved: " .. plural(crafts, "craft") .. ((receipt.replaced and receipt.previous ~= crafts)
    and (" (was " .. thousands(receipt.previous) .. ")") or "") .. "."
  if receipt.partial then receipt.said = receipt.said .. " Partial: the recipe's reagents are not all known." end
  return receipt
end

--- Removes one recipe's plan (professionId may be nil). True when there was one.
function CP.Remove(characterKey, professionId, recipeId)
  local mine = store(characterKey)
  local e = mine and mine.recipes[recipeId]
  if type(e) ~= "table" or (professionId ~= nil and e.professionId ~= professionId) then return false end
  mine.recipes[recipeId] = nil
  changed()
  return true
end

--- Routes this character's plans by buying every reagent ('buy') or by the bounded cheapest search ('cheapest').
function CP.SetStrategy(characterKey, strategy)
  if strategy ~= "buy" and strategy ~= "cheapest" then return false end
  local mine = store(characterKey, true)
  if not mine then return false end
  if (mine.strategy == "cheapest" and "cheapest" or "buy") ~= strategy then
    mine.strategy = strategy
    changed()
  end
  return true
end

--- The combined plan of one character, recomputed now: CP.Resolve over every saved recipe request with the OWNER's
--- proven recipes, the owner's saved strategy and the owner's cooldown evidence. options:
---   with = { recipeId, crafts, professionId?, unresolved? }: this recipe at that count instead of its saved one
---     (crafts 0 previews its removal); nothing is stored. plan.with = { ok, previous, remove, reason, said }.
---   bags = { counts = {...} } or { reason = '...' }: the owner's bags already read for this refresh; else
---     Inventory.CurrentBags() is read.
---   evidence: Resolve's cooldown options (default E.Crafting.PlanOptions(owner)).
--- Bags count only for this character's own plan. The plan adds: owner, own, name, entries, coverage = { counted,
--- reason }, rows = { { id, item, need, full, have?, unit?, vendor?, omitted? } } (need: to buy now; full: to buy
--- without bags), unresolved = { { recipeId, items } }, searchable and searchWhy. cost stays the valuation without
--- bags; cashCost is what the needed purchases cost.
function CP.Preview(characterKey, context, options)
  options = type(options) == "table" and options or {}
  local current = E.CharacterKey and E.CharacterKey() or nil
  local own = validKey(characterKey) and characterKey == current
  local saved = CP.Plans(characterKey)
  local entries, with = {}, nil
  local w = type(options.with) == "table" and options.with or nil
  for _, e in ipairs(saved.entries) do
    if w and w.recipeId == e.recipeId then with = { previous = e.crafts } else entries[#entries + 1] = e end
  end
  if w then
    with = with or {}
    if w.crafts == 0 then
      with.ok, with.remove = with.previous ~= nil, true
      with.said = with.previous and "Removes the recipe from the plan." or "The recipe is not in the plan."
    else
      local entry, reason, said = entryFor(characterKey, w.professionId, w.recipeId, w.crafts, w)
      local others = 0
      for _, e in ipairs(entries) do others = others + e.crafts end
      if entry and others + w.crafts > LIMITS.crafts then
        entry, reason, said = nil, "total", totalRefusal(others)
      elseif entry and not with.previous and #entries >= CP.MAX_PLANS then
        entry, reason, said = nil, "full", "Not saved: a character keeps up to " .. CP.MAX_PLANS .. " recipe plans."
      end
      with.ok, with.reason, with.said, with.crafts = entry ~= nil, reason, said, w.crafts
      if entry then
        entries[#entries + 1] = entry
        table.sort(entries, function(a, b) return a.recipeId < b.recipeId end)
      end
    end
  end

  local requests, unresolved = {}, {}
  for _, e in ipairs(entries) do
    requests[#requests + 1] = { recipeId = e.recipeId, crafts = e.crafts, recipe = { itemId = e.itemId,
      minimum = e.minimum, maximum = e.maximum, reagents = e.reagents } }
    if e.unresolved then unresolved[#unresolved + 1] = { recipeId = e.recipeId, items = e.unresolved } end
  end

  local owned, coverage = {}, { counted = false }
  if not own then
    coverage.reason = "another character"
  else
    local counts, why
    if type(options.bags) == "table" then counts, why = options.bags.counts, options.bags.reason
    elseif E.Inventory and E.Inventory.CurrentBags then counts, why = E.Inventory.CurrentBags()
    else why = "no inventory module" end
    if type(counts) == "table" then owned, coverage.counted = counts, true else coverage.reason = why or "bags unreadable" end
  end

  local resolve = options.evidence
  if type(resolve) ~= "table" then
    local C = E.Crafting
    resolve = C and C.PlanOptions and C.PlanOptions(characterKey) or {}
  end
  local opts = {}
  for k, v in pairs(resolve) do opts[k] = v end
  opts.strategy = saved.strategy

  local plan
  if #requests == 0 then
    plan = { strategy = saved.strategy, purchases = {}, steps = {}, leftovers = {}, possibleLeftovers = {}, used = {},
      unpriced = {}, exclusions = {}, limits = {}, decisions = {}, omitted = {}, assumed = {}, complete = false,
      empty = true }
  else
    plan = CP.Resolve(requests, context, CP.Known(characterKey), owned, opts)
  end
  plan.owner, plan.own, plan.name, plan.entries, plan.with = characterKey, own, saved.name, entries, with
  plan.coverage, plan.unresolved = coverage, unresolved
  if #unresolved > 0 then plan.complete = false end

  -- Rows: every item the plan buys without bags (its full need) or with them (what to buy now), by item ID.
  local rows, byId = {}, {}
  local function rowFor(id, item)
    local r = byId[id]
    if not r then
      r = { id = id, item = item or itemName(id, context), need = 0, full = 0 }
      byId[id] = r
      rows[#rows + 1] = r
    end
    return r
  end
  for _, d in ipairs(plan.decisions) do
    if d.bought > 0 then rowFor(d.itemId, d.item).full = d.bought end
  end
  for _, p in ipairs(plan.purchases) do
    local r = rowFor(p.id, p.item)
    r.need, r.unit, r.vendor = p.count, p.unit, p.vendor
  end
  for _, p in ipairs(plan.omitted) do
    local r = rowFor(p.id, p.item)
    r.need, r.unit, r.vendor, r.omitted = p.count, p.unit, p.vendor, true
  end
  for _, r in ipairs(rows) do
    if r.unit == nil and context and context.Quote then
      local q = context:Quote(r.id)
      r.unit = q and type(q.unit) == "number" and q.unit or nil
      r.vendor = q and q.vendor or nil
    end
    if coverage.counted then r.have = owned[r.id] or 0 end
  end
  table.sort(rows, function(a, b) return a.id < b.id end)
  plan.rows = rows

  if not own then
    plan.searchWhy = "Search is off for another character's plan: log in as " .. (saved.name or "that character")
      .. " to search it."
  elseif #entries == 0 then
    plan.searchWhy = "No recipe plan for this character yet."
  elseif plan.rejected then
    plan.searchWhy = "This plan cannot be worked out (" .. tostring(plan.rejected) .. ")."
  end
  plan.searchable = plan.searchWhy == nil
  return plan
end
