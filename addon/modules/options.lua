-- Everloot settings page: Esc > Options > AddOns > Everloot, or /everloot options. One switch per module and
-- the auction scan prompt, each with what it records and where it goes. A switch with a /everloot command
-- runs that command, so the page and chat behave the same (turning the census, players, completion or addon
-- list off deletes their rows); the others set the toggle. Every change applies after a /reload, which the
-- Reload button does. Settings API (modern clients), then the older interface options, then a plain window.

local E = Everloot
local O = {}
E.Options = O

-- In page order. `command` is the /everloot word; `field` is a top-level EverlootDB key instead of a toggle;
-- `defaultOff` reads a missing field as off.
O.ROWS = {
  { key = "window", label = "Everloot window",
    text = "The window from the minimap button and /everloot window. It shows what this file holds and records nothing; off leaves recording as it is." },
  { key = "buttons", command = "buttons", label = "Addon buttons in the Everloot button",
    text = "Other addons' minimap buttons gather into the Everloot minimap button; hover it to use them. Records nothing; off puts them back after a reload." },
  { key = "auctions", command = "auctions", label = "Auction scans",
    text = "Scan this house from the Everloot tab at the auction house, one click at a time. Item prices and quantities, never sellers." },
  { key = "scanPrompt", command = "scanprompt", field = true, label = "Scan prompt at the auction house",
    text = "A small reminder beside the house when a scan can run. The tab and /everloot scan work either way." },
  { key = "autoVendor", command = "vendor", field = true, defaultOff = true, label = "Sell greys and repair at merchants",
    text = "When a merchant window opens: sells grey items and repairs with your own gold, never the guild bank. Records nothing itself." },
  { key = "mailCollect", command = "mail", field = true, defaultOff = true, label = "Collect all at the mailbox",
    text = "A button that takes money and items from auction letters only, one at a time. Skips cash on delivery and other letters." },
  { key = "census", command = "census", label = "Census",
    text = "Race, class, level and faction of your characters and of players you see. Never names, guilds, gear or places. Off deletes its rows." },
  { key = "openworld", label = "World",
    text = "NPCs, loot, quests, vendors and items you see, and where you stood at NPC windows and herbs, ore and chests. Anonymous: no character or guild names." },
  { key = "gold", label = "Your gold",
    text = "Your own gold in and out, for gold per hour. Sent only if you share it on the upload page." },
  { key = "roster", label = "Your characters",
    text = "Name, realm, class, level, faction, gold and professions of each character you log in with, for the window's Home. Stays in this file; never uploaded." },
  { key = "gear", label = "Your gear",
    text = "Your equipped items and item levels, at most once an hour. Sent only if you share it on the upload page." },
  { key = "talents", label = "Your talents",
    text = "Your own talent build, read only, for /everloot talents and plans." },
  { key = "guild", label = "Guild",
    text = "Your guild's roster, lockouts and loot. Published only through an officer's upload." },
  { key = "completion", command = "completion", label = "Completion tracker",
    text = "Your achievements, reputation, titles and completed quests, read only; also your professions, raid lockouts, active talent build, character sheet stats and PvP standing. Collection rows leave from the upload page; achievements, reputation and titles also through the Desktop App's private sync, for a character you linked. Professions, lockouts, talents, stats and PvP never go in an upload, only through private sync. Off deletes its rows." },
  { key = "addons", command = "addons", label = "Installed addon list",
    text = "Each installed addon's name and version. Sent only from the upload page. Off deletes its rows." },
  { key = "players", command = "players", label = "Player pages",
    text = "Name, realm, race, class, level and guild of characters you see, for the site's player pages. Off deletes its rows." },
}
-- Only in the builds that carry the pulls module (E.RUN_RECORDS in core.lua).
if E.Pulls then
  O.ROWS[#O.ROWS + 1] = { key = "pulls", command = "pulls", label = "Boss pulls",
    text = "After each boss pull: your group's names, classes, roles and the game's damage meter totals. Sent from the upload page or the Desktop App. Off deletes its rows." }
end

-- "What you've added": rows of each kind in the saved file now, shown under the switches.
O.ADDED = {
  { "loot", "Loot windows" }, { "npc_sighting", "NPC sightings" }, { "quest", "Quests" }, { "recipe_observed", "Recipe colours" },
  { "item_fact", "Item facts" }, { "auction_scan", "Auction scans" }, { "census_seen", "Players seen" }, { "map_bounds", "Zones mapped" },
}

