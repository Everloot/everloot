-- Everloot settings page: Esc > Options > AddOns > Everloot, or /everloot options. One switch per module and
-- the auction scan prompt, each with what it records and where it goes. A switch with a /everloot command
-- runs that command, so the page and chat behave the same (turning the census, players, completion or addon
-- list off deletes their rows); the others set the toggle. Every change applies after a /reload, which the
-- Reload button does. Settings API (modern clients), then the older interface options, then a plain window.

local E = Everloot
local O = {}
E.Options = O

-- In page order. `group` is the settings page the row sits on (O.GROUPS); `command` is the /everloot word; `field` is a top-level EverlootDB key instead of a toggle;
-- `defaultOff` reads a missing field as off; `live` applies at once, without a reload.
O.ROWS = {
  { key = "window", group = "general", label = "Everloot window",
    text = "The window from the minimap button and /everloot window. It shows what this file holds and records nothing; off leaves recording as it is." },
  { key = "minimapButton", group = "general", field = true, label = "Minimap button",
    text = "The Everloot button on the minimap: click it for the window, right-click for these settings, hover it for other addons' buttons. Off hides it after a reload; /everloot window still opens the window." },
  { key = "buttons", group = "general", command = "buttons", label = "Addon buttons in the Everloot button",
    text = "Other addons' minimap buttons gather into the Everloot minimap button; hover it to use them. Records nothing; off puts them back after a reload." },
  { key = "auctions", group = "auction", command = "auctions", label = "Auction scans",
    text = "Scan this house from the Everloot tab at the auction house, one click at a time. Item prices and quantities, never sellers." },
  { key = "scanPrompt", group = "auction", command = "scanprompt", field = true, label = "Scan prompt at the auction house",
    text = "A small reminder beside the house when a scan can run. The tab and /everloot scan work either way." },
  { key = "autoVendor", group = "auction", command = "vendor", field = true, defaultOff = true, label = "Sell greys and repair at merchants",
    text = "When a merchant window opens: sells grey items and repairs with your own gold, never the guild bank. Records nothing itself." },
  { key = "mailCollect", group = "auction", command = "mail", field = true, defaultOff = true, label = "Collect all at the mailbox",
    text = "A button that takes money and items from auction letters only, one at a time. Skips cash on delivery and other letters." },
  { key = "census", group = "shared", command = "census", label = "Census",
    text = "Race, class, level and faction of your characters and of players near you, nameplates included. Never names, guilds, gear or places. Off deletes its rows." },
  { key = "openworld", group = "shared", label = "World",
    text = "NPCs, loot, quests, vendors and items you see, and where you stood at NPC windows and herbs, ore and chests, and the stats on the item tooltips you see. Anonymous: no character or guild names." },
  { key = "professions", group = "shared", label = "Recipes and trainers",
    text = "At profession and trainer windows you open: each recipe you know with its colour at your rank, product and reagents, and each trainer recipe's required rank and cost. Never crafts or trains. Stays in this file until it is sent." },
  { key = "mapbounds", group = "shared", label = "Zone map corners",
    text = "Each zone's corners in world coordinates, once per zone per game build, so the site can place zone coordinates on one map. Nothing about you. Stays in this file until it is sent." },
  { key = "gold", group = "private", label = "Your gold",
    text = "Your own gold in and out, for gold per hour. Sent only if you share it on the upload page." },
  { key = "roster", group = "private", label = "Your characters",
    text = "Name, realm, class, level, faction, gold and professions of each character you log in with, for the window's Home. Stays in this file; never uploaded." },
  { key = "inventoryCapture", group = "private", field = true, defaultOff = true, live = true, label = "Local inventory snapshots",
    text = "Counts of items in your bags, opened bank and opened mail, with a separate observation time for each. Stays in this file; never uploaded or synced. Off deletes these snapshots." },
  { key = "gear", group = "private", label = "Your gear",
    text = "Your equipped items and item levels, at most once an hour. Sent only if you share it on the upload page." },
  { key = "talents", group = "private", label = "Your talents",
    text = "Your own talent build, read only, for /everloot talents and plans." },
  { key = "guild", group = "private", label = "Guild",
    text = "Your guild's roster, lockouts and loot. Published only through an officer's upload." },
  { key = "completion", group = "private", command = "completion", label = "Completion tracker",
    text = "Your achievements, reputation, titles and completed quests, read only; also your professions, dungeon and raid lockouts, active talent build, character sheet stats and PvP standing. Your boss kills stay on this computer. Collection rows leave from the upload page; achievements, reputation and titles also through the Desktop App's private sync, for a character you linked. Professions, lockouts, talents, stats and PvP never go in an upload, only through private sync. Off deletes its rows." },
  { key = "addons", group = "shared", command = "addons", label = "Installed addon list",
    text = "Each installed addon's name and version. Sent only from the upload page. Off deletes its rows." },
  { key = "players", group = "shared", command = "players", label = "Player pages",
    text = "Name, realm, race, class, level and guild of characters you see, for the site's player pages. Off deletes its rows." },
}
-- Only in the builds that carry the pulls module (E.RUN_RECORDS in core.lua).
if E.Pulls then
  O.ROWS[#O.ROWS + 1] = { key = "pulls", group = "shared", command = "pulls", label = "Boss pulls",
    text = "After each boss pull: your group's names, classes, roles and the game's damage meter totals. Sent from the upload page or the Desktop App. Off deletes its rows." }
