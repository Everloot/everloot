-- Everloot recipe observations for WoW: Forever (client 1.60.1, interface 16001). The profession
-- window reports, per recipe, a difficulty colour at the player's current rank, not the skill
-- thresholds themselves. Each row records what the window showed (profession, rank, recipe, colour,
-- product, reagents); the server infers threshold ranges from many installs.
-- A colour only bounds a threshold through the lowest and the highest rank it was seen at, so those are
-- the rows kept: the lowest is written at once; the highest waits (saved with the file, so a reload keeps it)
-- until the colour changes, or until a logout on a later UTC day than that recipe's last highest-rank row.
-- Ranks in between add nothing, and reopening or reloading adds nothing. Recipes the
-- player has not learned are not written: the site does not use them, and the complete list holds hundreds.
-- A trainer window lists each profession recipe's required rank and training cost: one row per
-- recipe, rank and cost. Reads windows the player opened. Never crafts, clicks, trains or plays.
--
-- Existing readers checked against the client's own files for build 1.60.1.70450 (see CHANGELOG 0.3.2).
-- GetAllRecipeIDs is optional: clients without it retain the filtered reader, without changing filters.
--   C_TradeSkillUI.GetBaseProfessionInfo / GetChildProfessionInfo   profession name, skill level
--   C_TradeSkillUI.GetAllRecipeIDs / GetFilteredRecipeIDs            complete list when available, else filtered
--   C_TradeSkillUI.GetRecipeInfo                                    recipeID, name, relativeDifficulty, learned
--   C_TradeSkillUI.GetRecipeSchematic                               product item, reagent slots
--   C_TradeSkillUI.IsTradeSkillLinked / IsTradeSkillGuild / IsNPCCrafting   whose recipes the window shows
--   C_TradeSkillUI.GetRecipeCooldown (undocumented; Blizzard_Professions.lua calls it)   cooldown, charges
--   C_Item.GetItemNameByID / RequestLoadItemDataByID                reagent names
--   GetProfessions / GetProfessionInfo                              rank when the info reports 0/0
--   GetNumTrainerServices, GetTrainerServiceInfo, GetTrainerServiceSkillReq, GetTrainerServiceCost
--   C_TooltipInfo.GetTrainerService (documented; GameTooltip:SetTrainerService reads it) / GetTrainerServiceItemLink
--     (undocumented, optional)                                     a trainer service's recipe spell or item ID
-- A missing call records nothing and /everloot status says which one.
--
-- The same read also keeps, on this computer only, what the current character itself can craft
-- (crafting_plan.lua): only while all three source checks say the window is the player's own, only recipes whose
-- learned is exactly true, keyed by E.CharacterKey() and the profession's skill line. Neither recipe list is
-- documented as complete (the filtered one follows the player's filters), so a read adds and removes only the
-- recipes it saw and never treats a recipe missing from the list as forgotten.

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

--- True only when the client says the open window is the player's own profession, not a linked, guild or NPC
--- one. A check that is missing, throws or returns anything but false is not proof.
local function ownSource()
  local T = C_TradeSkillUI
  -- Three separate lookups: a missing one must fail the check, not shorten a list.
  for _, check in pairs({ linked = T.IsTradeSkillLinked or false, guild = T.IsTradeSkillGuild or false, npc = T.IsNPCCrafting or false }) do
    if type(check) ~= "function" then return false end
    local ok, value = pcall(check)
    if not ok or E.Readable(value) ~= false then return false end
  end
  return true
end

--- Preserve what the undocumented API actually returned. No return is not an explicit zero cooldown.
local function readCooldown(recipeId, entry)
  local T = C_TradeSkillUI
  if type(T.GetRecipeCooldown) ~= "function" then return end
  local ok, cooldown, isDay, charges, maxCharges = pcall(T.GetRecipeCooldown, recipeId)
  if not ok then return end
  cooldown, charges, maxCharges = E.Readable(cooldown), E.Readable(charges), E.Readable(maxCharges)
  isDay = E.Readable(isDay)
  entry.cooldownReturned = cooldown ~= nil or isDay ~= nil or charges ~= nil or maxCharges ~= nil
  entry.cooldownCheckedAt = time()
  local function nonnegative(n) return type(n) == "number" and n >= 0 and n < math.huge end
  if cooldown ~= nil and not nonnegative(cooldown) then return end
  if charges ~= nil and not nonnegative(charges) then return end
  if maxCharges ~= nil and not nonnegative(maxCharges) then return end
  entry.cooldown, entry.charges, entry.maxCharges = cooldown, charges, maxCharges
  if type(isDay) == "boolean" then entry.isDayCooldown = isDay end
  if (cooldown and cooldown > 0) or isDay == true or (maxCharges and maxCharges > 0) then
    entry.cooldownLimited = true
  end
  if charges and maxCharges and maxCharges > 0 then entry.available = charges > 0
  elseif cooldown ~= nil then entry.available = cooldown == 0 end
end

--- This character's capability from one schematic: output range and basic reagent item IDs. A slot several
--- items can fill gives no reagent list, so no route is guessed.
local function capability(recipeId, schematic)
  local entry = { recipeId = recipeId, learned = true }
  if type(schematic) == "table" then
    local output = E.Readable(schematic.outputItemID)
    local minimum, maximum = E.Readable(schematic.quantityMin), E.Readable(schematic.quantityMax)
    if whole(output) and whole(minimum) and whole(maximum) and minimum <= maximum then
      entry.itemId, entry.minimum, entry.maximum = output, minimum, maximum
    end
    local reagents = type(schematic.reagentSlotSchematics) == "table" and {} or nil
    for _, slot in ipairs(type(schematic.reagentSlotSchematics) == "table" and schematic.reagentSlotSchematics or {}) do
      if type(slot) ~= "table" then reagents = nil; break end
      if slot.required ~= false then
        if slot.reagentType ~= REAGENT_BASIC or (slot.dataSlotType ~= nil and slot.dataSlotType ~= SLOT_REAGENT) then
          reagents = nil
          break
        end
        local options = type(slot.reagents) == "table" and slot.reagents or {}
        local itemId = options[1] and E.Readable(options[1].itemID)
        if #options == 1 and whole(itemId) and whole(slot.quantityRequired) then
          reagents[#reagents + 1] = { itemId = itemId, count = slot.quantityRequired }
        else
          reagents = nil
          break
        end
      end
    end
    entry.reagents = reagents
  end
  readCooldown(recipeId, entry)
  return entry
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
  return name, rank, (whole(maxRank) and maxRank <= MAX_RANK) and maxRank or nil, whole(skillLine) and skillLine or nil
end

--- A current cooldown read of one of this character's own recipes, for the crafting planner. It reads only while the
--- trade-skill window is open on the player's own profession with that skill line, for the character the planner
--- asked about; otherwise it returns nil and why, and GetRecipeCooldown is never called. A successful call returns
--- { cooldown, isDayCooldown, charges, maxCharges, returned }: all four nil (returned = false) is the client's own
--- ready shape, which Blizzard's profession frame treats as not on cooldown. A missing API, an error or a value that
--- is not a non-negative number returns nil.
function E.CurrentRecipeCooldown(characterKey, professionId, recipeId)
  if not windowOpen then return nil, "profession window closed" end
  if type(characterKey) ~= "string" or E.CharacterKey() ~= characterKey then return nil, "another character" end
  local T = C_TradeSkillUI
  if type(T) ~= "table" or type(T.GetRecipeCooldown) ~= "function" then return nil, "no cooldown API" end
  if not whole(professionId) or not whole(recipeId) then return nil, "unknown recipe" end
  local ok, _, _, _, skillLine = pcall(windowProfession)
  if not ok or skillLine ~= professionId then return nil, "another profession open" end
  if not ownSource() then return nil, "not the player's own window" end
  local called, cooldown, isDay, charges, maxCharges = pcall(T.GetRecipeCooldown, recipeId)
  if not called then return nil, "read failed" end
  cooldown, isDay, charges, maxCharges = E.Readable(cooldown), E.Readable(isDay), E.Readable(charges), E.Readable(maxCharges)
  local function valid(n) return n == nil or (type(n) == "number" and n >= 0 and n < math.huge) end
  if not (valid(cooldown) and valid(charges) and valid(maxCharges)) then return nil, "unreadable" end
  return { cooldown = cooldown, isDayCooldown = type(isDay) == "boolean" and isDay or nil, charges = charges,
    maxCharges = maxCharges, returned = cooldown ~= nil or isDay ~= nil or charges ~= nil or maxCharges ~= nil }
end

--- Write the row a recipe's highest rank at its last colour is waiting in, if any.
local function flush(recipe)
  local waiting = EverlootDB.recipeWaiting and EverlootDB.recipeWaiting[recipe]
  if not waiting then return end
  EverlootDB.recipeWaiting[recipe] = nil
  EverlootDB.recipeFlushed = EverlootDB.recipeFlushed or {}
  EverlootDB.recipeFlushed[recipe] = date("!%Y-%m-%d")
  E:Store("recipe_observed", waiting)
end

--- Write the waiting rows at logout, at most one per recipe per UTC day: a waiting row is saved with the
--- file, so a reload loses nothing by leaving it, and writing it each time would add a row per reload.
local function flushAll()
  local today = date("!%Y-%m-%d")
  local flushed = EverlootDB and EverlootDB.recipeFlushed or {}
  for recipe in pairs(EverlootDB and EverlootDB.recipeWaiting or {}) do
    if flushed[recipe] ~= today then flush(recipe) end
  end
end

--- One recipe into a row: "stored", "known" (nothing new), "pending" (reagent names not loaded),
--- "alternatives" (stored without reagents), "unlearned" (not written) or "skipped".
--- capture, when given, collects this character's capability. It runs before the install-wide checks below, so a
--- recipe another character on this install already observed is still captured for this one.
local function readRecipe(id, profession, rank, maxRank, skillLineId, capture)
  id = E.Readable(id)
  if not whole(id) then return "skipped" end
  local T = C_TradeSkillUI
  local okInfo, info = pcall(T.GetRecipeInfo, id)
  info = E.Readable(info)
  if not okInfo or type(info) ~= "table" or E.Readable(info.isDummyRecipe) or not text(E.Readable(info.name), 120) then return "skipped" end
  -- recipeID is the trade-skill API's identity, not an item ID or a separately observed spell ID.
  local recipeId = E.Readable(info.recipeID)
  if not whole(recipeId) then recipeId = id end
  local learned = E.Readable(info.learned)
  if type(learned) ~= "boolean" then learned = nil end
  -- One schematic read serves both the capability and the observation.
  local schematicRead, schematicValue = false, nil
  local function getSchematic()
    if not schematicRead then
      schematicRead = true
      local ok, value = pcall(T.GetRecipeSchematic, id, false)
      value = E.Readable(value)
      schematicValue = ok and type(value) == "table" and value or nil
    end
    return schematicValue
  end
  if capture then
    if learned == true then capture[#capture + 1] = capability(recipeId, getSchematic())
    elseif learned == false then capture[#capture + 1] = { recipeId = recipeId, learned = false } end
  end
  local colour = DIFFICULTY[E.Readable(info.relativeDifficulty)]
  if not colour then return "skipped" end
  if learned == false then return "unlearned" end
  -- Do not reuse the legacy name key: it would lose identity and learned-state information.
  local recipe = profession .. "|" .. recipeId
  if skillLineId then recipe = recipe .. "|skill:" .. skillLineId end
  local key = "id|" .. recipe .. "|" .. colour .. "|" .. tostring(learned)
  local span = EverlootDB.recipeSpan[key]
  local known = span and rank >= span.min and rank <= span.max
  if known and EverlootDB.recipeOutput[recipeId] then return "known" end

  local schematic = getSchematic()
  if not schematic then return known and "known" or "skipped" end
  -- Keep display-only output data beside the recipe index, outside the uploaded recipe observations.
  local output = E.Readable(schematic.outputItemID)
  local minimum, maximum = E.Readable(schematic.quantityMin), E.Readable(schematic.quantityMax)
  if whole(output) and whole(minimum) and whole(maximum) and minimum <= maximum then
    EverlootDB.recipeOutput[recipeId] = { itemId = output, minimum = minimum, maximum = maximum }
  end
  if known then return "known" end
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

  local row = {
    installId = EverlootDB.installId,
    capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    profession = profession,
    skillLineId = skillLineId,
    rank = rank,
    maxRank = maxRank,
    recipe = info.name,
    recipeId = recipeId,
    learned = learned,
    difficulty = colour,
    productItemId = whole(output) and output or nil,
    reagents = reagents,
  }
  -- The colour changed: the highest rank the last colour was seen at is now final.
  local waiting = EverlootDB.recipeWaiting[recipe]
  if waiting and (waiting.difficulty ~= colour or waiting.learned ~= learned) then flush(recipe) end
  if span and rank > span.max then
    -- A new highest rank for this colour replaces the one waiting; it is written when the colour changes.
    EverlootDB.recipeWaiting[recipe] = row
    span.max = rank
    return "known"
  end
  if not E:Store("recipe_observed", row) then return "skipped" end
  EverlootDB.recipeSpan[key] = { min = rank, max = span and span.max or rank }
  return ambiguous and "alternatives" or "stored"
end

local readWindow

local function finish(stats, profession, rank, maxRank)
  lastWindow = string.format("%s %d%s, %d recipes listed, %d new rows, %d without a colour or schematic",
    profession, rank, maxRank and ("/" .. maxRank) or "", stats.listed, stats.stored + stats.alternatives, stats.skipped)
  if stats.alternatives > 0 then lastWindow = lastWindow .. string.format(", %d with alternative reagents stored without reagents", stats.alternatives) end
  if stats.pending > 0 then lastWindow = lastWindow .. string.format(", %d waiting for reagent names", stats.pending) end
  if stats.unlearned > 0 then lastWindow = lastWindow .. string.format(", %d not learned (not recorded)", stats.unlearned) end
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
  local profession, rank, maxRank, skillLineId = windowProfession()
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
  EverlootDB.recipeSpan = EverlootDB.recipeSpan or {}
  EverlootDB.recipeWaiting = EverlootDB.recipeWaiting or {}
  EverlootDB.recipeOutput = EverlootDB.recipeOutput or {}
  pass = pass + 1
  local mine = pass
  -- Capability is captured only for an identified character, a profession with an ID and the player's own window.
  -- E.CraftingPlan is looked up here, at read time, never captured when this file loads.
  local plan = E.CraftingPlan
  local characterKey = E.CharacterKey()
  local capture = (plan and characterKey and skillLineId and ownSource()) and {} or nil
  local total = math.min(#ids, MAX_RECIPES)
  local stats = { listed = total, stored = 0, alternatives = 0, pending = 0, skipped = 0, unlearned = 0, source = source, capped = #ids > MAX_RECIPES }
  local nextIndex = 1
  local function step()
    if mine ~= pass or not windowOpen or not E:IsEnabled("professions") then return end
    local last = (C_Timer and C_Timer.After) and math.min(total, nextIndex + CHUNK - 1) or total
    for i = nextIndex, last do
      local ok, result = pcall(readRecipe, ids[i], profession, rank, maxRank, skillLineId, capture)
      result = ok and result or "skipped"
      if result == "stored" then stats.stored = stats.stored + 1
      elseif result == "alternatives" then stats.alternatives = stats.alternatives + 1
      elseif result == "pending" then stats.pending = stats.pending + 1
      elseif result == "unlearned" then stats.unlearned = stats.unlearned + 1
      elseif result == "skipped" then stats.skipped = stats.skipped + 1 end
    end
    nextIndex = last + 1
    if nextIndex <= total then C_Timer.After(0, step); return end
    -- Kept only if it is still the same character and its own window at the end. Never complete: see the header.
    local _, _, _, currentSkillLineId = windowProfession()
    if capture and E.CharacterKey() == characterKey and currentSkillLineId == skillLineId and ownSource() then
      pcall(plan.ReplaceKnown, characterKey, skillLineId, capture, false)
    end
    finish(stats, profession, rank, maxRank)
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

--- Match the trainer's localized requirement against the player's profession book.
--- Do not infer an ID from an English name or from another open trade-skill window.
local function professionSkillLine(name)
  if type(GetProfessions) ~= "function" or type(GetProfessionInfo) ~= "function" then return nil end
  local ok, indices = pcall(function() return { GetProfessions() } end)
  if not ok then return nil end
  for _, index in pairs(indices) do
    local got, bookName, _, _, _, _, _, skillLine = pcall(GetProfessionInfo, index)
    if got and bookName == name and whole(skillLine) then return skillLine end
  end
end

-- A trainer link can identify a spell or an item; these namespaces are never interchangeable.
local function linkIdentity(index)
  if type(GetTrainerServiceItemLink) ~= "function" then return nil, nil end
  local ok, link = pcall(GetTrainerServiceItemLink, index)
  link = E.Readable(link)
  if not ok or type(link) ~= "string" then return nil, nil end
  local spell = tonumber(link:match("|Hspell:(%d+)[^%d]"))
  local item = tonumber(link:match("|Hitem:(%d+)[^%d]"))
  return whole(spell) and spell or nil, whole(item) and item or nil
end

-- The tooltip data Blizzard's trainer rows show (TooltipDataHandler.lua maps SetTrainerService to
-- C_TooltipInfo.GetTrainerService and reads its type and id). Only the client's own Enum.TooltipDataType says which
-- namespace the id is in; without it the id proves nothing.
local function tooltipIdentity(index)
  local get = type(C_TooltipInfo) == "table" and C_TooltipInfo.GetTrainerService
  local kinds = type(Enum) == "table" and type(Enum.TooltipDataType) == "table" and Enum.TooltipDataType
  if type(get) ~= "function" or not kinds then return nil, nil end
  local ok, data = pcall(get, index)
  data = ok and E.Readable(data)
  if type(data) ~= "table" then return nil, nil end
  local kind, id = E.Readable(data.type), E.Readable(data.id)
  if not whole(id) or kind == nil then return nil, nil end
  if kind == kinds.Spell then return id, nil end
  if kind == kinds.Item then return nil, id end
  return nil, nil
end

--- A trainer service's identity: { spellId, itemId, source, itemSource } from the tooltip data, else an explicit
--- spell or item link, or nil and why ("conflict" when the two disagree, "no identity"). A spell ID is only ever a
--- spell and an item ID only ever an item; nothing is matched by name.
function E.TrainerServiceIdentity(index)
  if not whole(index) then return nil, "no identity" end
  local tipSpell, tipItem = tooltipIdentity(index)
  local linkSpell, linkItem = linkIdentity(index)
  if (tipSpell and linkSpell and tipSpell ~= linkSpell) or (tipItem and linkItem and tipItem ~= linkItem) then
    return nil, "conflict"
  end
  if not (tipSpell or linkSpell or tipItem or linkItem) then return nil, "no identity" end
  return { spellId = tipSpell or linkSpell, itemId = tipItem or linkItem,
    source = (tipSpell and "tooltip") or (linkSpell and "link") or nil,
    itemSource = (tipItem and "tooltip") or (linkItem and "link") or nil }
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
      local skillLineId = professionSkillLine(profession)
      -- The recorded product item comes only from an item link, as before; a tooltip item is not known to be the product.
      local identity = E.TrainerServiceIdentity(i)
      local spellId = identity and identity.spellId
      local productItemId = identity and identity.itemSource == "link" and identity.itemId or nil
      local key = profession .. "|" .. name .. "|" .. rank .. "|" .. tostring(cost)
      if trainerNpcId then key = key .. "|" .. trainerNpcId end
      -- Older installs already know the name-only key. Enrich once when identities become readable.
      if skillLineId then key = key .. "|skill:" .. skillLineId end
      if spellId then key = key .. "|spell:" .. spellId end
      if productItemId then key = key .. "|item:" .. productItemId end
      if not EverlootDB.trainerSeen[key] then
        local stored = E:Store("trainer_seen", {
          installId = EverlootDB.installId,
          capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
          profession = profession,
          skillLineId = skillLineId,
          spellId = spellId,
          productItemId = productItemId,
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

--- 0.3.16 and earlier wrote every listed recipe at every rank, learned or not, and filled the kind within hours.
--- The rows for recipes not learned are dropped (the site ignores them) and the pause lifts when there is room.
local function upgradeOldRows()
  if EverlootDB.recipeSeen == nil then return end
  EverlootDB.recipeSeen = nil
  local kept = {}
  for _, row in ipairs(EverlootDB.records.recipe_observed or {}) do
    if row.learned ~= false then kept[#kept + 1] = row end
  end
  EverlootDB.records.recipe_observed = kept
  if EverlootDB.paused and #kept < E.MAX_ROWS_PER_KIND then EverlootDB.paused.recipe_observed = nil end
end

E:RegisterModule("professions", function()
  upgradeOldRows()
  local f = E.frame
  for _, name in ipairs({ "TRADE_SKILL_SHOW", "TRADE_SKILL_LIST_UPDATE", "TRADE_SKILL_DATA_SOURCE_CHANGED", "TRADE_SKILL_CLOSE",
    "NEW_RECIPE_LEARNED", "TRAINER_SHOW", "TRAINER_UPDATE", "PLAYER_LOGOUT" }) do
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
    elseif event == "TRAINER_SHOW" or event == "TRAINER_UPDATE" then pcall(trainer)
    elseif event == "PLAYER_LOGOUT" then pcall(flushAll) end
  end)
  return note(describe(missingTradeSkillApi(), "ready, recipe colours from the open profession window"),
    describe(missingTrainerApi(), "ready, required ranks from trainers"))
end)