function O.IsOn(row)
  if row.field then
    if row.defaultOff then return EverlootDB[row.key] == true end
    return EverlootDB[row.key] ~= false
  end
  return EverlootDB.toggles[row.key] ~= false
end

--- Sets one row: through its /everloot command when it has one, so chat and the page agree.
function O.Set(row, on)
  if row.command and SlashCmdList and SlashCmdList.EVERLOOT then
    SlashCmdList.EVERLOOT(row.command .. (on and " on" or " off"))
  elseif row.field then
    EverlootDB[row.key] = on
  else
    EverlootDB.toggles[row.key] = on
  end
  O.changed = true
  O.Refresh()
end

-- Kinds of rows each command deletes when it turns off (core.lua: the Withdraw of each module), for the
-- confirmation the page asks first. The slash command stays direct.
O.DELETES = {
  census = { "census_self", "census_seen" },
  players = { "player_seen", "guild_kill" },
  addons = { "addon_seen" },
  completion = { "achievement_catalog", "reputation_catalog", "title_catalog", "quest_chain_catalog",
    "achievement_owned", "reputation_owned", "title_owned", "quest_owned",
    "profession_owned", "lockout_owned", "talent_owned", "stats_owned", "pvp_owned" },
}

--- How many rows turning this row off would delete.
function O.RowsToDelete(row)
  local n = 0
  for _, kind in ipairs(O.DELETES[row.key] or {}) do n = n + E:Count(kind) end
  return n
end

if StaticPopupDialogs then
  StaticPopupDialogs["EVERLOOT_TURN_OFF"] = {
    text = "Turn off %s and delete %d recorded rows? They have not necessarily been uploaded.",
    button1 = "Turn off and delete",
    button2 = "Cancel",
    OnAccept = function()
      local row = O.pending
      O.pending = nil
      if row then O.Set(row, false) end
    end,
    OnCancel = function()
      O.pending = nil
      O.Refresh()
    end,
    timeout = 0, whileDead = 1, hideOnEscape = 1,
  }
end

--- A click on a switch on the page. Turning off a row whose command deletes recorded rows asks first;
--- everything else is O.Set as before.
function O.Click(row, on)
  if not on and O.DELETES[row.key] and StaticPopup_Show and StaticPopupDialogs and StaticPopupDialogs["EVERLOOT_TURN_OFF"] then
    local n = O.RowsToDelete(row)
    if n > 0 then
      O.pending = row
      local ok, shown = pcall(StaticPopup_Show, "EVERLOOT_TURN_OFF", row.label, n)
      if ok and shown then
        O.Refresh() -- the switch stays on until the answer
        return
      end
      O.pending = nil
    end
  end
  O.Set(row, on)
end

function O.Refresh()
  local page = O.page
  if not page then return end
  for _, box in ipairs(page.boxes or {}) do box:SetChecked(O.IsOn(box.row)) end
  for i, a in ipairs(O.ADDED) do
    if page.added and page.added[i] then page.added[i]:SetText(a[2] .. ": " .. tostring(E:Count(a[1]))) end
  end
  if page.note then
    page.note:SetText(O.changed and "Changes apply after a reload." or ("Everloot " .. E.VERSION .. ". Changes apply after a reload."))
  end
end

-- Text in the Everloot window's fonts and colours (modules/window.lua loads after this file, before the page is
-- built), else in the game's own template.
local function words(parent, template, size, tone)
  local W = E.Window
  if W and W.Text then return W.Text(parent, size, nil, W.COLORS[tone]) end
  local s = parent:CreateFontString(nil, "ARTWORK", template)
  s:SetJustifyH("LEFT")
  return s
end

local PAD = 8 -- inside the list of switches

