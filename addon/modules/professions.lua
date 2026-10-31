-- Everloot recipe observations for WoW: Forever (client 1.60.1, interface 16001). The profession
-- window reports, per recipe, a difficulty colour at the player's current rank, not the skill
-- thresholds themselves. Each row records what the window showed (profession, rank, recipe, colour,
-- product, reagents); the server infers threshold ranges from many installs. One row per recipe,
-- rank, colour and learned state; reopening adds nothing.
-- A trainer window lists each profession recipe's required rank and training cost: one row per
-- recipe, rank and cost. Reads windows the player opened. Never crafts, clicks, trains or plays.
--
-- Existing readers checked against the client's own files for build 1.60.1.70450 (see CHANGELOG 0.3.2).
-- GetAllRecipeIDs is optional: clients without it retain the filtered reader, without changing filters.
--   C_TradeSkillUI.GetBaseProfessionInfo / GetChildProfessionInfo   profession name, skill level
--   C_TradeSkillUI.GetAllRecipeIDs / GetFilteredRecipeIDs            complete list when available, else filtered
--   C_TradeSkillUI.GetRecipeInfo                                    recipeID, name, relativeDifficulty, learned
--   C_TradeSkillUI.GetRecipeSchematic                               product item, reagent slots
--   C_Item.GetItemNameByID / RequestLoadItemDataByID                reagent names
--   GetProfessions / GetProfessionInfo                              rank when the info reports 0/0
--   GetNumTrainerServices, GetTrainerServiceInfo, GetTrainerServiceSkillReq, GetTrainerServiceCost
-- A missing call records nothing and /everloot status says which one.

local E = Everloot

-- Enum.TradeskillRelativeDifficulty in the build's API documentation.
local DIFFICULTY = { [0] = "optimal", [1] = "medium", [2] = "easy", [3] = "trivial" }
-- Enum.CraftingReagentType.Basic and Enum.TradeskillSlotDataType.Reagent in the same documentation.
local REAGENT_BASIC, SLOT_REAGENT = 1, 1

local MAX_RANK = 500          -- web/src/lib/intake.ts
local MAX_RECIPES = 500       -- per window, as before
local CHUNK = 50              -- recipes read per frame, so a long list does not stall the client
local DEBOUNCE_SECONDS = 0.5  -- TRADE_SKILL_LIST_UPDATE can fire in bursts
local RETRY_SECONDS = 2       -- one more read for reagent names the client had not loaded
local MAX_RETRIES = 3

local windowOpen = false
local pass = 0          -- a newer read, or closing the window, ends the one in progress
local scheduled = false
local retries = 0

local function whole(n)
  n = E.Readable(n)
  return type(n) == "number" and n >= 1 and n <= 9007199254740991 and n == math.floor(n)
end

local function text(value, max)
  return type(value) == "string" and value ~= "" and #value <= max
end

