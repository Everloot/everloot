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
  { key = "gear", label = "Your gear",
    text = "Your equipped items and item levels, at most once an hour. Sent only if you share it on the upload page." },
  { key = "talents", label = "Your talents",
    text = "Your own talent build, read only, for /everloot talents and plans." },
  { key = "guild", label = "Guild",
    text = "Your guild's roster, lockouts and loot. Published only through an officer's upload." },
  { key = "completion", command = "completion", label = "Completion tracker",
    text = "Your achievements, reputation, titles and completed quests, read only. Off deletes its rows." },
  { key = "addons", command = "addons", label = "Installed addon list",
    text = "Each installed addon's name and version. Sent only from the upload page. Off deletes its rows." },
  { key = "players", command = "players", label = "Player pages",
    text = "Name, realm, race, class, level and guild of characters you see, for the site's player pages. Off deletes its rows." },
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

function O.Refresh()
  local page = O.page
  if not page then return end
  for _, box in ipairs(page.boxes or {}) do box:SetChecked(O.IsOn(box.row)) end
  if page.note then
    page.note:SetText(O.changed and "Changes apply after a reload." or ("Everloot " .. E.VERSION .. ". Changes apply after a reload."))
  end
end

local function build()
  local page = CreateFrame("Frame", "EverlootOptionsPage")
  page.name = "Everloot"
  local title = page:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  title:SetPoint("TOPLEFT", 16, -16)
  title:SetText("Everloot")
  local intro = page:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  intro:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -6)
  intro:SetWidth(560)
  intro:SetJustifyH("LEFT")
  intro:SetText("What the addon records. Everything stays in your saved file until the Everloot Desktop App or the upload page sends it, as each line says.")
  -- Ask Everloot: the question goes into the file, the companion answers it, and /reload prints it.
  local ask = CreateFrame("EditBox", nil, page, "InputBoxTemplate")
  ask:SetSize(380, 22)
  ask:SetPoint("TOPLEFT", intro, "BOTTOMLEFT", 0, -22)
  if ask.SetAutoFocus then ask:SetAutoFocus(false) end
  if ask.EnableMouse then ask:EnableMouse(true) end
  local askLabel = page:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  askLabel:SetPoint("LEFT", ask, "RIGHT", 8, 0)
  askLabel:SetText("Ask Everloot, then /reload for the answer")
  local send = CreateFrame("Button", nil, page, "UIPanelButtonTemplate")
  send:SetSize(64, 22)
  send:SetPoint("LEFT", askLabel, "RIGHT", 8, 0)
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
  page.boxes = {}
  local anchor, gap = ask, -18
  for _, row in ipairs(O.ROWS) do
    local box = CreateFrame("CheckButton", nil, page, "UICheckButtonTemplate")
    box:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, gap)
    box.row = row
    local label = box:CreateFontString(nil, "ARTWORK", "GameFontNormal")
    label:SetPoint("LEFT", box, "RIGHT", 4, 1)
    label:SetText(row.label)
    local text = box:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    text:SetPoint("TOPLEFT", label, "BOTTOMLEFT", 0, -2)
    text:SetWidth(520)
    text:SetJustifyH("LEFT")
    text:SetText(row.text)
    box:SetScript("OnClick", function(self) O.Set(row, self:GetChecked() and true or false) end)
    page.boxes[#page.boxes + 1] = box
    anchor, gap = box, -18
  end
  local reload = CreateFrame("Button", nil, page, "UIPanelButtonTemplate")
  reload:SetSize(140, 24)
  reload:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, -20)
  reload:SetText("Reload now")
  reload:SetScript("OnClick", function() if ReloadUI then ReloadUI() end end)
  page.reload = reload
  local note = page:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
  note:SetPoint("LEFT", reload, "RIGHT", 10, 0)
  page.note = note
  page:SetScript("OnShow", O.Refresh)
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
    if page.SetBackdrop then
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

E:RegisterModule("options", function()
  return "ready (" .. O.Register() .. "; /everloot options opens it)"
end)