end
-- What the item tooltip shows (prices.lua reads them through E.TooltipShows on every hover). They record nothing.
O.ROWS[#O.ROWS + 1] = { key = "tooltipMarket", group = "general", field = true, live = true, label = "Item tooltip: prices",
  text = "Community market value, min buyout and historical price, your own last scan and the vendor price. Records nothing; applies at once." }
O.ROWS[#O.ROWS + 1] = { key = "tooltipHistory", group = "general", field = true, live = true, label = "Item tooltip: your history",
  text = "Your last sale, average sale and units sold, and what you paid where your gold ledger knows it, over the ledger's last 90 days, from your characters on this realm. Read from this file. Records nothing; applies at once." }
O.ROWS[#O.ROWS + 1] = { key = "tooltipSources", group = "general", field = true, live = true, label = "Item tooltip: sources",
  text = "Who drops it, who sells it, the recipes it is a reagent for and the zones you met its sources in. Records nothing; applies at once." }

-- The settings pages, in the game's list under Everloot. Everloot itself is the overview: what this file holds and
-- where the switches are. A client without sub-pages keeps every switch on one page, in O.ROWS order.
O.ROWS[#O.ROWS + 1] = { key = "tooltip", group = "general", field = true, live = true,
  choices = { "full", "compact", "off" }, label = "Item tooltip: detail",
  text = "Click to choose Full, Compact (market value and your scan) or Off. Compact keeps price-age warnings. Records nothing; applies at once." }

O.GROUPS = {
  { key = "general", name = "General",
    intro = "The Everloot window, the minimap button and what the item tooltip shows. Nothing on this page records anything." },
  { key = "auction", name = "Auction house",
    intro = "Scans at the auction house, and the helpers at merchants and the mailbox." },
  { key = "shared", name = "Shared with Everloot",
    intro = "What the addon records for everloot.app. It stays in your saved file until the Everloot Desktop App or the upload page sends it, as each line says." },
  { key = "private", name = "Your characters",
    intro = "Your own characters, gold, gear, talents, guild and completion. Each line says whether it can leave your saved file, and how." },
}
O.INTRO = "What the addon records. Everything stays in your saved file until the Everloot Desktop App or the upload page sends it, as each line says."
O.OVERVIEW = "The switches are on the pages under Everloot in this list: General, Auction house, Shared with Everloot and Your characters."

