-- A read-only estimate in the recipe schematic Blizzard already displays in WoW: Forever.
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

local function readRecipe(form)
  local info = E.Readable(form:GetRecipeInfo())
  local schematic = E.Readable(form.recipeSchematic)
  if type(info) ~= "table" or not positiveInteger(info.recipeID) or E.Readable(info.isGatheringRecipe)
    or E.Readable(info.isRecraft) or form.isInspection or type(schematic) ~= "table" then return end
  if form.transaction and form.transaction:IsRecraft() then return end
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
  return { live = true, product = product, output = output, reagents = reagents }
end

local function hideTooltip(panel)
  if GameTooltip and GameTooltip:IsOwned(panel) then GameTooltip:Hide() end
end

local function showDetails(panel)
  local row = panel.estimate
  if not row or not GameTooltip then return end
  GameTooltip:SetOwner(panel, "ANCHOR_RIGHT")
  GameTooltip:AddLine("Everloot Crafting Costs")
  for _, part in ipairs(row.parts) do
    local name = part.ambiguous and part.item or (part.count .. " x " .. part.item)
    local price = part.unit and (U.Money(part.unit * part.count) .. (part.vendor and " (vendor)" or "")) or "No price"
    GameTooltip:AddLine(name .. ": " .. price, 1, 1, 1, true)
  end
  if row.output then
    local quantity = row.output.minimum == row.output.maximum and tostring(row.output.minimum)
      or (row.output.minimum .. "-" .. row.output.maximum)
    GameTooltip:AddLine("Output per craft: " .. quantity, 1, 1, 1)
  end
  if row.profit then
    GameTooltip:AddLine("Estimated sale after " .. row.cut .. "% AH cut, less required materials.", 1, 1, 1, true)
  elseif not row.value then
    GameTooltip:AddLine("No auction price for the finished item.", 1, 1, 1, true)
  elseif not row.output then
    GameTooltip:AddLine("Recipe yield unavailable.", 1, 1, 1, true)
  end
  GameTooltip:AddLine(panel.source, 0.8, 0.8, 0.8, true)
  GameTooltip:Show()
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
  local recipe = form:IsVisible() and readRecipe(form)
  if not recipe or not placePanel(panel, form) then
    panel.estimate = nil
    hideTooltip(panel)
    panel:Hide()
    return
  end
  local row, status, source, checking = U.NativeCraftEstimate(recipe)
  local unavailable = checking and "Checking prices..." or "Unavailable"
  local profit = row.profit
  local profitAmount = profit and ((profit > 0 and "+" or "") .. U.Money(profit)) or unavailable
  if profit and profit ~= 0 then profitAmount = (profit > 0 and "|cff80e080" or "|cffff8080") .. profitAmount .. "|r" end
  panel.cost:SetText("Cost per craft: " .. (row.cost and U.Money(row.cost) or unavailable))
  panel.profit:SetText("Est. profit: " .. profitAmount)
  panel.details:SetText(status:find("^Old price file") and "|cffffc66dOld prices|r" or "Details")
  panel.estimate, panel.source = row, source
  panel:Show()
  if GameTooltip and GameTooltip:IsOwned(panel) then showDetails(panel) end
  return checking
end

local function attach()
  local page = ProfessionsFrame and ProfessionsFrame.CraftingPage
  local form = page and page.SchematicForm
  if not form or type(form.Init) ~= "function" or type(form.GetRecipeInfo) ~= "function" or not hooksecurefunc then return end
  if panels[form] then return end
  local panel = createPanel(form)
  panels[form] = panel
  local pending
  local function schedule(delay, retries)
    -- Run after Blizzard's layout and coalesce several Init calls in the same frame.
    if pending then return end
    pending = true
    C_Timer.After(delay, function()
      pending = false
      if refresh(form, panel) and retries > 0 then schedule(0.15, retries - 1) end
    end)
  end
  local function changed() schedule(0, 20) end
  hooksecurefunc(form, "Init", changed)
  if type(form.UpdateRecipeDescription) == "function" then hooksecurefunc(form, "UpdateRecipeDescription", changed) end
  form:HookScript("OnShow", changed)
  changed()
end

local listener = CreateFrame("Frame")
listener:RegisterEvent("ADDON_LOADED")
listener:RegisterEvent("TRADE_SKILL_SHOW")
listener:SetScript("OnEvent", function(_, event, name)
  if event == "TRADE_SKILL_SHOW" or name == "Everloot" or name == "Blizzard_Professions" then attach() end
end)
