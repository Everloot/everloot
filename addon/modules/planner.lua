-- Website plans beside your character and raid. Native frames, created on demand; no polling.
local E = Everloot
local W = { tab = "talents" }
E.Planner = W

local COLORS = {
  canvas = { 0.055, 0.059, 0.051, 0.98 }, surface = { 0.082, 0.09, 0.102, 1 },
  line = { 0.23, 0.23, 0.21, 1 }, text = { 0.957, 0.937, 0.867, 1 },
  muted = { 0.788, 0.765, 0.69, 1 }, accent = { 0.612, 0.941, 0.227, 1 },
}

local function background(frame, color)
  local texture = frame:CreateTexture(nil, "BACKGROUND")
  texture:SetAllPoints()
  texture:SetColorTexture(unpack(color))
  return texture
end

local function label(parent, text, x, y, font, color)
  local line = parent:CreateFontString(nil, "OVERLAY", font or "GameFontHighlight")
  line:SetPoint("TOPLEFT", x, y)
  line:SetJustifyH("LEFT")
  line:SetTextColor(unpack(color or COLORS.text))
  line:SetText(text)
  return line
end

local function button(parent, text, x, y, width, action)
  local b = CreateFrame("Button", nil, parent)
  b:SetPoint("TOPLEFT", x, y)
  b:SetSize(width, 30)
  background(b, COLORS.surface)
  b:SetHighlightTexture("Interface\\Buttons\\WHITE8X8")
  local highlight = b:GetHighlightTexture()
  if highlight then highlight:SetVertexColor(0.612, 0.941, 0.227, 0.12) end
  b.text = label(b, text, 12, -8, "GameFontHighlightSmall")
  b:SetScript("OnClick", action)
  return b
end

local function notice(text)
  if W.frame then W.frame.notice:SetText(text or "") end
end

local function hasTalents()
  return E.Plan and E.Talents and E.Talents.HasTraitApi and E.Talents.HasTraitApi()
end