--- The rows of one page, in O.ROWS order.
function O.RowsOf(group)
  local rows = {}
  for _, row in ipairs(O.ROWS) do
    if row.group == group then rows[#rows + 1] = row end
  end
  return rows
end

-- "What you've added": rows of each kind in the saved file now, shown under the switches.
O.ADDED = {
  loot = "Loot windows", npc_sighting = "NPC sightings", quest = "Quests", recipe_observed = "Recipe colours",
  item_fact = "Item facts", auction_scan = "Auction scans", census_seen = "Players seen", map_bounds = "Zones mapped",
  npc = "NPCs", object_sighting = "Objects", instance_entrance = "Instance entrances", encounter = "Encounters",
  instance_run = "Instance runs", guild_snapshot = "Guild snapshots", raid_lockout = "Raid lockouts",
  attendance = "Attendance", loot_award = "Loot awards", gear_snapshot = "Gear snapshots", vendor = "Vendors",
  collection_catalog = "Collection catalogue", collection_owned = "Your collection", auction_snapshot = "Auction snapshots",
  recipe_seen = "Recipes", trainer_seen = "Trainer recipes", price_seen = "Prices seen", gold_snapshot = "Gold snapshots",
  money_event = "Gold changes", addon_seen = "Addons", talent_snapshot = "Talent builds", guild_kill = "Guild kills",
  achievement_catalog = "Achievement catalogue", reputation_catalog = "Reputation catalogue", title_catalog = "Title catalogue",
  quest_chain_catalog = "Quest chains", achievement_owned = "Your achievements", reputation_owned = "Your reputation",
  title_owned = "Your titles", quest_owned = "Your quests", census_self = "Your census", player_seen = "Player pages",
  character_link = "Character links", pull_summary = "Boss pulls", profession_owned = "Your professions",
  lockout_owned = "Your lockouts", talent_owned = "Your active talents", stats_owned = "Your stats",
  pvp_owned = "Your PvP standing", boss_kill_owned = "Your boss kills",
}

function O.AddedRows()
  local kinds, rows = {}, {}
  for kind, store in pairs(EverlootDB.records or {}) do
    if type(store) == "table" and #store > 0 then kinds[#kinds + 1] = kind end
  end
  table.sort(kinds)
  for _, kind in ipairs(kinds) do rows[#rows + 1] = (O.ADDED[kind] or kind) .. ": " .. tostring(E:Count(kind)) end
  return rows
end

function O.Choice(row)
  local value = EverlootDB[row.key]
  for _, choice in ipairs(row.choices) do if choice == value then return value end end
  return row.choices[1]
end

local function choiceLabel(row)
  local label = O.Choice(row):gsub("^%l", string.upper)
  return label
end

function O.IsOn(row)
  if row.choices then return O.Choice(row) ~= "off" end
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
    if row.key == "inventoryCapture" and not on and E.Inventory then E.Inventory.Withdraw() end
  else
    EverlootDB.toggles[row.key] = on
  end
  O.changed = O.changed or not row.live
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
    "profession_owned", "lockout_owned", "talent_owned", "stats_owned", "pvp_owned", "boss_kill_owned" },
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

local words

function O.Refresh()
  for _, page in ipairs(O.pages or {}) do
    for _, box in ipairs(page.boxes or {}) do
      if box.row.choices then box:SetText(choiceLabel(box.row)) else box:SetChecked(O.IsOn(box.row)) end
    end
    if page.added then
      page.addedRows = O.AddedRows()
      for i, text in ipairs(page.addedRows) do
        if not page.added[i] then page.added[i] = words(page.content, "GameFontHighlightSmall", 11, "muted") end
        page.added[i]:SetText(text)
        page.added[i]:Show()
      end
      for i = #page.addedRows + 1, #page.added do page.added[i]:Hide() end
      if page:IsShown() then page.layout() end
    end
    if page.note then
      page.note:SetText(O.changed and "Changes apply after a reload." or ("Everloot " .. E.VERSION .. ". Changes apply after a reload."))
    end
  end
end

--- Every switch on every page.
function O.Boxes()
  local all = {}
  for _, page in ipairs(O.pages or {}) do
    for _, box in ipairs(page.boxes or {}) do all[#all + 1] = box end
  end
  return all
end

-- Text in the Everloot window's fonts and colours (modules/window.lua loads after this file, before the page is
-- built), else in the game's own template.
words = function(parent, template, size, tone)
  local W = E.Window
  if W and W.Text then return W.Text(parent, size, nil, W.COLORS[tone]) end
  local s = parent:CreateFontString(nil, "ARTWORK", template)
  s:SetJustifyH("LEFT")
  return s
end

local PAD = 8 -- inside the list of switches

--- One settings page: a heading, its introduction, its switches (and, with `added`, what the file holds) in a
--- scrolling list, and Reload now in the footer.
local function build(frameName, name, subtitle, introText, rows, added)
  -- A frame that can take a backdrop, for when the page is shown as a window of its own.
  local made, page = pcall(CreateFrame, "Frame", frameName, nil, "BackdropTemplate")
  if not made or not page then page = CreateFrame("Frame", frameName) end
  page.name = name
  local W = E.Window
  if W and W.Heading then
    page.crest, page.title = W.Heading(page, subtitle)
    page.crest:SetPoint("TOPLEFT", page, "TOPLEFT", 12, -10)
  else
    page.title = words(page, "GameFontNormalLarge")
    page.title:SetPoint("TOPLEFT", 16, -16)
    page.title:SetText("Everloot")
  end
  local intro = words(page, "GameFontHighlightSmall", 11, "muted")
  intro:SetPoint("TOPLEFT", page, "TOPLEFT", 16, -46)
  intro:SetPoint("TOPRIGHT", page, "TOPRIGHT", -32, -46)
  intro:SetText(introText)
  page.intro = intro
  local scroll = CreateFrame("ScrollFrame", nil, page, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", intro, "BOTTOMLEFT", 0, -18)
  scroll:SetPoint("BOTTOMRIGHT", page, "BOTTOMRIGHT", -32, 54)
  local content = CreateFrame("Frame", nil, scroll)
  content:SetSize(1, 1)
  scroll:SetScrollChild(content)
  if W and W.Surface then W.Surface(scroll) end
  page.scroll = scroll
  page.content = content
  page.boxes = {}
  for _, row in ipairs(rows) do
    local box = CreateFrame(row.choices and "Button" or "CheckButton", nil, content,
      row.choices and "UIPanelButtonTemplate" or "UICheckButtonTemplate")
    if row.choices then box:SetSize(70, 24) end
    box.row = row
    local label = words(box, "GameFontNormal", 13, "text")
    label:SetPoint("TOPLEFT", box, "TOPRIGHT", 4, -4)
    label:SetText(row.label)
    local text = words(box, "GameFontHighlightSmall", 11, "muted")
    text:SetPoint("TOPLEFT", label, "BOTTOMLEFT", 0, -2)
    text:SetText(row.text)
    box.label, box.description = label, text
    box:SetScript("OnClick", function(self)
      if row.choices then
        local value = O.Choice(row)
        for i, choice in ipairs(row.choices) do
          if choice == value then EverlootDB[row.key] = row.choices[i % #row.choices + 1]; break end
        end
        O.Refresh()
      else O.Click(row, self:GetChecked() and true or false) end
    end)
    page.boxes[#page.boxes + 1] = box
  end
  -- False, not nil, on the pages without it: a frame's methods would answer for a missing field.
  page.addedHeading, page.added = false, false
  if added then
    page.addedHeading = words(content, "GameFontNormal", 13, "text")
    page.addedHeading:SetText("What you've added")
    page.added = {}
    page.addedRows = {}
  end
  local function layout(_, width)
    width = math.max(1, width or scroll:GetWidth())
    content:SetWidth(width)
    local y = PAD
    for _, box in ipairs(page.boxes) do
      box:SetPoint("TOPLEFT", content, "TOPLEFT", PAD, -y)
      box.label:SetWidth(math.max(1, width - 2 * PAD - (box.row.choices and 76 or 38)))
      box.description:SetWidth(math.max(1, width - 2 * PAD - (box.row.choices and 76 or 38)))
      y = y + math.max(32, 4 + box.label:GetStringHeight() + 2 + box.description:GetStringHeight()) + 12
    end
    if page.addedHeading then
      page.addedHeading:SetPoint("TOPLEFT", content, "TOPLEFT", PAD, -y)
      y = y + 22
      for i = 1, #page.addedRows do
        local line = page.added[i]
        line:SetWidth(math.max(1, width - 2 * PAD))
        line:SetPoint("TOPLEFT", content, "TOPLEFT", PAD, -y)
        y = y + math.max(16, line:GetStringHeight())
      end
    end
    content:SetHeight(y + PAD)
    scroll:SetVerticalScroll(math.min(scroll:GetVerticalScroll(), math.max(0, y - scroll:GetHeight())))
  end
  page.layout = layout
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
  page:SetScript("OnShow", function() O.Refresh(); layout() end)
  -- A new frame starts shown, and the game's list shows a page only when it is picked: hidden until then, so
  -- every first visit runs OnShow and lays out and ticks the switches from the saved file.
  page:Hide()
  return page
end

--- Puts the page in the game's options: the Settings API, else the older interface options, else nothing
--- (/everloot options then shows it as a window). Returns how it was registered.
--- The one page with every switch: older clients, /everloot options as a window, and the fallback below.
local function single()
  return build("EverlootOptionsPage", "Everloot", "Settings", O.INTRO, O.ROWS, true)
end

--- A separate instance uses the same rows and command handlers without moving the game's settings panels.
function O.BuildWindow(parent)
  O.Register()
  local page = build(nil, "Everloot", "Settings", O.INTRO, O.ROWS, true)
  page:SetParent(parent)
  page:SetAllPoints(parent)
  O.pages[#O.pages + 1] = page
  parent.page = page
  page:Show()
end

function O.Register()
  if O.page then return O.how end
  if Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory then
    -- With sub-pages, Everloot is the overview and each group is a short page under it.
    local split = Settings.RegisterCanvasLayoutSubcategory ~= nil
    local page
    if split then
      page = build("EverlootOptionsPage", "Everloot", "Settings", O.INTRO .. "\n\n" .. O.OVERVIEW, {}, true)
    else
      page = single()
    end
    local ok, category = pcall(Settings.RegisterCanvasLayoutCategory, page, "Everloot")
    if ok and category then
      O.page, O.pages = page, { page }
      pcall(Settings.RegisterAddOnCategory, category)
      O.category, O.how = category, "settings"
      if split then
        O.groupPages = {}
        for _, group in ipairs(O.GROUPS) do
          local sub = build("EverlootOptionsPage_" .. group.key, group.name, group.name, group.intro, O.RowsOf(group.key), false)
          local made, subcategory = pcall(Settings.RegisterCanvasLayoutSubcategory, category, sub, group.name)
          if made and subcategory then
            O.pages[#O.pages + 1] = sub
            O.groupPages[group.key] = sub
          else
            -- A page the game refused leaves its switches nowhere in the list: /everloot options then opens the
            -- one page with every switch, as a window.
            O.splitFailed = true
          end
        end
      end
      return O.how
    end
  end
  O.page = single()
  O.pages = { O.page }
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
  if O.how == "settings" and not O.splitFailed and Settings.OpenToCategory then
    local id = O.category.GetID and O.category:GetID() or O.category.ID
    -- The call returns nothing either way: the panel being on screen afterwards is the proof it opened.
    if pcall(Settings.OpenToCategory, id) and not (SettingsPanel and SettingsPanel.IsShown and not SettingsPanel:IsShown()) then return end
  elseif O.how == "interface" and InterfaceOptionsFrame_OpenToCategory then
    -- The older frame needs two calls when it has not been opened yet this session.
    InterfaceOptionsFrame_OpenToCategory(O.page)
    InterfaceOptionsFrame_OpenToCategory(O.page)
    return
  end
  -- As a window: the overview holds no switches, so a split install shows the one page with every switch.
  if O.groupPages and not O.whole then
    O.whole = single()
    O.pages[#O.pages + 1] = O.whole
  end
  local page = O.whole or O.page
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

--- A question window in the Everloot window's look (its dark panel and crest heading), else the game's dialog with a
--- plain title. Returns the frame and the heading to place the text under.
local function dialog(name, width, subtitle)
  local made, f = pcall(CreateFrame, "Frame", name, UIParent, "BackdropTemplate")
  if not made or not f then f = CreateFrame("Frame", name, UIParent) end
  f:SetWidth(width)
  f:SetPoint("CENTER", UIParent, "CENTER", 0, 120)
  f:SetFrameStrata("DIALOG")
  f:SetClampedToScreen(true)
  f:EnableMouse(true)
  local W = E.Window
  if W and W.Backdrop and W.Heading then
    W.Backdrop(f)
    f.crest, f.title = W.Heading(f, subtitle)
    f.crest:SetPoint("TOPLEFT", f, "TOPLEFT", 12, -10)
    return f, f.crest
  end
  if f.SetBackdrop then
    f:SetBackdrop({ bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background", edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
      tile = true, tileSize = 16, edgeSize = 16, insets = { left = 4, right = 4, top = 4, bottom = 4 } })
  end
  f.title = words(f, "GameFontNormalLarge")
  f.title:SetPoint("TOPLEFT", 16, -16)
  f.title:SetText("Everloot: " .. subtitle:lower())
  return f, f.title
end

local function buildPrompt()
  local f, top = dialog("EverlootPlayersPrompt", 440, "Player names")
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

-- The feature chooser. A player who already has an auction addon, a raid helper or a minimap button bag can keep
-- them and use Everloot for some of its jobs, or only to collect data (player feedback, 2026-11-16). Each install is
-- asked once, new and upgraded alike, before the player-names question; /everloot setup asks again at any time.
-- "Choose myself" keeps every switch as it is and opens these pages. No answer touches the census, player names, the
-- addon list or the completion tracker: they keep their own consent, and turning them off deletes rows.
O.SETUP_INTRO = "Everloot does several jobs. Use all of them, or only the ones your other addons don't already do. "
  .. "The census, player names, the addon list and the completion tracker keep their own switches."
O.SETUP_UPLOAD = "The Everloot Desktop App sends what you collect after you log out or /reload, so you never upload "
  .. "files by hand. Download it at everloot.app/addon."
O.SETUP_CHOICES = {
  { key = "everything", label = "Everything",
    text = "Item tooltips with prices and sources, the auction house tab, the Everloot window and minimap button, and your characters' gold, gear and talents." },
  { key = "collect", label = "Collect data only",
    text = "Records drops, vendors, recipes and the auction scans you start from its tab, for everloot.app. No tooltip lines, window, minimap button or helpers, so Auctionator and your other addons stay in charge." },
  { key = "choose", label = "Choose myself",
    text = "Keeps your switches as they are and opens the settings, one switch per feature." },
}
-- What each answer sets: `toggles` are module switches, `fields` top-level settings (O.ROWS).
O.SETUP = {
  everything = {
    toggles = { openworld = true, professions = true, mapbounds = true, auctions = true, window = true,
      gold = true, roster = true, gear = true, talents = true, guild = true },
    fields = { scanPrompt = true, minimapButton = true, tooltip = "full", tooltipMarket = true, tooltipHistory = true, tooltipSources = true },
  },
  collect = {
    toggles = { openworld = true, professions = true, mapbounds = true, auctions = true, window = false, buttons = false,
      gold = false, roster = false, gear = false, talents = false, guild = false },
    fields = { scanPrompt = false, minimapButton = false, tooltip = "off", autoVendor = false, mailCollect = false },
  },
}

function O.SetupDue()
  return EverlootDB.setupAsked ~= true
end

--- A setting's value as the addon reads it, defaults included.
local function current(key, toggle)
  if toggle then return EverlootDB.toggles[key] ~= false end
  for _, row in ipairs(O.ROWS) do
    if row.key == key then return row.choices and O.Choice(row) or O.IsOn(row) end
  end
  return EverlootDB[key]
end

--- Sets one answer's switches; true when one of them applies only after a reload.
function O.ApplySetup(name)
  local set, reload = O.SETUP[name], false
  for key, value in pairs(set.toggles) do
    if current(key, true) ~= value then reload = true end
    EverlootDB.toggles[key] = value
  end
  local live = {}
  for _, row in ipairs(O.ROWS) do live[row.key] = row.live end
  for key, value in pairs(set.fields) do
    if current(key) ~= value and not live[key] then reload = true end
    EverlootDB[key] = value
  end
  return reload
end

local function setupDone(f, reload)
  for _, part in ipairs(f.choiceParts) do part:Hide() end
  f.done:SetText(reload and "Saved. The rest changes after a reload." or "Saved.")
  f.done:Show()
  f.reload:Show()
  f.later:SetText(reload and "Later" or "Close")
  f.later:Show()
  f:SetHeight(48 + f.done:GetStringHeight() + 14 + 24 + 16)
end

--- An answer. Everything and Collect data only set their switches and offer a reload; Choose myself opens the pages.
function O.AnswerSetup(key)
  EverlootDB.setupAsked = true
  local f = O.setup
  if key == "choose" then
    if f then f:Hide() end
    print("Everloot: your switches stay as they are. /everloot setup asks again.")
    O.Open()
    O.AskPlayers()
    return
  end
  local reload = O.ApplySetup(key)
  O.changed = O.changed or reload
  print("Everloot: " .. (key == "collect"
    and "collecting data only. Item tooltip lines are off now; the window, the minimap button and the helpers go after a reload."
    or "every feature on.") .. " /everloot setup or /everloot options changes it.")
  O.Refresh()
  if f then setupDone(f, reload) end
  if not reload then
    if f then f:Hide() end
    O.AskPlayers()
  end
end

local function buildSetup()
  local f = dialog("EverlootSetupPrompt", 480, "Features")
  local intro = words(f, "GameFontHighlightSmall", 12, "text")
  intro:SetPoint("TOPLEFT", f, "TOPLEFT", 16, -48)
  intro:SetWidth(448)
  intro:SetText(O.SETUP_INTRO)
  f.intro = intro
  f.choiceParts, f.choices = { intro }, {}
  local y = 48 + intro:GetStringHeight() + 14
  for _, choice in ipairs(O.SETUP_CHOICES) do
    local button = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
    button:SetSize(150, 24)
    button:SetPoint("TOPLEFT", f, "TOPLEFT", 16, -y)
    button:SetText(choice.label)
    button:SetScript("OnClick", function() O.AnswerSetup(choice.key) end)
    local text = words(f, "GameFontHighlightSmall", 11, "muted")
    text:SetPoint("TOPLEFT", f, "TOPLEFT", 176, -y - 2)
    text:SetWidth(288)
    text:SetText(choice.text)
    button.description = text
    f.choices[choice.key] = button
    f.choiceParts[#f.choiceParts + 1] = button
    f.choiceParts[#f.choiceParts + 1] = text
    y = y + math.max(24, text:GetStringHeight() + 2) + 12
  end
  local upload = words(f, "GameFontHighlightSmall", 11, "text")
  upload:SetPoint("TOPLEFT", f, "TOPLEFT", 16, -y)
  upload:SetWidth(448)
  upload:SetText(O.SETUP_UPLOAD)
  f.upload = upload
  f.choiceParts[#f.choiceParts + 1] = upload
  local height = y + upload:GetStringHeight() + 16
  f:SetHeight(height)
  -- After Everything or Collect data only: a reload applies what changed.
  local done = words(f, "GameFontHighlightSmall", 12, "text")
  done:SetPoint("TOPLEFT", f, "TOPLEFT", 16, -48)
  done:SetWidth(448)
  local reload = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  reload:SetSize(120, 24)
  reload:SetPoint("TOPLEFT", done, "BOTTOMLEFT", 0, -14)
  reload:SetText("Reload now")
  reload:SetScript("OnClick", function() if ReloadUI then ReloadUI() end end)
  local later = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  later:SetSize(120, 24)
  later:SetPoint("LEFT", reload, "RIGHT", 10, 0)
  later:SetText("Later")
  later:SetScript("OnClick", function() f:Hide(); O.AskPlayers() end)
  done:Hide(); reload:Hide(); later:Hide()
  f.done, f.reload, f.later = done, reload, later
  --- Back to the three answers, for the next time it is asked.
  function f.reset()
    for _, part in ipairs(f.choiceParts) do part:Show() end
    done:Hide(); reload:Hide(); later:Hide()
    f:SetHeight(height)
  end
  return f
end

--- Shows the chooser when it is due, or always with `again` (/everloot setup); in combat it tries again later.
function O.AskSetup(again)
  if not (again or O.SetupDue()) or (O.setup and O.setup:IsShown()) then return end
  if InCombatLockdown and InCombatLockdown() then
    if C_Timer and C_Timer.After then
      C_Timer.After(O.COMBAT_RETRY, function() pcall(O.AskSetup, again) end)
    else
      print("Everloot: /everloot setup works out of combat.")
    end
    return
  end
  if not O.setup then
    local ok, f = pcall(buildSetup)
    if not ok or not f then return end
    O.setup = f
  end
  O.setup.reset()
  O.setup:Show()
end

--- The questions an install still owes, one at a time: the chooser first, then player names.
function O.AskNext()
  if O.SetupDue() then return O.AskSetup() end
  return O.AskPlayers()
end

E:RegisterModule("options", function()
  local how = O.Register()
  -- Only while a question is due, and only with timers: the game's loading screen ends at PLAYER_ENTERING_WORLD.
  if (O.SetupDue() or O.PlayersAskDue()) and C_Timer and C_Timer.After then
    local listen = CreateFrame("Frame")
    O.askFrame = listen
    listen:RegisterEvent("PLAYER_ENTERING_WORLD")
    listen:SetScript("OnEvent", function(self)
      self:UnregisterEvent("PLAYER_ENTERING_WORLD")
      C_Timer.After(O.ASK_DELAY, function() pcall(O.AskNext) end)
    end)
  end
  return "ready (" .. how .. "; /everloot options opens it)"
end)