local function build()
  -- A frame that can take a backdrop, for when the page is shown as a window of its own.
  local made, page = pcall(CreateFrame, "Frame", "EverlootOptionsPage", nil, "BackdropTemplate")
  if not made or not page then page = CreateFrame("Frame", "EverlootOptionsPage") end
  page.name = "Everloot"
  local W = E.Window
  if W and W.Heading then
    page.crest, page.title = W.Heading(page, "Settings")
    page.crest:SetPoint("TOPLEFT", page, "TOPLEFT", 12, -10)
  else
    page.title = words(page, "GameFontNormalLarge")
    page.title:SetPoint("TOPLEFT", 16, -16)
    page.title:SetText("Everloot")
  end
  local intro = words(page, "GameFontHighlightSmall", 11, "muted")
  intro:SetPoint("TOPLEFT", page, "TOPLEFT", 16, -46)
  intro:SetPoint("TOPRIGHT", page, "TOPRIGHT", -32, -46)
  intro:SetText("What the addon records. Everything stays in your saved file until the Everloot Desktop App or the upload page sends it, as each line says.")
  page.intro = intro
  -- Ask Everloot: the question goes into the file, the companion answers it, and /reload prints it.
  local ask = CreateFrame("EditBox", nil, page, "InputBoxTemplate")
  ask:SetHeight(22)
  if ask.SetAutoFocus then ask:SetAutoFocus(false) end
  if ask.EnableMouse then ask:EnableMouse(true) end
  local askLabel = words(page, "GameFontHighlightSmall", 12, "text")
  askLabel:SetPoint("TOPLEFT", intro, "BOTTOMLEFT", 0, -14)
  askLabel:SetPoint("TOPRIGHT", intro, "BOTTOMRIGHT", 0, -14)
  askLabel:SetText("Ask Everloot, then /reload for the answer")
  local send = CreateFrame("Button", nil, page, "UIPanelButtonTemplate")
  send:SetSize(64, 22)
  send:SetPoint("TOPRIGHT", askLabel, "BOTTOMRIGHT", 0, -8)
  ask:SetPoint("TOPLEFT", askLabel, "BOTTOMLEFT", 0, -8)
  ask:SetPoint("TOPRIGHT", send, "TOPLEFT", -8, 0)
  send:SetText("Ask")
  local function askNow()
    local text = (ask:GetText() or ""):gsub("^%s+", ""):gsub("%s+$", "")
    if text == "" then return end
    if E.Ask then E:Ask(text) end
    ask:SetText("")
  end
  send:SetScript("OnClick", askNow)
  ask:SetScript("OnEnterPressed", askNow)
  page.ask = ask
  local scroll = CreateFrame("ScrollFrame", nil, page, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", ask, "BOTTOMLEFT", 0, -18)
  scroll:SetPoint("BOTTOMRIGHT", page, "BOTTOMRIGHT", -32, 54)
  local content = CreateFrame("Frame", nil, scroll)
  content:SetSize(1, 1)
  scroll:SetScrollChild(content)
  if W and W.Surface then W.Surface(scroll) end
  page.scroll = scroll
  page.boxes = {}
  for _, row in ipairs(O.ROWS) do
    local box = CreateFrame("CheckButton", nil, content, "UICheckButtonTemplate")
    box.row = row
    local label = words(box, "GameFontNormal", 13, "text")
    label:SetPoint("TOPLEFT", box, "TOPRIGHT", 4, -4)
    label:SetText(row.label)
    local text = words(box, "GameFontHighlightSmall", 11, "muted")
    text:SetPoint("TOPLEFT", label, "BOTTOMLEFT", 0, -2)
    text:SetText(row.text)
    box.label, box.description = label, text
    box:SetScript("OnClick", function(self) O.Click(row, self:GetChecked() and true or false) end)
    page.boxes[#page.boxes + 1] = box
  end
  page.addedHeading = words(content, "GameFontNormal", 13, "text")
  page.addedHeading:SetText("What you've added")
  page.added = {}
  for i = 1, #O.ADDED do page.added[i] = words(content, "GameFontHighlightSmall", 11, "muted") end
  local function layout(_, width)
    width = math.max(1, width or scroll:GetWidth())
    content:SetWidth(width)
    local y = PAD
    for _, box in ipairs(page.boxes) do
      box:SetPoint("TOPLEFT", content, "TOPLEFT", PAD, -y)
      box.label:SetWidth(math.max(1, width - 2 * PAD - 38))
      box.description:SetWidth(math.max(1, width - 2 * PAD - 38))
      y = y + math.max(32, 4 + box.label:GetStringHeight() + 2 + box.description:GetStringHeight()) + 12
    end
    page.addedHeading:SetPoint("TOPLEFT", content, "TOPLEFT", PAD, -y)
    y = y + 22
    for _, line in ipairs(page.added) do
      line:SetPoint("TOPLEFT", content, "TOPLEFT", PAD, -y)
      y = y + 16
    end
    content:SetHeight(y + PAD)
    scroll:SetVerticalScroll(math.min(scroll:GetVerticalScroll(), math.max(0, y - scroll:GetHeight())))
  end
  scroll:HookScript("OnSizeChanged", layout)
  scroll:EnableMouseWheel(true)
  scroll:SetScript("OnMouseWheel", function(self, delta)
    local limit = math.max(0, content:GetHeight() - self:GetHeight())
    self:SetVerticalScroll(math.max(0, math.min(limit, self:GetVerticalScroll() - delta * 40)))
  end)
  local reload = CreateFrame("Button", nil, page, "UIPanelButtonTemplate")
  reload:SetSize(140, 24)
  reload:SetPoint("BOTTOMLEFT", page, "BOTTOMLEFT", 16, 16)
  reload:SetText("Reload now")
  reload:SetScript("OnClick", function() if ReloadUI then ReloadUI() end end)
  page.reload = reload
  local note = words(page, "GameFontDisableSmall", 11, "muted")
  note:SetPoint("TOPLEFT", reload, "TOPRIGHT", 10, -2)
  note:SetPoint("BOTTOMRIGHT", page, "BOTTOMRIGHT", -32, 16)
  note:SetJustifyV("TOP")
  page.note = note
  page:SetScript("OnShow", function() layout(); O.Refresh() end)
  return page
end

--- Puts the page in the game's options: the Settings API, else the older interface options, else nothing
--- (/everloot options then shows it as a window). Returns how it was registered.
function O.Register()
  if O.page then return O.how end
  O.page = build()
  if Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory then
    local ok, category = pcall(Settings.RegisterCanvasLayoutCategory, O.page, "Everloot")
    if ok and category then
      pcall(Settings.RegisterAddOnCategory, category)
      O.category, O.how = category, "settings"
      return O.how
    end
  end
  if InterfaceOptions_AddCategory and pcall(InterfaceOptions_AddCategory, O.page) then
    O.how = "interface"
    return O.how
  end
  O.how = "window"
  return O.how
end

--- /everloot options: opens the page where the game keeps it, or as a window of its own.
function O.Open()
  O.Register()
  if O.how == "settings" and Settings.OpenToCategory then
    local id = O.category.GetID and O.category:GetID() or O.category.ID
    if pcall(Settings.OpenToCategory, id) then return end
  elseif O.how == "interface" and InterfaceOptionsFrame_OpenToCategory then
    -- The older frame needs two calls when it has not been opened yet this session.
    InterfaceOptionsFrame_OpenToCategory(O.page)
    InterfaceOptionsFrame_OpenToCategory(O.page)
    return
  end
  local page = O.page
  if not O.windowed then
    O.windowed = true
    page:SetParent(UIParent)
    page:SetSize(620, 640)
    page:SetPoint("CENTER")
    page:SetFrameStrata("DIALOG")
    -- The Everloot window's dark panel and bronze edge; the game's dialog without the window file.
    local W = E.Window
    if W and W.Backdrop then
      W.Backdrop(page)
    elseif page.SetBackdrop then
      page:SetBackdrop({ bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background", edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
        tile = true, tileSize = 16, edgeSize = 16, insets = { left = 4, right = 4, top = 4, bottom = 4 } })
    end
    local close = CreateFrame("Button", nil, page, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", -4, -4)
    O.close = close
  end
  page:Show()
  O.Refresh()
end

-- Player names (the players module) stay off until the player turns them on, and each install is asked once.
-- The question comes a few seconds after the first loading screen of a session, never in combat. Either answer,
-- or /everloot players on or off typed or clicked on this page, sets EverlootDB.playersAsked, and an install
-- that already has the module on is never asked. The question has no close button: it goes away with an answer.
O.PLAYERS_QUESTION = "Everloot can record player names for everloot.app. It is off until you choose.\n\n"
  .. "If you turn it on, it records the name, realm, race, class, level and guild of your own characters and of players "
  .. "you target, mouse over or group with, and the bosses your guild kills. Never where they are, their gear or what "
  .. "they do. It stays in your saved file until you upload it; then these characters can appear on everloot.app.\n\n"
  .. "/everloot players off turns it off and deletes the rows. Anyone can hide a character at everloot.app/players/opt-out. "
  .. "Everloot asks this once."
O.ASK_DELAY = 8      -- seconds after the loading screen, so the question does not land on top of it
O.COMBAT_RETRY = 15  -- seconds before trying again when the player is in combat

function O.PlayersAskDue()
  return EverlootDB.playersAsked ~= true and EverlootDB.toggles.players ~= true
end

--- The answer: on runs /everloot players on, as the switch does; off keeps the module off and says so.
function O.AnswerPlayers(on)
  if O.prompt then O.prompt:Hide() end
  if on and SlashCmdList and SlashCmdList.EVERLOOT then
    SlashCmdList.EVERLOOT("players on")
  else
    EverlootDB.playersAsked = true
    print("Everloot: player names stay off. /everloot players on turns them on.")
  end
  O.Refresh()
end

local function buildPrompt()
  local made, f = pcall(CreateFrame, "Frame", "EverlootPlayersPrompt", UIParent, "BackdropTemplate")
  if not made or not f then f = CreateFrame("Frame", "EverlootPlayersPrompt", UIParent) end
  f:SetWidth(440)
  f:SetPoint("CENTER", UIParent, "CENTER", 0, 120)
  f:SetFrameStrata("DIALOG")
  f:SetClampedToScreen(true)
  f:EnableMouse(true)
  local W = E.Window
  local top
  if W and W.Backdrop and W.Heading then
    W.Backdrop(f)
    f.crest, f.title = W.Heading(f, "Player names")
    f.crest:SetPoint("TOPLEFT", f, "TOPLEFT", 12, -10)
    top = f.crest
  else
    if f.SetBackdrop then
      f:SetBackdrop({ bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background", edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
        tile = true, tileSize = 16, edgeSize = 16, insets = { left = 4, right = 4, top = 4, bottom = 4 } })
    end
    f.title = words(f, "GameFontNormalLarge")
    f.title:SetPoint("TOPLEFT", 16, -16)
    f.title:SetText("Everloot: player names")
    top = f.title
  end
  local body = words(f, "GameFontHighlightSmall", 12, "text")
  body:SetPoint("TOPLEFT", top, "BOTTOMLEFT", 4, -10)
  body:SetWidth(400)
  body:SetText(O.PLAYERS_QUESTION)
  f.body = body
  local on = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  on:SetSize(120, 24)
  on:SetPoint("TOPLEFT", body, "BOTTOMLEFT", 0, -14)
  on:SetText("Turn on")
  on:SetScript("OnClick", function() O.AnswerPlayers(true) end)
  local off = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  off:SetSize(120, 24)
  off:SetPoint("LEFT", on, "RIGHT", 10, 0)
  off:SetText("Leave off")
  off:SetScript("OnClick", function() O.AnswerPlayers(false) end)
  f.on, f.off = on, off
  f:SetHeight(10 + 28 + 10 + body:GetStringHeight() + 14 + 24 + 16)
  return f
end

--- Shows the question when it is still due; in combat it tries again a little later.
function O.AskPlayers()
  if not O.PlayersAskDue() or (O.prompt and O.prompt:IsShown()) then return end
  if InCombatLockdown and InCombatLockdown() then
    C_Timer.After(O.COMBAT_RETRY, function() pcall(O.AskPlayers) end)
    return
  end
  if not O.prompt then
    local ok, f = pcall(buildPrompt)
    if not ok or not f then return end
    O.prompt = f
  end
  O.prompt:Show()
end

E:RegisterModule("options", function()
  local how = O.Register()
  -- Only while the question is due, and only with timers: the game's loading screen ends at PLAYER_ENTERING_WORLD.
  if O.PlayersAskDue() and C_Timer and C_Timer.After then
    local listen = CreateFrame("Frame")
    O.askFrame = listen
    listen:RegisterEvent("PLAYER_ENTERING_WORLD")
    listen:SetScript("OnEvent", function(self)
      self:UnregisterEvent("PLAYER_ENTERING_WORLD")
      C_Timer.After(O.ASK_DELAY, function() pcall(O.AskPlayers) end)
    end)
  end
  return "ready (" .. how .. "; /everloot options opens it)"
end)
