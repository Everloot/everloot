-- Everloot in the recipe list of WoW: Forever's profession window (ProfessionsFrame.CraftingPage.RecipeList):
--   Tags: a short signed profit per craft on each visible recipe row. The rows are recycled frames; the tag is set
--     through ScrollUtil's initialized-frame callback, the client's supported hook, from the row's current element
--     data, and cleared on category, divider and released rows, so a recycled row never keeps another recipe's tag.
--   An Everloot list docked beside the window that sorts by profit and filters to profitable recipes: the client has
--     no supported way to sort or filter its own list by an addon value, and its order, categories and filters stay
--     Blizzard's. Clicking a recipe asks the game to open it (C_TradeSkillUI.OpenRecipe). The game can only open a
--     recipe its own search and filters show; the list says when one is hidden instead of claiming it opened.
-- Prices come from Everloot.Crafting through the same context as the Crafting costs page. Display only: it records
-- nothing, and everything here follows Everloot.Crafting.NativeEnabled() (Collect data only, CraftProfit, the
-- character's own choice).

local E, U = Everloot, Everloot.Window
local C = E.Crafting
if not (C and U) then return end
local N = {}
E.NativeRecipes = N

local WIDTH, ROWS, ROW_H = 250, 16, 18
local TOP = 92                -- the title, two button rows and the price line above the recipe rows
local TAG_W = 96              -- Blizzard's 304 px row reserves no room for an addon: one short line, right-aligned
local FAST_TRIES = 40         -- price-file checks every 0.25 s; after that every 2 s until the window closes
local NEXT_TAG = { money = "margin", margin = "both", both = "money" }
local TAG_LABEL = { money = "Tags: gold", margin = "Tags: margin", both = "Tags: both" }
local HIDDEN = " is hidden by the profession window's search or filters. Clear them to open it."
local LEGEND = "+ is an estimated gain per craft, - a loss. \"old\": a price older than two days. "
  .. "\"no price\": a reagent or the item has no price yet. \"checking\": the price file is still being checked or the game is still loading the item. "
  .. "Sell: AH values the item after this house's cut; Sell: vendor at the game's vendor sell price."
local GAIN, LOSS, MUTED = { 0.5, 0.88, 0.5 }, { 1, 0.5, 0.5 }, { 0.7, 0.7, 0.7 }

-- `session` changes when the window closes, so a timer from before never draws into a later window.
local state = { session = 0, cache = {}, recipes = {}, sort = "profit", profitableOnly = false, tag = "money", offset = 0, tries = 0 }
local tags = setmetatable({}, { __mode = "k" })    -- recipe row frame -> Everloot's tag on it
local hooked = setmetatable({}, { __mode = "k" })  -- scroll boxes with Everloot's callbacks
local hookedPages = setmetatable({}, { __mode = "k" })
local panel, notice

local function page() return ProfessionsFrame and ProfessionsFrame.CraftingPage end
local function scrollBox()
  local list = page() and page().RecipeList
  return list and list.ScrollBox
end
local function windowShown()
  local crafting = page()
  return ProfessionsFrame and type(ProfessionsFrame.IsShown) == "function" and ProfessionsFrame:IsShown()
    and crafting and (type(crafting.IsShown) ~= "function" or crafting:IsShown())
end

local function positive(value)
  value = E.Readable(value)
  if type(value) == "number" and value > 0 and value % 1 == 0 then return value end
end

-- The recipe a list node stands for, as its row label and the schematic show it: the highest learned rank. Also
-- the node's own recipe ID, the one C_TradeSkillUI.OpenRecipe finds in the list (rank 1 of a ranked recipe).
local function recipeInfoOf(node)
  if type(node) ~= "table" then return nil end
  local data = type(node.GetData) == "function" and node:GetData() or node
  local info = type(data) == "table" and E.Readable(data.recipeInfo)
  if type(info) ~= "table" or not positive(info.recipeID) then return nil end
  local base = info.recipeID
  if Professions and type(Professions.GetHighestLearnedRecipe) == "function" then
    local ok, high = pcall(Professions.GetHighestLearnedRecipe, info)
    if ok and type(high) == "table" and positive(high.recipeID) then info = high end
  end
  return info, base
end

-- One context per open window and price change: every row and the list price the same way.
local function context()
  if not state.context then
    state.context, state.detail, state.checking = U.CraftContext(E.CurrentRealm(), E:MarketHouse())
  end
  return state.context
end

-- A recipe's estimate, evaluated once per context; nil for a recipe the calculator cannot read (gathering, recraft).
local function estimateFor(info)
  local id = info.recipeID
  local cached = state.cache[id]
  if cached == nil then
    local recipe = state.recipes[id]
    if not recipe and C_TradeSkillUI and C_TradeSkillUI.GetRecipeSchematic then
      local ok, value = pcall(C_TradeSkillUI.GetRecipeSchematic, id, false)
      recipe = E.NativeRecipe(info, ok and value or nil)
      -- Keep successful schematic reads while quotes are verified; unavailable reads can be retried.
      if recipe then state.recipes[id] = recipe end
    end
    cached = recipe and C.Evaluate(recipe, context(), 1) or false
    state.cache[id] = cached
  end
  return cached or nil
end

local function paint(s, estimate, mode)
  local text = C.Tag(estimate, mode or state.tag, state.checking)
  if estimate.oldQuote then text = "old " .. text:gsub(" old$", "") end
  s:SetText(text)
  local profit = estimate.profit
  local color = (profit and profit > 0 and GAIN) or (profit and profit < 0 and LOSS) or MUTED
  s:SetTextColor(color[1], color[2], color[3])
end

local function clear(frame)
  local s = tags[frame]
  if s then s:SetText(""); s:Hide() end
end

local schedulePanel

-- Tag one row from what it is bound to now. Anything but a priced recipe clears it.
local function decorate(frame, node)
  local info = state.enabled and windowShown() and recipeInfoOf(node)
  local estimate = info and estimateFor(info)
  if not estimate then return clear(frame) end
  local s = tags[frame]
  if not s then
    s = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    s:SetPoint("RIGHT", frame, "RIGHT", -6, 0)
    s:SetWidth(TAG_W)
    s:SetJustifyH("RIGHT")
    if s.SetWordWrap then s:SetWordWrap(false) end
    if s.SetMaxLines then s:SetMaxLines(1) end
    tags[frame] = s
  end
  paint(s, estimate, state.tag == "both" and "money" or state.tag)
  s:Show()
  -- A recipe the docked list does not have yet: the window's search or filters changed its list.
  if state.ids and not state.ids[info.recipeID] then schedulePanel() end
end

local function refreshTags()
  local box = scrollBox()
  if box and hooked[box] and box.ForEachFrame then
    box:ForEachFrame(function(frame) decorate(frame, frame:GetElementData()) end)
  end
  if not state.enabled or not windowShown() then
    for frame in pairs(tags) do clear(frame) end
  end
end

local function hookList()
  local box = scrollBox()
  if not box or hooked[box] or not (ScrollUtil and ScrollUtil.AddInitializedFrameCallback
    and ScrollUtil.AddReleasedFrameCallback) then return end
  hooked[box] = true
  -- No iterateExisting: the client calls that pass as (frame, elementData), without the owner the live callback gets.
  -- refreshTags, right after, tags the rows already bound.
  ScrollUtil.AddInitializedFrameCallback(box, function(_, frame, node) decorate(frame, node) end, N, false)
  ScrollUtil.AddReleasedFrameCallback(box, function(_, frame) clear(frame) end, N)
end

-- Every recipe the profession window lists now, collapsed categories included, each once (a favourite is also
-- listed under its category). ids maps the priced (highest learned) recipe ID to the list node's own ID.
local function listed()
  local infos, ids = {}, {}
  local box = scrollBox()
  local provider = box and box.GetDataProvider and box:GetDataProvider()
  if provider and provider.ForEach then
    provider:ForEach(function(node)
      local info, base = recipeInfoOf(node)
      if info and not ids[info.recipeID] then
        ids[info.recipeID] = base
        infos[#infos + 1] = info
      end
    end, false)
  end
  return infos, ids
end

-- The recipe the native schematic shows now.
local function selection()
  local form = page() and page().SchematicForm
  local info = form and type(form.GetRecipeInfo) == "function" and E.Readable(form:GetRecipeInfo())
  return type(info) == "table" and positive(info.recipeID) or nil
end

-- A status about the recipe the schematic shows now; it goes once the schematic shows another one.
local function say(text)
  state.message, state.messageFor = text, selection()
end

-- Beside the window on the right, or on its left when the right has no room on screen.
local function dock(f)
  local right = ProfessionsFrame.GetRight and ProfessionsFrame:GetRight()
  local screen = UIParent and UIParent.GetWidth and UIParent:GetWidth()
  local scale = ProfessionsFrame.GetEffectiveScale and ProfessionsFrame:GetEffectiveScale()
  local uiScale = UIParent and UIParent.GetEffectiveScale and UIParent:GetEffectiveScale()
  if type(scale) == "number" and type(uiScale) == "number" and scale > 0 and type(screen) == "number" then
    screen = screen * uiScale / scale
  end
  if f.ClearAllPoints then f:ClearAllPoints() end
  if type(right) == "number" and type(screen) == "number" and right + 2 + WIDTH > screen then
    f:SetPoint("TOPRIGHT", ProfessionsFrame, "TOPLEFT", -2, -24)
  else
    f:SetPoint("TOPLEFT", ProfessionsFrame, "TOPRIGHT", 2, -24)
  end
end

local function drawNotice()
  if not notice then return end
  local reason = state.reason
  if state.enabled or reason == "recorder" or not windowShown() then notice:Hide(); return end
  notice.text:SetText(reason == "craftprofit"
    and "CraftProfit is loaded, so Everloot's profit tags and list are off for this character."
    or "Everloot's profit tags and list are off for this character.")
  dock(notice)
  notice:Show()
end

local function drawPanel()
  if not panel then return end
  if not state.enabled or not windowShown() then panel:Hide(); return end
  local infos, ids = listed()
  state.ids = ids
  local all = {}
  for _, info in ipairs(infos) do
    local estimate = estimateFor(info)
    if estimate then all[#all + 1] = estimate end
  end
  local rows = C.Rank(all, { sort = state.sort, profitableOnly = state.profitableOnly })
  local selected = selection()
  state.offset = math.min(state.offset, math.floor(math.max(#rows - 1, 0) / ROWS) * ROWS)
  local visible = false
  for i, line in ipairs(panel.rows) do
    local row = rows[state.offset + i]
    line.estimate = row
    if row then
      line.name:SetText(row.name)
      line.name:SetWidth(state.tag == "both" and WIDTH - 12 - 146 or WIDTH - 12 - 100)
      line.tag:SetWidth(state.tag == "both" and 140 or 94)
      paint(line.tag, row)
      if row.id == selected then line.selection:Show(); visible = true else line.selection:Hide() end
      line:Show()
    else
      line:Hide()
    end
  end
  panel.sort:SetText(state.sort == "name" and "Sort: name" or "Sort: profit")
  panel.filter:SetText(state.profitableOnly and "Show all" or "Profitable only")
  panel.tagMode:SetText(TAG_LABEL[state.tag])
  panel.destination:SetText(context().destination == "vendor" and "Sell: vendor" or "Sell: AH")
  -- Another addon's prices are named with their unknown age and market, or as unavailable; never as Everloot's.
  local CS = E.CraftingSources
  local short = CS and CS.Short(context().priceSource)
  panel.prices:SetText(short and ("Prices: " .. short)
    or (state.checking and "Checking the price file...") or (U.CraftScanInfo(context()) or "Prices: price file and vendors"))
  local status = state.message
  if not status and selected and ids[selected] then
    local inRows = false
    for _, row in ipairs(rows) do if row.id == selected then inRows = true end end
    if not inRows and state.profitableOnly then status = "The selected recipe is hidden by Profitable only." end
    if inRows and not visible then status = "The selected recipe is on another page of this list." end
  end
  panel.status:SetText(status or "")
  panel.empty:SetText(#infos == 0 and "No recipes listed in the profession window."
    or "No recipe shows an estimated profit at these prices.")
  if #rows == 0 then panel.empty:Show() else panel.empty:Hide() end
  if state.offset > 0 then panel.up:Show() else panel.up:Hide() end
  if state.offset + ROWS < #rows then panel.down:Show() else panel.down:Hide() end
  dock(panel)
  panel:Show()
end

local retry
-- Draw tags, the list and the notice from the current settings. While the price file is still being checked, ask
-- again shortly, then less often, until the window closes.
function N.Refresh()
  state.enabled, state.reason = C.NativeEnabled()
  if not windowShown() then
    if panel then panel:Hide() end
    if notice then notice:Hide() end
    for frame in pairs(tags) do clear(frame) end
    return
  end
  -- Estimates made while the file was being checked are not kept: look again.
  -- Nor those made while the client was still loading a vendor sell price.
  if state.checking or (state.context and state.context.pending) then state.context, state.cache = nil, {} end
  if state.enabled then context() end
  hookList()
  refreshTags()
  drawPanel()
  drawNotice()
  local pending = state.checking or (state.context and state.context.pending)
  for _, row in pairs(state.cache) do if row and row.vendorPending then pending = true; break end end
  if state.enabled and pending then retry() end
end

--- Prices or the auction house changed: price every recipe again.
function N.PricesChanged()
  state.context, state.cache = nil, {}
  N.Refresh()
end

retry = function()
  if state.retrying or not (C_Timer and C_Timer.After) then return end
  state.retrying, state.tries = true, state.tries + 1
  local session = state.session
  C_Timer.After(state.tries > FAST_TRIES and 2 or 0.25, function()
    state.retrying = false
    if state.session == session then N.PricesChanged() end
  end)
end

schedulePanel = function()
  if state.panelPending or not (C_Timer and C_Timer.After) then return end
  state.panelPending = true
  local session = state.session
  C_Timer.After(0, function()
    state.panelPending = false
    if state.session == session then drawPanel() end
  end)
end

-- The game answered an open request (or did not): did the schematic change to that recipe?
local function settle(answered)
  local pending = state.pending
  if not pending then return end
  state.pending, state.asked = nil, pending
  if selection() == pending.id then say("Showing " .. pending.name .. ".")
  elseif answered then say(pending.name .. HIDDEN)
  else say("The game did not open " .. pending.name .. ".") end
  drawPanel()
end

local function open(estimate)
  if not estimate then return end
  local id, name = estimate.id, estimate.name
  state.pending, state.asked = nil, nil
  local _, ids = listed()
  if not ids[id] then
    say(name .. HIDDEN)
  elseif selection() == id then
    say("Showing " .. name .. ".")
  elseif not (C_TradeSkillUI and C_TradeSkillUI.OpenRecipe) then
    say("This client cannot open a recipe from Everloot's list.")
  else
    state.pending = { id = id, name = name }
    say("Opening " .. name .. "...")
    local session = state.session
    -- The game finds a recipe by its list node's ID (rank 1), then shows the highest learned rank.
    pcall(C_TradeSkillUI.OpenRecipe, ids[id])
    if state.pending and C_Timer and C_Timer.After then
      C_Timer.After(3, function()
        if state.session == session and state.pending and state.pending.id == id then settle(false) end
      end)
    end
  end
  drawPanel()
end

local function closed()
  state.session = state.session + 1
  state.recipes = {}
  state.context, state.cache, state.pending, state.asked, state.message, state.ids = nil, {}, nil, nil, nil, nil
  state.retrying, state.panelPending, state.tries, state.checking = false, false, 0, false
  if panel then panel:Hide() end
  if notice then notice:Hide() end
  for frame in pairs(tags) do clear(frame) end
end

local function button(parent, width, label, onClick)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetSize(width, 20)
  b:SetText(label)
  b:SetScript("OnClick", function() onClick(); drawPanel() end)
  return b
end

local function small(parent, template)
  local s = parent:CreateFontString(nil, "OVERLAY", template or "GameFontHighlightSmall")
  s:SetJustifyH("LEFT")
  if s.SetWordWrap then s:SetWordWrap(false) end
  return s
end

local function showRow(line)
  local row = line.estimate
  if not (row and GameTooltip) then return end
  GameTooltip:SetOwner(line, "ANCHOR_RIGHT")
  GameTooltip:AddLine(row.name)
  GameTooltip:AddLine("Est. profit per craft: " .. C.Tag(row, "both", state.checking), 1, 1, 1)
  GameTooltip:AddLine("Materials: " .. (row.cost and U.Money(row.cost)
    or (row.unpriced .. " reagent" .. (row.unpriced == 1 and "" or "s") .. " without a price")), 1, 1, 1)
  GameTooltip:AddLine(U.CraftValueLine(row, context()), 1, 1, 1, true)
  GameTooltip:AddLine(U.CraftComparison(row, "ah"), 1, 1, 1, true)
  GameTooltip:AddLine(U.CraftComparison(row, "vendor"), 1, 1, 1, true)
  GameTooltip:AddLine("Click to open it in the profession window.", 0.8, 0.8, 0.8, true)
  GameTooltip:Show()
end

local function hideTip(owner) if GameTooltip and GameTooltip:IsOwned(owner) then GameTooltip:Hide() end end

local function createPanel()
  local f = CreateFrame("Frame", nil, ProfessionsFrame, "BackdropTemplate")
  f:SetSize(WIDTH, TOP + ROWS * ROW_H + 30)
  dock(f)
  if f.SetClampedToScreen then f:SetClampedToScreen(true) end
  if U.Backdrop then U.Backdrop(f) end
  if f.EnableMouseWheel then f:EnableMouseWheel(true) end
  f:SetScript("OnMouseWheel", function(_, delta)
    state.offset = math.max(0, state.offset - delta * ROWS)
    drawPanel()
  end)
  -- Says plainly that this is Everloot's list, not the profession window's own order.
  f.title = small(f, "GameFontNormal")
  f.title:SetPoint("TOPLEFT", 10, -9)
  f.title:SetText("Everloot profit list")
  f.help = CreateFrame("Frame", nil, f)
  f.help:SetPoint("TOPLEFT", 6, -6)
  f.help:SetSize(WIDTH - 12, 16)
  if f.help.EnableMouse then f.help:EnableMouse(true) end
  f.help:SetScript("OnEnter", function(self)
    if not GameTooltip then return end
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine("Everloot profit list")
    GameTooltip:AddLine("Everloot's own list of the recipes the profession window shows. The window's order, "
      .. "categories and filters are unchanged.", 1, 1, 1, true)
    GameTooltip:AddLine(LEGEND, 1, 1, 1, true)
    if state.detail then GameTooltip:AddLine(state.detail, 0.8, 0.8, 0.8, true) end
    GameTooltip:Show()
  end)
  f.help:SetScript("OnLeave", hideTip)
  f.sort = button(f, 76, "Sort: profit", function()
    state.sort = state.sort == "name" and "profit" or "name"; state.offset = 0; state.message = nil
  end)
  f.sort:SetPoint("TOPLEFT", 8, -28)
  f.filter = button(f, 92, "Profitable only", function()
    state.profitableOnly = not state.profitableOnly; state.offset = 0; state.message = nil
  end)
  f.filter:SetPoint("TOPLEFT", 86, -28)
  -- The price source, shared with the schematic summary and the Crafting costs page; the line below names it.
  f.source = button(f, 64, "Prices", function()
    local O = E.Options
    if O and O.NextCraftSource then O.NextCraftSource() end
    state.offset = 0
  end)
  f.source:SetPoint("TOPLEFT", 180, -28)
  f.tagMode = button(f, 76, TAG_LABEL.money, function()
    state.tag = NEXT_TAG[state.tag]
    refreshTags()
  end)
  f.tagMode:SetPoint("TOPLEFT", 8, -50)
  -- The destination is shared with the schematic summary and the Crafting costs page.
  f.destination = button(f, 76, "Sell: AH", function()
    local O = E.Options
    if O and O.SetCraftDestination then O.SetCraftDestination(O.CraftDestination() == "vendor" and "ah" or "vendor") end
    state.offset = 0
  end)
  f.destination:SetPoint("TOPLEFT", 86, -50)
  f.off = button(f, 80, "Turn off here", function()
    if E.Options and E.Options.SetNativeCrafting then E.Options.SetNativeCrafting(false) end
  end)
  f.off:SetPoint("TOPLEFT", 164, -50)
  f.prices = small(f)
  f.prices:SetPoint("TOPLEFT", 10, -76)
  f.prices:SetWidth(WIDTH - 20)
  f.rows = {}
  for i = 1, ROWS do
    local line = CreateFrame("Button", nil, f)
    line:SetPoint("TOPLEFT", 6, -TOP - (i - 1) * ROW_H)
    line:SetSize(WIDTH - 12, ROW_H)
    line.selection = line:CreateTexture(nil, "BACKGROUND")
    line.selection:SetAllPoints()
    line.selection:SetColorTexture(1, 0.82, 0, 0.15)
    line.selection:Hide()
    line.name = small(line)
    line.name:SetPoint("LEFT", 4, 0)
    line.name:SetWidth(WIDTH - 12 - 100)
    line.tag = small(line)
    line.tag:SetPoint("RIGHT", -4, 0)
    line.tag:SetWidth(94)
    line.tag:SetJustifyH("RIGHT")
    line:SetScript("OnClick", function(self) open(self.estimate) end)
    line:SetScript("OnEnter", showRow)
    line:SetScript("OnLeave", hideTip)
    f.rows[i] = line
  end
  f.empty = small(f)
  f.empty:SetPoint("TOPLEFT", 10, -TOP - 2)
  f.empty:SetWidth(WIDTH - 20)
  if f.empty.SetWordWrap then f.empty:SetWordWrap(true) end
  f.status = small(f)
  f.status:SetPoint("BOTTOMLEFT", 10, 10)
  f.status:SetWidth(WIDTH - 20 - 70)
  if f.status.SetWordWrap then f.status:SetWordWrap(true) end
  f.up = button(f, 32, "Up", function() state.offset = math.max(0, state.offset - ROWS) end)
  f.up:SetPoint("BOTTOMRIGHT", -42, 6)
  f.down = button(f, 34, "Dn", function() state.offset = state.offset + ROWS end)
  f.down:SetPoint("BOTTOMRIGHT", -6, 6)
  f:Hide()
  return f
end

local function createNotice()
  local f = CreateFrame("Frame", nil, ProfessionsFrame, "BackdropTemplate")
  f:SetSize(WIDTH, 66)
  dock(f)
  if f.SetClampedToScreen then f:SetClampedToScreen(true) end
  if U.Backdrop then U.Backdrop(f) end
  f.text = small(f)
  f.text:SetPoint("TOPLEFT", 10, -9)
  f.text:SetWidth(WIDTH - 20)
  if f.text.SetWordWrap then f.text:SetWordWrap(true) end
  f.show = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  f.show:SetSize(150, 20)
  f.show:SetPoint("BOTTOMLEFT", 8, 8)
  f.show:SetText("Show Everloot here")
  f.show:SetScript("OnClick", function()
    if E.Options and E.Options.SetNativeCrafting then E.Options.SetNativeCrafting(true) end
  end)
  f:Hide()
  return f
end

local function attach()
  if not (ProfessionsFrame and page()) then return end
  local crafting = page()
  if type(crafting.HookScript) == "function" and not hookedPages[crafting] then
    hookedPages[crafting] = true
    crafting:HookScript("OnShow", function() N.Refresh() end)
    crafting:HookScript("OnHide", function() N.Refresh() end)
  end
  if not panel then
    panel = createPanel()
    notice = createNotice()
    local form = page().SchematicForm
    -- A new schematic: confirm an open request and move the list's highlight.
    if form and type(form.Init) == "function" and hooksecurefunc then
      hooksecurefunc(form, "Init", function()
        if state.pending and selection() == state.pending.id then return settle(true) end
        -- The game can open a recipe after its answer, once its recipe list has updated.
        local asked = state.asked
        if asked and selection() == asked.id then say("Showing " .. asked.name .. ".")
        elseif not state.pending and state.message and selection() ~= state.messageFor then
          -- The player chose another recipe in the window's own list.
          state.message, state.asked = nil, nil
        end
        schedulePanel()
      end)
    end
  end
  N.Refresh()
end

--- The tag Everloot put on a recipe row frame, and the docked list and its notice, for the contract tests.
function N.TagOf(frame) return tags[frame] end
function N.Frames() return panel, notice end

local listener = CreateFrame("Frame")
for _, event in ipairs({ "ADDON_LOADED", "TRADE_SKILL_SHOW", "TRADE_SKILL_CLOSE", "TRADE_SKILL_LIST_UPDATE",
  "TRADE_SKILL_DATA_SOURCE_CHANGED", "NEW_RECIPE_LEARNED", "OPEN_RECIPE_RESPONSE" }) do
  listener:RegisterEvent(event)
end
listener:SetScript("OnEvent", function(_, event, arg)
  if event == "ADDON_LOADED" then
    if arg == "Everloot" or arg == "Blizzard_Professions" then attach() end
  elseif event == "TRADE_SKILL_SHOW" then
    closed() -- a fresh window: nothing from the last one
    attach()
  elseif event == "TRADE_SKILL_CLOSE" then
    closed()
  elseif event == "NEW_RECIPE_LEARNED" then
    state.recipes = {}
    N.PricesChanged()
  elseif event == "TRADE_SKILL_DATA_SOURCE_CHANGED" then
    -- Another profession in the same window: nothing said about the last one applies.
    state.pending, state.asked, state.message, state.offset = nil, nil, nil, 0
    state.recipes, state.cache, state.context = {}, {}, nil
    if panel then N.Refresh() end
  elseif event == "OPEN_RECIPE_RESPONSE" then
    -- Blizzard opens the recipe in its own handler for this event; look once it has.
    local pending, session = state.pending, state.session
    if pending and C_Timer and C_Timer.After then
      C_Timer.After(0, function() if state.session == session and state.pending == pending then settle(true) end end)
    end
  elseif panel then
    N.Refresh()
  end
end)
