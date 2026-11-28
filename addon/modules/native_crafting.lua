-- A read-only estimate in the recipe schematic Blizzard already displays in WoW: Forever.
-- With the recipe planner loaded it also plans materials for this character: a craft count (- and +), and Add materials,
-- which first previews the character's combined recipe plan with this recipe at that count (replacing any count saved
-- for it) and saves it on a second press (CraftingPlan.Put; 0 crafts removes it). The cost, profit and tags stay per
-- one craft; the preview says its count. Nothing here crafts or buys.
-- Details also gives, for that count, each material's listing depth and 7-day median from this house's own full scans
-- (crafting_history.lua) and the break-even price of the costliest material (Crafting.BreakEven): context, not inputs.
-- In the trainer window (Blizzard_TrainerUI, loaded on demand) a profession recipe's own hover gains its estimated profit
-- and training payback (Crafting.TrainerEstimate). Rows are recycled frames of ClassTrainerFrame.ScrollBox: each frame
-- gets one OnEnter hook through ScrollUtil's initialized-frame callback, and the hook reads the row's current element
-- data when it runs, so a rebound row never shows another service. The row has no room for a figure beside its price
-- (Blizzard_TrainerUI_Camelot.lua sizes the name against it), so nothing is drawn on the row. Never trains.
local E, U = Everloot, Everloot.Window
local panels = {}
local HEIGHT, WIDTH, MIN_WIDTH = 34, 260, 185
local BASIC_REAGENT, ITEM_SLOT = 1, 1
local REAGENT_REGIONS = { "Reagents", "OptionalReagents", "FinishingReagents", "Concentrate" }

local function positiveInteger(value)
  value = E.Readable(value)
  if type(value) == "number" and value > 0 and value % 1 == 0 then return value end
end

local function reagentName(itemId)
  local name = C_Item and C_Item.GetItemNameByID and E.Readable(C_Item.GetItemNameByID(itemId))
  return type(name) == "string" and name:gsub("|", "||") or ("Item " .. itemId)
end