--- Names of the calls the trade-skill reader needs that this client does not have.
local function missingTradeSkillApi()
  local missing = {}
  local function need(name, present) if not present then missing[#missing + 1] = name end end
  local T = C_TradeSkillUI
  need("C_TradeSkillUI", type(T) == "table")
  if type(T) == "table" then
    for _, fn in ipairs({ "GetBaseProfessionInfo", "GetChildProfessionInfo", "GetRecipeInfo", "GetRecipeSchematic" }) do
      need("C_TradeSkillUI." .. fn, type(T[fn]) == "function")
    end
    need("C_TradeSkillUI.GetFilteredRecipeIDs", type(T.GetAllRecipeIDs) == "function" or type(T.GetFilteredRecipeIDs) == "function")
  end
  need("C_Item.GetItemNameByID", type(C_Item) == "table" and type(C_Item.GetItemNameByID) == "function")
  return missing
end

local function missingTrainerApi()
  local missing = {}
  for _, fn in ipairs({ "GetNumTrainerServices", "GetTrainerServiceInfo", "GetTrainerServiceSkillReq" }) do
    if type(_G[fn]) ~= "function" then missing[#missing + 1] = fn end
  end
  return missing
end

local function describe(missing, what)
  if #missing == 0 then return what end
  return "unavailable, missing " .. table.concat(missing, ", ") .. " (records nothing)"
end

local function note(tradeSkill, trainerNote)
  return "trade-skill window: " .. tradeSkill .. "; trainer window: " .. trainerNote
end

local lastWindow = "no window read yet"
local function updateNote()
  E:SetNote("professions", note(describe(missingTradeSkillApi(), lastWindow), describe(missingTrainerApi(), "ready")))
end

--- The profession the window shows, as Blizzard's own profession frame reads it: the child (expansion)
--- profession, else the base one. Returns name, rank, maxRank, or nil and the reason.
local function windowProfession()
  local T = C_TradeSkillUI
  local okChild, info = pcall(T.GetChildProfessionInfo)
  if not okChild or type(info) ~= "table" or not info.professionID or info.professionID == 0 then
    local okBase, base = pcall(T.GetBaseProfessionInfo)
    info = okBase and base or nil
  end
  if type(info) ~= "table" then return nil, "no profession info" end
  local name = info.parentProfessionName or info.professionName
  local skillLine = info.parentProfessionID or info.professionID
  if not text(name, 40) then return nil, "no profession name" end
  local rank, maxRank = info.skillLevel, info.maxSkillLevel
  if rank == 0 and maxRank == 0 and type(GetProfessions) == "function" and type(GetProfessionInfo) == "function" then
    -- Blizzard's profession book does the same when the trade-skill info carries no levels.
    for i = 1, 7 do
      local okIndex, index = pcall(function() return (select(i, GetProfessions())) end)
      if okIndex and index then
        local okInfo, _, _, bookRank, bookMax, _, _, bookLine = pcall(GetProfessionInfo, index)
        if okInfo and bookLine == skillLine then rank, maxRank = bookRank, bookMax; break end
      end
    end
  end
  -- The intake accepts ranks 1 to 500: anything above is not written.
  if not whole(rank) or rank > MAX_RANK then return nil, "no skill level" end
  return name, rank, (whole(maxRank) and maxRank <= MAX_RANK) and maxRank or nil
end

--- One recipe into a row: "stored", "known" (already recorded), "pending" (reagent names not loaded),
--- "alternatives" (stored without reagents) or "skipped".
local function readRecipe(id, profession, rank, maxRank)
  id = E.Readable(id)
  if not whole(id) then return "skipped" end
  local T = C_TradeSkillUI
  local okInfo, info = pcall(T.GetRecipeInfo, id)
  info = E.Readable(info)
  if not okInfo or type(info) ~= "table" or E.Readable(info.isDummyRecipe) or not text(E.Readable(info.name), 120) then return "skipped" end
  local colour = DIFFICULTY[E.Readable(info.relativeDifficulty)]
  if not colour then return "skipped" end
  -- recipeID is the trade-skill API's identity, not an item ID or a separately observed spell ID.
  local recipeId = E.Readable(info.recipeID)
  if not whole(recipeId) then recipeId = id end
  local learned = E.Readable(info.learned)
  if type(learned) ~= "boolean" then learned = nil end
  -- Do not reuse the legacy name key: it would lose identity and learned-state information.
  local key = "id|" .. profession .. "|" .. recipeId .. "|" .. rank .. "|" .. colour .. "|" .. tostring(learned)
  if EverlootDB.recipeSeen[key] then return "known" end

  local okSchematic, schematic = pcall(T.GetRecipeSchematic, id, false)
  if not okSchematic or type(schematic) ~= "table" then return "skipped" end
  local reagents, pending, ambiguous = {}, false, false
  for _, slot in ipairs(type(schematic.reagentSlotSchematics) == "table" and schematic.reagentSlotSchematics or {}) do
    -- Only the basic reagents a craft always uses. Optional, finishing and currency slots are not its cost.
    if type(slot) == "table" and slot.reagentType == REAGENT_BASIC and slot.required ~= false
      and (slot.dataSlotType == nil or slot.dataSlotType == SLOT_REAGENT) then
      local options = type(slot.reagents) == "table" and slot.reagents or {}
      local itemId = options[1] and options[1].itemID
      if #options == 1 and whole(itemId) and whole(slot.quantityRequired) then
        local okName, name = pcall(C_Item.GetItemNameByID, itemId)
        if okName and text(name, 80) then
          reagents[#reagents + 1] = { item = name, count = slot.quantityRequired }
        else
          pending = true
          if C_Item.RequestLoadItemDataByID then pcall(C_Item.RequestLoadItemDataByID, itemId) end
        end
      else
        -- Several items fit this slot: which one the player used is not known, so none is written.
        ambiguous = true
      end
    end
  end
  if pending then return "pending" end
  if ambiguous then reagents = {} end

  local stored = E:Store("recipe_observed", {
    installId = EverlootDB.installId,
    capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    profession = profession,
    rank = rank,
    maxRank = maxRank,
    recipe = info.name,
    recipeId = recipeId,
    learned = learned,
    difficulty = colour,
    productItemId = whole(schematic.outputItemID) and schematic.outputItemID or nil,
    reagents = reagents,
  })
  if not stored then return "skipped" end
  EverlootDB.recipeSeen[key] = true
  return ambiguous and "alternatives" or "stored"
end

local readWindow

local function finish(stats, profession, rank, maxRank)
  lastWindow = string.format("%s %d%s, %d recipes listed, %d new rows, %d without a colour or schematic",
    profession, rank, maxRank and ("/" .. maxRank) or "", stats.listed, stats.stored + stats.alternatives, stats.skipped)
  if stats.alternatives > 0 then lastWindow = lastWindow .. string.format(", %d with alternative reagents stored without reagents", stats.alternatives) end
  if stats.pending > 0 then lastWindow = lastWindow .. string.format(", %d waiting for reagent names", stats.pending) end
  lastWindow = lastWindow .. ", " .. stats.source
  if stats.capped then lastWindow = lastWindow .. " (capped at " .. MAX_RECIPES .. ")" end
  updateNote()
  if stats.pending > 0 and windowOpen and retries < MAX_RETRIES and C_Timer and C_Timer.After then
    retries = retries + 1
    C_Timer.After(RETRY_SECONDS, function() if windowOpen then readWindow() end end)
  end
end

--- Reads the open window. The list is read in chunks across frames; a newer read replaces this one.
readWindow = function()
  if not E:IsEnabled("professions") then return end
  if #missingTradeSkillApi() > 0 then updateNote(); return end
  local profession, rank, maxRank = windowProfession()
  if not profession then lastWindow = "nothing recorded: " .. tostring(rank); updateNote(); return end
  local okIds, ids = false, nil
  if type(C_TradeSkillUI.GetAllRecipeIDs) == "function" then okIds, ids = pcall(C_TradeSkillUI.GetAllRecipeIDs) end
  ids = E.Readable(ids)
  local source = "all recipe IDs"
  if not okIds or type(ids) ~= "table" then
    source = "filtered recipe list (complete list unavailable)"
    if type(C_TradeSkillUI.GetFilteredRecipeIDs) == "function" then
      okIds, ids = pcall(C_TradeSkillUI.GetFilteredRecipeIDs)
      ids = E.Readable(ids)
    else
      okIds, ids = false, nil
    end
  end
  if not okIds or type(ids) ~= "table" then lastWindow = "nothing recorded: no recipe list"; updateNote(); return end
  EverlootDB.recipeSeen = EverlootDB.recipeSeen or {}
  pass = pass + 1
  local mine = pass
  local total = math.min(#ids, MAX_RECIPES)
  local stats = { listed = total, stored = 0, alternatives = 0, pending = 0, skipped = 0, source = source, capped = #ids > MAX_RECIPES }
  local nextIndex = 1
  local function step()
    if mine ~= pass or not windowOpen or not E:IsEnabled("professions") then return end
    local last = (C_Timer and C_Timer.After) and math.min(total, nextIndex + CHUNK - 1) or total
    for i = nextIndex, last do
      local ok, result = pcall(readRecipe, ids[i], profession, rank, maxRank)
      result = ok and result or "skipped"
      if result == "stored" then stats.stored = stats.stored + 1
      elseif result == "alternatives" then stats.alternatives = stats.alternatives + 1
      elseif result == "pending" then stats.pending = stats.pending + 1
      elseif result == "skipped" then stats.skipped = stats.skipped + 1 end
    end
    nextIndex = last + 1
    if nextIndex <= total then C_Timer.After(0, step) else finish(stats, profession, rank, maxRank) end
  end
  step()
end

local function scheduleRead()
  if not (C_Timer and C_Timer.After) then pcall(readWindow); return end
  if scheduled then return end
  scheduled = true
  C_Timer.After(DEBOUNCE_SECONDS, function()
    scheduled = false
    if windowOpen then pcall(readWindow) end
  end)
end

--- Only services with a profession requirement are recipes; class spells and headers have none.
--- GetTrainerServiceInfo returns name, serviceType, texture, reqLevel, subText, category.
local function trainer()
  if not E:IsEnabled("professions") then return end
  if #missingTrainerApi() > 0 then updateNote(); return end
  local okCount, count = pcall(GetNumTrainerServices)
  if not okCount or type(count) ~= "number" then return end
  -- The row Blizzard's trainer window adds for the next profession step is not a recipe.
  local stepIndex
  if GetTrainerServiceStepIndex then
    local okStep, step = pcall(GetTrainerServiceStepIndex)
    if okStep then stepIndex = step end
  end
  EverlootDB.trainerSeen = EverlootDB.trainerSeen or {}
  -- The trainer whose window is open; each trainer's list is recorded once.
  local trainerNpcId = E.NpcIdFromGuid and UnitGUID and E.NpcIdFromGuid(UnitGUID("npc")) or nil
  for i = 1, math.min(count, 500) do
    local okInfo, name, serviceType = pcall(GetTrainerServiceInfo, i)
    local okReq, profession, rank = pcall(GetTrainerServiceSkillReq, i)
    if i ~= stepIndex and okInfo and okReq and serviceType ~= "header" and text(name, 120)
      and text(profession, 40) and whole(rank) then
      local okCost, cost = false, nil
      if GetTrainerServiceCost then okCost, cost = pcall(GetTrainerServiceCost, i) end
      cost = (okCost and type(cost) == "number" and cost >= 0) and cost or nil
      local key = profession .. "|" .. name .. "|" .. rank .. "|" .. tostring(cost)
      if trainerNpcId then key = key .. "|" .. trainerNpcId end
      if not EverlootDB.trainerSeen[key] then
        local stored = E:Store("trainer_seen", {
          installId = EverlootDB.installId,
          capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
          profession = profession,
          recipe = name,
          requiredRank = rank,
          costCopper = cost,
          trainerNpcId = trainerNpcId,
        })
        if stored then EverlootDB.trainerSeen[key] = true end
      end
    end
  end
end

E:RegisterModule("professions", function()
  local f = E.frame
  for _, name in ipairs({ "TRADE_SKILL_SHOW", "TRADE_SKILL_LIST_UPDATE", "TRADE_SKILL_DATA_SOURCE_CHANGED", "TRADE_SKILL_CLOSE",
    "NEW_RECIPE_LEARNED", "TRAINER_SHOW", "TRAINER_UPDATE" }) do
    pcall(function() f:RegisterEvent(name) end)
  end
  f:HookScript("OnEvent", function(_, event)
    if event == "TRADE_SKILL_SHOW" then
      windowOpen = true
      retries = 0
      scheduleRead()
    elseif event == "TRADE_SKILL_LIST_UPDATE" or event == "TRADE_SKILL_DATA_SOURCE_CHANGED" or event == "NEW_RECIPE_LEARNED" then
      if windowOpen then scheduleRead() end
    elseif event == "TRADE_SKILL_CLOSE" then
      windowOpen = false
      pass = pass + 1
    elseif event == "TRAINER_SHOW" or event == "TRAINER_UPDATE" then pcall(trainer) end
  end)
  return note(describe(missingTradeSkillApi(), "ready, recipe colours from the open profession window"),
    describe(missingTrainerApi(), "ready, required ranks from trainers"))
end)