function W.Refresh()
  local f = W.frame
  if not (f and f:IsShown()) then return end
  local lines
  if W.tab == "talents" then
    if hasTalents() then E.Plan.Refresh(); lines = E.Plan.Lines()
    else lines = { "Talent comparison is unavailable: this client's trait API is missing." } end
  elseif E.Raid then
    local members, why = E.Raid.ReadGroup()
    lines = E.Raid.PlanLines(members)
    lines[#lines + 1] = ""
    lines[#lines + 1] = "CURRENT RAID / BUFF CHECK"
    lines[#lines + 1] = members and E.RaidData and E.Raid.Report(members, E.RaidData)
      or (why or "Raid buff data is unavailable.")
  end
  f.body:SetText(table.concat(lines or { "This tool is unavailable on this client." }, "\n\n"))
  local height = tonumber(f.body:GetStringHeight() or 260) or 260
  f.content:SetHeight(math.max(260, height + 16))
end

function W.Import()
  local f = W.frame
  if not f then return end
  local input = f.box:GetText():match("^%s*(.-)%s*$")
  local isLink = input:match("^https?://") ~= nil
  local ok, reason, twoSets
  if W.tab == "talents" and not hasTalents() then
    notice("Talent import is unavailable: this client's trait API is missing."); return
  elseif W.tab == "talents" then
    if #input > 16000 then notice("That talent code is too long."); return end
    -- A calculator link carries each set's code and order (plan= and order=, plan2= and order2=); a build
    -- link's path carries codes only. One set loads, the first or else the second, with its own order only.
    local link = E.Plan.ReadLink(input)
    local first = link.first or input:match("^https?://[^/]+/tools/talents/%a+/b/([^/?#]+)")
    local second = link.second or input:match("^https?://[^/]+/tools/talents/%a+/b/%-/([^/?#]+)")
    if first == "-" then first = nil end
    local order, set
    if first then input, order = first, link.firstOrder
    elseif second then input, order, set = second, link.secondOrder, 2 end
    if not input:match("^EL%d+%-") and isLink then
      notice("Open this link on the website and use Copy for addon for the set you want."); return
    end
    twoSets = link.first ~= nil and link.second ~= nil
    ok, reason = E.Plan.Load(input, true, order, set)
  elseif E.Raid then
    ok, reason = E.Raid.Load(input)
  end
  if ok then
    f.box:SetText("")
    f.box:ClearFocus()
    if W.tab == "raid" then notice("Plan loaded. Compare class counts by group below; arrange players yourself.")
    else
      notice("Plan loaded. " .. E.Plan.OrderText() .. (twoSets
        and " The link has two talent sets, so the first loaded; Copy for addon on the website copies the one you choose." or ""))
    end
    W.Refresh()
    f.scroll:SetVerticalScroll(0)
  else
    notice(reason or "This tool is unavailable on this client.")
  end
end

local refreshPending = false
local function onEvent(_, event)
  if not (W.frame and W.frame:IsShown()) then return end
  if (event == "GROUP_ROSTER_UPDATE") ~= (W.tab == "raid") then return end
  if C_Timer and type(C_Timer.After) == "function" then
    if refreshPending then return end
    refreshPending = true
    C_Timer.After(0.2, function() refreshPending = false; W.Refresh() end)
  else W.Refresh() end
end

local function copy(text)
  if not text then notice("Import a plan first, then copy its link here."); return end
  local box = W.frame.box
  box:SetText(text)
  box:SetFocus()
  box:HighlightText()
  notice("Press Ctrl+C to copy the selected link.")
end

local function exportPlan()
  if W.tab == "talents" then
    copy(E.Plan and E.Plan.Link())
  else
    local plan = E.Raid and E.Raid.Decode(EverlootDB.raidPlan)
    copy(plan and ("https://everloot.app/tools/raid#raid=" .. EverlootDB.raidPlan))
  end
end

local function build()
  if W.frame then return W.frame end
  local f = CreateFrame("Frame", "EverlootPlannerFrame", UIParent)
  f:SetSize(720, 530)
  f:SetPoint("CENTER")
  f:SetFrameStrata("DIALOG")
  f:SetClampedToScreen(true)
  f:SetMovable(true)
  f:EnableMouse(true)
  background(f, COLORS.canvas)
  local header = CreateFrame("Frame", nil, f)
  header:SetPoint("TOPLEFT")
  header:SetSize(600, 60)
  header:EnableMouse(true)
  header:RegisterForDrag("LeftButton")
  header:SetScript("OnDragStart", function() f:StartMoving() end)
  header:SetScript("OnDragStop", function() f:StopMovingOrSizing() end)
  label(f, "EVERLOOT", 24, -20, "GameFontNormalLarge", COLORS.accent)
  label(f, "Your plan. In your game.", 180, -23, "GameFontHighlightSmall", COLORS.muted)
  button(f, "Close", 638, -14, 64, function() f:Hide() end)

  f.tabs = {}
  for i, tab in ipairs({ "talents", "raid" }) do
    local key = tab
    f.tabs[key] = button(f, key == "talents" and "Talents" or "Raid", 24 + (i - 1) * 118, -66, 110,
      function() W.Open(key) end)
    local selected = f.tabs[key]:CreateTexture(nil, "OVERLAY")
    selected:SetPoint("BOTTOMLEFT")
    selected:SetSize(110, 2)
    selected:SetColorTexture(unpack(COLORS.accent))
    f.tabs[key].selected = selected
  end
  local divider = f:CreateTexture(nil, "ARTWORK")
  divider:SetPoint("TOPLEFT", 24, -104)
  divider:SetSize(672, 1)
  divider:SetColorTexture(unpack(COLORS.line))
  f.heading = label(f, "", 24, -116, "GameFontNormalLarge")
  f.hint = label(f, "", 24, -141, "GameFontHighlightSmall", COLORS.muted)
  f.hint:SetWidth(660)
  label(f, "WEBSITE CODE OR LINK", 24, -178, "GameFontHighlightSmall", COLORS.muted)
  local box = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
  box:SetPoint("TOPLEFT", 30, -200)
  box:SetSize(552, 30)
  box:SetAutoFocus(false)
  box:SetMaxLetters(16000)
  box:SetScript("OnEnterPressed", W.Import)
  box:SetScript("OnEscapePressed", function(self) self:ClearFocus(); f:Hide() end)
  f.box = box
  f.import = button(f, "Import", 600, -200, 96, W.Import)
  f.notice = label(f, "", 24, -242, "GameFontHighlightSmall", COLORS.accent)
  f.notice:SetWidth(660)

  local scroll = CreateFrame("ScrollFrame", nil, f, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", 24, -280)
  scroll:SetSize(646, 176)
  local content = CreateFrame("Frame", nil, scroll)
  content:SetSize(636, 260)
  f.body = label(content, "", 0, 0, "GameFontHighlight", COLORS.text)
  f.body:SetWidth(624)
  f.body:SetJustifyV("TOP")
  scroll:SetScrollChild(content)
  f.scroll, f.content = scroll, content

  f.refresh = button(f, "Refresh", 24, -478, 86, function() W.Refresh(); notice("Updated from your current character and group.") end)
  f.export = button(f, "Copy plan link", 118, -478, 120, exportPlan)
  f.clear = button(f, "Clear plan", 246, -478, 96, function()
    if W.tab == "talents" and E.Plan then E.Plan.Clear()
    elseif E.Raid then E.Raid.ClearPlan() end
    f.box:SetText(""); W.Refresh(); notice("Plan cleared from this tab.")
  end)
  f.current = button(f, "Copy current raid", 350, -478, 144, function()
    local members, why = E.Raid.ReadGroup()
    if not members then notice(why); return end
    local code, reason = E.Raid.Code(members, EverlootDB.clientBuild)
    if code then copy("https://everloot.app/tools/raid#raid=" .. code) else notice(reason) end
  end)
  button(f, "Settings", 610, -478, 86, function() if E.Options then E.Options.Open() end end)
  f:SetScript("OnHide", function()
    box:ClearFocus()
    if E.Plan and E.Plan.HideMarks then E.Plan.HideMarks() end
  end)
  -- Changes update a visible window; nothing polls while it is closed.
  for _, event in ipairs({ "GROUP_ROSTER_UPDATE", "TRAIT_CONFIG_UPDATED", "TRAIT_NODE_CHANGED",
    "ACTIVE_PLAYER_SPECIALIZATION_CHANGED", "PLAYER_TALENT_UPDATE" }) do
    pcall(f.RegisterEvent, f, event)
  end
  f:SetScript("OnEvent", onEvent)
  if UISpecialFrames then UISpecialFrames[#UISpecialFrames + 1] = "EverlootPlannerFrame" end
  f:Hide()
  W.frame = f
  return f
end

function W.Open(tab)
  local previous, wasShown = W.tab, W.frame and W.frame:IsShown()
  W.tab = tab == "raid" and "raid" or tab == "talents" and "talents" or W.tab
  local f = build()
  if E.Plan and E.Plan.UseWorkspace then E.Plan.UseWorkspace() end
  local raid = W.tab == "raid"
  f.heading:SetText(raid and "Bring your raid plan" or "Follow your talent plan")
  f.hint:SetText(raid and "Website > Copy for addon > Import here. Compare class counts, then arrange your raid."
    or "Website > Copy for addon > Import here. Compare your build, then spend points yourself.")
  for key, b in pairs(f.tabs) do
    b.text:SetTextColor(unpack(key == W.tab and COLORS.accent or COLORS.muted))
    if key == W.tab then b.selected:Show() else b.selected:Hide() end
  end
  if raid then
    f.current:Show()
    if E.Plan and E.Plan.HideMarks then E.Plan.HideMarks() end
  else f.current:Hide() end
  if not wasShown or previous ~= W.tab then f.box:SetText(""); f.box:ClearFocus(); notice("") end
  local width = UIParent and UIParent.GetWidth and tonumber(UIParent:GetWidth())
  local height = UIParent and UIParent.GetHeight and tonumber(UIParent:GetHeight())
  if width and height then f:SetScale(math.min(1, (width - 32) / 720, (height - 32) / 530)) end
  f:Show()
  f.scroll:SetVerticalScroll(0)
  W.Refresh()
end

E:RegisterModule("planner", function() return "ready (/everloot; website talent and raid plans)" end)