--- A recipe the shared calculator can price, from the client's recipe info and schematic, or nil for a gathering,
--- recraft or unreadable recipe. Reagent slots with several items or no readable item stay unpriced.
function E.NativeRecipe(info, schematic)
  info, schematic = E.Readable(info), E.Readable(schematic)
  if type(info) ~= "table" or not positiveInteger(info.recipeID) or E.Readable(info.isGatheringRecipe)
    or E.Readable(info.isRecraft) or type(schematic) ~= "table" then return end
  local slots = E.Readable(schematic.reagentSlotSchematics)
  if type(slots) ~= "table" then return end
  local product = positiveInteger(schematic.outputItemID)
  local minimum, maximum = positiveInteger(schematic.quantityMin), positiveInteger(schematic.quantityMax)
  local output = product and minimum and maximum and minimum <= maximum
    and { itemId = product, minimum = minimum, maximum = maximum } or nil
  local reagents = {}
  for _, entry in ipairs(slots) do
    local slot = E.Readable(entry)
    local required = type(slot) == "table" and E.Readable(slot.required)
    if required == true or (required == nil and E.Readable(slot.reagentType) == BASIC_REAGENT) then
      local options = E.Readable(slot.reagents)
      local item = type(options) == "table" and #options == 1 and E.Readable(options[1])
      local slotType = E.Readable(slot.dataSlotType)
      local id = type(item) == "table" and (not slotType or slotType == ITEM_SLOT) and positiveInteger(item.itemID)
      local count = positiveInteger(slot.quantityRequired)
      if id and count then
        reagents[#reagents + 1] = { item = reagentName(id), id = id, count = count }
      else
        local reason = type(options) == "table" and #options > 1
          and "Slot accepts multiple reagents" or "Required reagent unavailable"
        reagents[#reagents + 1] = { item = reason, count = count or 1, ambiguous = true }
      end
    end
  end
  if not product and #reagents == 0 then return end
  local name = E.Readable(info.name)
  return { live = true, product = product, output = output, reagents = reagents, id = positiveInteger(info.recipeID),
    key = positiveInteger(info.recipeID), name = type(name) == "string" and name or ("Recipe " .. info.recipeID) }
end

local function readRecipe(form)
  if form.isInspection or (form.transaction and form.transaction:IsRecraft()) then return end
  return E.NativeRecipe(form:GetRecipeInfo(), form.recipeSchematic)
end

local MAX_CRAFTS = 9999

local function plural(n, word) return n .. " " .. word .. (n == 1 and "" or "s") end

-- The crafts this character's saved plan has for a recipe, or nil.
local function savedCrafts(recipeId)
  local CP = E.CraftingPlan
  if not (CP and recipeId) then return nil end
  for _, e in ipairs(CP.Plans(E.CharacterKey()).entries) do
    if e.recipeId == recipeId then return e.crafts end
  end
end

-- The schematic's reagent slots without one known item, named for the plan's partial receipt.
local function unresolvedOf(recipe)
  local out = {}
  for _, g in ipairs(recipe.reagents or {}) do
    if g.ambiguous then out[#out + 1] = { item = g.item, count = g.count } end
  end
  return out
end

-- The count and Add materials as they stand: "3 crafts", "Remove" at 0 (only for a recipe already planned).
local function drawControls(panel)
  if not panel.add then return end
  local planner = E.CraftingPlan and panel.planning.recipe and panel.planning.recipe.id
  for _, control in ipairs({ panel.minus, panel.countText, panel.plus, panel.add }) do
    if planner then control:Show() else control:Hide() end
  end
  panel.countText:SetText(panel.planning.count == 0 and "Remove" or plural(panel.planning.count, "craft"))
  panel.add:SetText(panel.planning.confirm and panel.planning.confirm.ok and "Save plan" or "Add materials")
end

local function hideTooltip(panel)
  if GameTooltip and GameTooltip:IsOwned(panel) then GameTooltip:Hide() end
end

-- Where a quote comes from and how old it is: "your scan", "community Oct 26, 4 days ago", "community", or another
-- addon's price with its unknown age and market: "TSM AHDBMedianBuyout, age and market unknown".
local function priceSource(source, observed)
  local external = U.CraftExternalLabel and U.CraftExternalLabel(source)
  if external then return external end
  if source == "scan" then return "your scan" end
  local day = observed and E.ShortDay(observed)
  if not day then return "community" end
  local age = (E.DayNumber(date("!%Y-%m-%d")) or 0) - (E.DayNumber(observed) or 0)
  return "community " .. day .. ", " .. (age <= 0 and "today" or (age == 1 and "1 day ago" or (age .. " days ago")))
end

local function ago(seconds)
  if seconds < 60 then return "just now" end
  if seconds < 3600 then return math.floor(seconds / 60) .. " min ago" end
  if seconds < 86400 then return math.floor(seconds / 3600) .. " h ago" end
  return plural(math.floor(seconds / 86400), "day") .. " ago"
end

local function signedMoney(copper) return (copper > 0 and "+" or "") .. U.Money(copper) end

-- Why a material has no break-even, after "No break-even for <item>: ".
local NO_BREAK_EVEN = {
  unpriced = "another material has no price",
  ["no sale price"] = "the finished item has no price",
  ["no yield"] = "the recipe's yield is unknown",
  loss = "the other materials already cost more than the sale",
  made = "your cheapest route crafts it",
}

-- This house's own-scan context for the selected count (crafting_history.lua): each material's depth, its 7-day
-- median and today's change, and the break-even of the material with the largest cost. Beside the estimate, never
-- an input to it. Reads only; nothing is quoted from community, sample or partial prices.
local function marketLines(panel, row)
  local H, recipe = E.CraftingHistory, panel.planning.recipe
  if not (H and recipe) then return {} end
  local crafts = math.max(1, panel.planning.count or 1)
  local context = U.CraftContext(E.CurrentRealm(), E:MarketHouse())
  local realm, house, now = context.realm, context.house, time()
  local lines, any = { "Your " .. tostring(house) .. " scans, for " .. plural(crafts, "craft") .. ":" }, false
  -- Another addon prices the estimate; these lines stay this install's own full scans, and say so.
  local external = row.priceSource and E.CraftingSources and E.CraftingSources.External(row.priceSource.name)
  if external then
    lines[1] = "Your " .. tostring(house) .. " scans only (not " .. row.priceSource.label .. "), for " .. plural(crafts, "craft") .. ":"
  end
  local seen, costliest = {}, nil
  for _, part in ipairs(row.parts) do
    if part.id and not part.ambiguous and not seen[part.id] then
      seen[part.id] = true
      local count = 0
      for _, p in ipairs(row.parts) do if p.id == part.id then count = count + p.count end end
      local name, need = tostring(part.item):gsub("|", "||"), count * crafts
      local q = H.Quote(realm, house, part.id, need, now)
      if q then
        any = true
        local scanned = " (newest scan " .. ago(math.max(0, now - q.at)) .. ")"
        if q.available == 0 then
          lines[#lines + 1] = name .. ": none listed" .. scanned
        elseif q.covered then
          lines[#lines + 1] = name .. ": buying " .. need .. " of " .. (q.truncated and "at least " or "") .. q.available
            .. " listed costs " .. U.Money(q.cost)
            .. (q.truncated and (" (cheapest " .. H.LEVELS .. " prices kept; newest scan " .. ago(math.max(0, now - q.at)) .. ")") or scanned)
        elseif q.truncated then
          lines[#lines + 1] = name .. ": the cheapest " .. H.LEVELS .. " prices kept hold " .. q.available .. " of " .. need
            .. ", costing " .. U.Money(q.cost) .. "; listings past them are unknown" .. scanned
        else
          lines[#lines + 1] = name .. ": insufficient depth: " .. q.available .. " of " .. need .. " listed, costing "
            .. U.Money(q.cost) .. "; " .. q.shortfall .. " short" .. scanned
        end
      end
      local c = H.Change(realm, house, part.id, now)
      if c.median then
        any = true
        lines[#lines + 1] = name .. ": 7-day median " .. U.Money(c.median) .. " (" .. c.days .. " of " .. H.WINDOW
          .. " days scanned" .. (c.days < H.WINDOW and (", " .. (H.WINDOW - c.days) .. " missing") or "") .. "); "
          .. (c.today and ("today " .. U.Money(c.today) .. ", " .. signedMoney(c.change) .. " ("
            .. string.format("%+.1f%%", c.percent) .. ")") or "not scanned today")
      elseif c.days > 0 then
        any = true
        lines[#lines + 1] = name .. ": no 7-day median yet (" .. c.days .. " of " .. H.WINDOW .. " days scanned, "
          .. H.MIN_DAYS .. " needed)"
      end
      local cost = part.unit and part.unit * count
      if cost and (not costliest or cost > costliest.cost or (cost == costliest.cost and part.id < costliest.id)) then
        costliest = { id = part.id, name = name, unit = part.unit, cost = cost,
          from = U.CraftExternalLabel(part.source) or (part.fallback and "Everloot fallback") }
      end
    end
  end
  if recipe.product then
    local c = H.Change(realm, house, recipe.product, now)
    if c.median then
      any = true
      lines[#lines + 1] = "Finished item: 7-day median " .. U.Money(c.median) .. " (" .. c.days .. " of " .. H.WINDOW
        .. " days scanned); " .. (c.today and ("today " .. U.Money(c.today) .. ", " .. signedMoney(c.change)) or "not scanned today")
    end
  end
  if not any then
    lines = { "No depth or 7-day history: only your completed full scans of this house count, for recipes this character has learned." }
  end
  if costliest then
    local u, why = E.Crafting.BreakEven(recipe, costliest.id, context, crafts)
    if u then
      lines[#lines + 1] = "Break-even for " .. plural(crafts, "craft") .. ": " .. costliest.name .. " up to " .. U.Money(u)
        .. " each (now " .. U.Money(costliest.unit) .. (costliest.from and (", " .. costliest.from) or "")
        .. "), other materials as above, "
        .. (context.destination == "vendor" and "sold to a vendor" or ("at the AH after its " .. context.cut .. "% cut"))
    elseif NO_BREAK_EVEN[why] then
      lines[#lines + 1] = "No break-even for " .. costliest.name .. ": " .. NO_BREAK_EVEN[why]
    end
  end
  return lines
end

local function showDetails(panel)
  local row = panel.estimate
  if not row or not GameTooltip then return end
  GameTooltip:SetOwner(panel, "ANCHOR_RIGHT")
  GameTooltip:AddLine("Everloot Crafting Costs")
  for _, part in ipairs(row.parts) do
    local name = part.ambiguous and part.item or (part.count .. " x " .. part.item)
    local source = part.vendor and "vendor" or priceSource(part.source, part.observed)
    if part.fallback then source = U.CraftFallbackNote(row.priceSource, part.fallback) .. ": " .. source end
    local price = part.unit and (U.Money(part.unit) .. " each, " .. U.Money(part.unit * part.count) .. " (" .. source .. ")")
      or ("No price" .. U.CraftMissingNote(row.priceSource, part.missing))
    GameTooltip:AddLine(name .. ": " .. price, 1, 1, 1, true)
  end
  if row.output then
    local quantity = row.output.minimum == row.output.maximum and tostring(row.output.minimum)
      or (row.output.minimum .. "-" .. row.output.maximum)
    GameTooltip:AddLine("Output per craft: " .. quantity, 1, 1, 1)
  end
  if row.value then
    local source = priceSource(row.source, row.observed)
    if row.fallback then source = U.CraftFallbackNote(row.priceSource, row.fallback) .. ": " .. source end
    GameTooltip:AddLine("Finished item: " .. U.Money(row.value) .. " each (" .. source .. ")", 1, 1, 1, true)
  elseif row.missing then
    GameTooltip:AddLine("Finished item: no price" .. U.CraftMissingNote(row.priceSource, row.missing), 1, 1, 1, true)
  end
  -- Both destinations per craft; the selected one drives the summary, the row tags and the list's order.
  GameTooltip:AddLine(U.CraftComparison(row, "ah"), 1, 1, 1, true)
  GameTooltip:AddLine(U.CraftComparison(row, "vendor"), 1, 1, 1, true)
  GameTooltip:AddLine("Tags and sorting: " .. (row.destination == "vendor" and "vendor" or "AH"), 0.8, 0.8, 0.8, true)
  -- Context only: a failure here never takes the estimate's own lines with it.
  local ok, market = pcall(marketLines, panel, row)
  for _, line in ipairs(ok and market or {}) do GameTooltip:AddLine(line, 1, 1, 1, true) end
  -- A comparison only: the cost and profit above buy every reagent for one craft.
  if row.plan and U.PlanSummary then
    GameTooltip:AddLine(U.PlanSummary(row.plan), 1, 1, 1, true)
    local note = U.PlanNote(row.plan)
    if note ~= "" then GameTooltip:AddLine(note, 0.8, 0.8, 0.8, true) end
    local ev = row.plan.basis and E.Crafting.CooldownEvidence and E.Crafting.CooldownEvidence()
    if ev and ev.disclosure then GameTooltip:AddLine(ev.disclosure, 0.8, 0.8, 0.8, true) end
  end
  local listing = row.listing
  if listing then
    GameTooltip:AddLine(E.ListedCount(listing[3]) .. " units listed, lowest buyout " .. U.Money(listing[4]), 1, 1, 1, true)
  end
  if row.scanInfo then GameTooltip:AddLine(row.scanInfo, 0.8, 0.8, 0.8, true) end
  GameTooltip:AddLine(panel.source, 0.8, 0.8, 0.8, true)
  local saved = savedCrafts(row.id)
  if saved then GameTooltip:AddLine("In your plan: " .. plural(saved, "craft"), 1, 1, 1, true) end
  local confirm = panel.planning.confirm
  if confirm and panel.planning.recipe and confirm.recipeId == panel.planning.recipe.id then
    for _, line in ipairs(confirm.lines) do GameTooltip:AddLine(line, 1, 1, 1, true) end
  end
  if panel.planning.receipt then GameTooltip:AddLine(panel.planning.receipt, 0.612, 0.941, 0.227, true) end
  GameTooltip:Show()
end

-- The preview of this character's combined plan with the recipe at the chosen count, in lines for Details.
local function previewLines(recipe, count, plan)
  local with, lines = plan.with or {}, {}
  if not with.ok then
    lines[1] = with.said or "Not saved."
    return lines
  end
  local name = (recipe.name or "the recipe"):gsub("|", "||")
  if count == 0 then
    lines[1] = "Removes " .. name .. " from your plan. Press Save plan to confirm."
  else
    lines[1] = "Plan preview: " .. plural(count, "craft") .. " of " .. name
      .. (with.previous and (" (replaces " .. with.previous .. ")") or " (new plan)")
  end
  local crafts = 0
  for _, e in ipairs(plan.entries) do crafts = crafts + e.crafts end
  lines[#lines + 1] = "All plans for this character: " .. plural(#plan.entries, "recipe") .. " · route: "
    .. (plan.strategy == "cheapest" and "cheapest" or "buy all")
  for i, r in ipairs(plan.rows) do
    if i > 8 then lines[#lines + 1] = "... and " .. (#plan.rows - 8) .. " more"; break end
    lines[#lines + 1] = "Need " .. r.need .. " × " .. tostring(r.item):gsub("|", "||") .. " (" .. r.full .. " without bags)"
      .. (r.omitted and ", not listed: over 50 items" or "")
  end
  lines[#lines + 1] = plan.coverage.counted and "Bags counted now; bank, mail and other characters are not counted."
    or ("Bags could not be read (" .. tostring(plan.coverage.reason) .. "): full needs shown.")
  if crafts > 0 then
    lines[#lines + 1] = "Materials for " .. plural(crafts, "craft") .. ": "
      .. (plan.cost and U.Money(plan.cost) or "unknown") .. " (bags never lower this) · to buy now: "
      .. (plan.cashCost and U.Money(plan.cashCost) or "unknown")
  end
  local note = U.PlanNote and U.PlanNote(plan) or ""
  if note ~= "" then lines[#lines + 1] = note end
  if #plan.unresolved > 0 then
    lines[#lines + 1] = "Partial: reagents not all known for " .. plural(#plan.unresolved, "recipe") .. "."
  end
  lines[#lines + 1] = "Press Save plan to keep it."
  return lines
end

-- Add materials: the first press previews, the second (same recipe, count and saved plans) saves.
local function addMaterials(panel)
  local CP, recipe = E.CraftingPlan, panel.planning.recipe
  if not (CP and recipe and recipe.id) then return end
  local key = E.CharacterKey()
  local confirm = panel.planning.confirm
  panel.planning.receipt = nil
  if confirm and confirm.ok and confirm.recipeId == recipe.id and confirm.count == panel.planning.count
      and confirm.revision == CP.revision then
    panel.planning.confirm = nil
    local name = (recipe.name or "the recipe"):gsub("|", "||")
    if panel.planning.count == 0 then
      panel.planning.receipt = CP.Remove(key, nil, recipe.id) and ("Removed " .. name .. " from your plan.")
        or "Nothing to remove."
      panel.planning.count = 1
    else
      local receipt = CP.Put(key, nil, recipe.id, panel.planning.count, { unresolved = unresolvedOf(recipe) })
      if receipt.ok then
        panel.planning.receipt = "Saved: " .. plural(panel.planning.count, "craft") .. " of " .. name
          .. ((receipt.previous and receipt.previous ~= panel.planning.count) and (" (was " .. receipt.previous .. ")") or "") .. "."
        local gaps = {}
        if receipt.partial then gaps[#gaps + 1] = "the recipe's reagents are not all known" end
        if #confirm.plan.omitted > 0 then gaps[#gaps + 1] = #confirm.plan.omitted .. " items over the 50-item limit not listed" end
        if #gaps > 0 then panel.planning.receipt = panel.planning.receipt .. " Partial: " .. table.concat(gaps, "; ") .. "." end
      else
        panel.planning.receipt = receipt.said
      end
    end
  else
    local context = U.CraftContext(E.CurrentRealm(), E:MarketHouse())
    local plan = CP.Preview(key, context, { with = { recipeId = recipe.id, crafts = panel.planning.count,
      unresolved = unresolvedOf(recipe) } })
    panel.planning.confirm = { recipeId = recipe.id, count = panel.planning.count, revision = CP.revision, plan = plan,
      ok = plan.with and plan.with.ok, lines = previewLines(recipe, panel.planning.count, plan) }
  end
  drawControls(panel)
  showDetails(panel)
end

-- - and +: one craft (ten with Shift), from 1 (0 for a recipe already planned, to remove it) to 9,999.
local function step(panel, direction)
  local amount = IsShiftKeyDown and IsShiftKeyDown() and 10 or 1
  local lowest = (panel.planning.recipe and savedCrafts(panel.planning.recipe.id)) and 0 or 1
  panel.planning.count = math.max(lowest, math.min(MAX_CRAFTS, panel.planning.count + direction * amount))
  panel.planning.confirm, panel.planning.receipt = nil, nil
  drawControls(panel)
  if GameTooltip and GameTooltip:IsOwned(panel) then showDetails(panel) end
end

local function createPanel(form)
  local panel = CreateFrame("Button", nil, form)
  panel:SetSize(WIDTH, HEIGHT)
  panel.cost = panel:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  panel.cost:SetPoint("TOPLEFT", 0, -3)
  panel.profit = panel:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  panel.profit:SetPoint("BOTTOMLEFT", 0, 3)
  panel.details = panel:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  panel.details:SetPoint("BOTTOMRIGHT", 0, 3)
  panel.details:SetText("Details")
  panel:SetScript("OnEnter", showDetails)
  panel:SetScript("OnLeave", hideTooltip)
  panel:SetScript("OnHide", hideTooltip)
  panel:SetScript("OnClick", showDetails)
  -- Planning: the count at the top right, Add materials beside Details. Children of the panel, hidden with it.
  panel.planning = { count = 1 }
  local function small(label, width, onClick)
    local b = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
    b:SetSize(width, 16)
    b:SetText(label)
    b:SetScript("OnClick", onClick)
    return b
  end
  panel.minus = small("-", 18, function() step(panel, -1) end)
  panel.minus:SetPoint("TOPRIGHT", panel, "TOPRIGHT", -62, 0)
  panel.countText = panel:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  panel.countText:SetPoint("TOPRIGHT", panel, "TOPRIGHT", -20, -3)
  panel.countText:SetWidth(42)
  panel.countText:SetJustifyH("CENTER")
  panel.plus = small("+", 18, function() step(panel, 1) end)
  panel.plus:SetPoint("TOPRIGHT", panel, "TOPRIGHT", 0, 0)
  panel.add = small("Add materials", 96, function() addMaterials(panel) end)
  panel.add:SetPoint("BOTTOMRIGHT", panel, "BOTTOMRIGHT", -46, 0)
  panel:Hide()
  return panel
end

local function placePanel(panel, form)
  local bottom = form:GetBottom()
  if not bottom then return false end
  local anchor = form
  local reagentBottom
  for _, key in ipairs(REAGENT_REGIONS) do
    local region = form[key]
    local edge = region and region:IsShown() and region:GetBottom()
    if edge and (not reagentBottom or edge < reagentBottom) then anchor, reagentBottom = region, edge end
  end
  panel:ClearAllPoints()
  if reagentBottom and reagentBottom - bottom >= HEIGHT + 48 then
    panel:SetWidth(WIDTH)
    panel:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, -8)
  elseif (not reagentBottom or reagentBottom - bottom >= HEIGHT + 10)
    and not (form.AllocateBestQualityCheckbox and form.AllocateBestQualityCheckbox:IsShown()) then
    local width = WIDTH
    local track = form.TrackRecipeCheckbox
    if track and track:IsShown() then
      local trackLeft, formLeft = track:GetLeft(), form:GetLeft()
      if not trackLeft or not formLeft then return false end
      width = math.min(width, trackLeft - formLeft - 28)
    end
    if width < MIN_WIDTH then return false end
    panel:SetWidth(width)
    panel:SetPoint("BOTTOMLEFT", form, "BOTTOMLEFT", 22, 8)
  else
    return false
  end
  return true
end

local function refresh(form, panel)
  local recipe = form:IsVisible() and E.Crafting.NativeEnabled() and readRecipe(form)
  if not recipe or not placePanel(panel, form) then
    panel.estimate = nil
    panel.planning = { count = 1 }
    hideTooltip(panel)
    panel:Hide()
    return
  end
  -- Another recipe starts at one craft, with no preview or receipt of the last one.
  local planning = panel.planning
  if not planning.recipe or planning.recipe.id ~= recipe.id then
    planning.count, planning.confirm, planning.receipt = 1, nil, nil
  end
  planning.recipe = recipe
  drawControls(panel)
  local row, source, checking = U.NativeCraftEstimate(recipe)
  -- A vendor sell price the client is still loading is looked for again, as a price file being checked is.
  checking = checking or (row.destination == "vendor" and row.vendorPending) or false
  local unavailable = checking and "Checking prices..." or "Unavailable"
  local profit = row.profit
  local profitAmount = profit and ((profit > 0 and "+" or "") .. U.Money(profit)) or unavailable
  if profit and profit ~= 0 then profitAmount = (profit > 0 and "|cff80e080" or "|cffff8080") .. profitAmount .. "|r" end
  panel.cost:SetText("Cost per craft: " .. (row.cost and U.Money(row.cost) or unavailable))
  panel.profit:SetText((row.destination == "vendor" and "Est. profit (vendor): " or "Est. profit: ") .. profitAmount)
  -- Another addon's prices are named on the button itself, available or not.
  local ps = row.priceSource
  local external = ps and E.CraftingSources and E.CraftingSources.External(ps.name)
  panel.details:SetText(row.oldQuote and "|cffffc66dOld prices|r"
    or (external and ("|cffffc66d" .. ps.label .. (ps.available and " prices" or " unavailable") .. "|r")) or "Details")
  panel.estimate, panel.source = row, source
  panel:Show()
  if GameTooltip and GameTooltip:IsOwned(panel) then showDetails(panel) end
  return checking or row.vendorPending
end

local function attach()
  local page = ProfessionsFrame and ProfessionsFrame.CraftingPage
  local form = page and page.SchematicForm
  if not form or type(form.Init) ~= "function" or type(form.GetRecipeInfo) ~= "function" or not hooksecurefunc then return end
  if panels[form] then return end
  local panel = createPanel(form)
  local pending, generation = false, 0
  local function schedule(delay, retries)
    -- Run after Blizzard's layout and coalesce several Init calls in the same frame.
    if pending then return end
    pending = true
    local scheduled = generation
    C_Timer.After(delay, function()
      if scheduled ~= generation then return end
      pending = false
      if refresh(form, panel) then schedule(retries > 0 and 0.15 or 2, math.max(0, retries - 1)) end
    end)
  end
  local function changed()
    generation, pending = generation + 1, false
    schedule(0, 20)
  end
  panels[form] = changed
  hooksecurefunc(form, "Init", changed)
  if type(form.UpdateRecipeDescription) == "function" then hooksecurefunc(form, "UpdateRecipeDescription", changed) end
  form:HookScript("OnShow", changed)
  changed()
end

-- The trainer window -------------------------------------------------------------------------------------------

local trainerRows = setmetatable({}, { __mode = "k" })   -- trainer row frames with Everloot's hover hook
local trainerBoxes = setmetatable({}, { __mode = "k" })  -- trainer scroll boxes with Everloot's callback
local TRAINER = {}                                       -- the callbacks' owner

-- The service a trainer row is bound to now: Blizzard's initializer reads (elementData.data or elementData).skillIndex
-- (ClassTrainerFrame_InitServiceButton); a category row has none.
local function serviceIndex(frame)
  local node = type(frame.GetElementData) == "function" and frame:GetElementData() or nil
  if type(node) ~= "table" then return nil end
  local data = type(node.GetData) == "function" and node:GetData() or node
  data = type(data) == "table" and (data.data or data) or nil
  return type(data) == "table" and positiveInteger(data.skillIndex) or nil
end

local function trainerHover(frame)
  if not (GameTooltip and GameTooltip:IsOwned(frame)) or not E.Crafting.NativeEnabled() then return end
  local index = serviceIndex(frame)
  if not index or type(GetTrainerServiceSkillReq) ~= "function" then return end
  -- Class spells have no profession requirement: only recipes get a line.
  local ok, skill = pcall(GetTrainerServiceSkillReq, index)
  skill = ok and E.Readable(skill)
  if type(skill) ~= "string" or skill == "" then return end
  local cost
  if type(GetTrainerServiceCost) == "function" then
    local got, value = pcall(GetTrainerServiceCost, index)
    value = got and E.Readable(value)
    if type(value) == "number" and value >= 0 and value % 1 == 0 then cost = value end
  end
  local te, why, checking
  local identity
  if E.TrainerServiceIdentity then identity, why = E.TrainerServiceIdentity(index) else why = "no identity" end
  if identity and identity.spellId then
    local context, _, busy = U.CraftContext(E.CurrentRealm(), E:MarketHouse())
    checking = busy
    te, why = E.Crafting.TrainerEstimate({ spellId = identity.spellId, trainingCostCopper = cost }, context)
  elseif identity then
    why = "item"
  end
  GameTooltip:AddLine("Everloot")
  for _, said in ipairs(U.TrainerLines(te, why, checking)) do GameTooltip:AddLine(said, 1, 1, 1, true) end
  GameTooltip:Show()
end

local function hookTrainerRow(frame)
  if type(frame) ~= "table" or trainerRows[frame] or type(frame.HookScript) ~= "function" then return end
  trainerRows[frame] = true
  frame:HookScript("OnEnter", trainerHover)
end

local function attachTrainer()
  local box = ClassTrainerFrame and ClassTrainerFrame.ScrollBox
  if not box or trainerBoxes[box] or not (ScrollUtil and ScrollUtil.AddInitializedFrameCallback) then return end
  trainerBoxes[box] = true
  ScrollUtil.AddInitializedFrameCallback(box, function(_, frame) hookTrainerRow(frame) end, TRAINER, false)
  -- Rows bound before the callback existed.
  if type(box.ForEachFrame) == "function" then box:ForEachFrame(hookTrainerRow) end
end

function E.RefreshNativeCrafting()
  local page = ProfessionsFrame and ProfessionsFrame.CraftingPage
  local refreshPanel = page and panels[page.SchematicForm]
  if refreshPanel then refreshPanel() end
  if E.NativeRecipes then E.NativeRecipes.PricesChanged() end
  if U.RefreshCrafting then U.RefreshCrafting() end
end

local listener = CreateFrame("Frame")
listener:RegisterEvent("ADDON_LOADED")
listener:RegisterEvent("TRADE_SKILL_SHOW")
listener:RegisterEvent("AUCTION_HOUSE_SHOW")
listener:RegisterEvent("AUCTION_HOUSE_CLOSED")
listener:RegisterEvent("TRAINER_SHOW")
listener:SetScript("OnEvent", function(_, event, name)
  if event == "TRADE_SKILL_SHOW" or name == "Everloot" or name == "Blizzard_Professions" then attach() end
  if event == "TRAINER_SHOW" or name == "Everloot" or name == "Blizzard_TrainerUI" then attachTrainer() end
  if event == "AUCTION_HOUSE_SHOW" or event == "AUCTION_HOUSE_CLOSED" then E.RefreshNativeCrafting() end
end)
