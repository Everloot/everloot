-- Everloot window, Collection: this character's achievements, reputation, titles and raid lockouts, from the rows
-- the completion tracker (completion.lua) and owned.lua wrote, read through Everloot:Rows.
-- Display only: it reads, the one button runs /everloot completion on, the command the player could type, and
-- nothing here records. It registers no events; the window builds it the first time Collection is opened.

local E = Everloot
if not (E.Window and E.Window.Views) then return end
local U = E.Window
local COLORS, NARROW, text, surface = U.COLORS, U.NARROW, U.Text, U.Surface

local W = 604          -- the view frame window.lua gives every view (W - MAIN - 12 wide)
local ROWS, ROW_H = 12, 18
local SECTIONS = { { "achievements", "Achievements" }, { "reputation", "Reputation" }, { "titles", "Titles" }, { "raids", "Raids" } }
local EXALTED = 8
local OFF_TEXT = "The completion tracker reads your achievements, reputation, titles, completed quests, professions, raid "
  .. "lockouts, active talent build, character sheet stats and PvP standing, from the game's own windows, never writing "
  .. "back. Collection rows leave only from the upload page; professions, lockouts, talents, stats and PvP never go in an upload."
local TURNED_ON = "Turned on. /reload to start reading."
local NOTHING_READ = "Nothing read yet. Open the achievements, reputation or titles window, then /reload."
local NOTHING_MISSING = "Nothing missing here."
local NO_KEY = "This character cannot be identified yet."
local NO_RAIDS = "No raid lockouts this week."

local refresh

-- A click redraws the view; an error closes the window as any other view error does.
local function redraw()
  local ok, err = pcall(refresh, U.frame)
  if not ok then U.Fail(err) end
end

local function box(parent, x, y, w, h)
  local b = CreateFrame("Frame", nil, parent)
  b:SetPoint("TOPLEFT", x, y)
  b:SetSize(w, h)
  return surface(b)
end

local function button(parent, label, w, onClick)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetSize(w, 20)
  b:SetText(label)
  b:SetScript("OnClick", function() onClick(); redraw() end)
  return b
end

local function lit(b, on)
  if on then b:LockHighlight() else b:UnlockHighlight() end
end

local function number(v) return type(v) == "number" end
local function name(v) return type(v) == "string" and v ~= "" and v or "-" end
local function byName(a, b) return a.name < b.name end

-- This character's rows of one owned kind, by the catalog id in `field`.
local function owned(kind, key, field)
  local out = {}
  for _, r in ipairs(E:Rows(kind)) do
    if type(r) == "table" and r.characterKey == key and r[field] ~= nil then out[r[field]] = r end
  end
  return out
end

-- Each section returns its items ({ name, detail, done, bar = { floor, ceiling, standing } }) and its summary line.
local function achievements(key)
  local mine = owned("achievement_owned", key, "achievementId")
  local items, done, points = {}, 0, 0
  for _, a in ipairs(E:Rows("achievement_catalog")) do
    if type(a) == "table" then
      local o = mine[a.achievementId]
      local pts = number(a.points) and a.points or nil
      local item = { name = name(a.name), detail = (pts or "-") .. " pts · " .. name(a.category), done = o and o.completed == true or false }
      if item.done then
        done, points = done + 1, points + (pts or 0)
        item.when = type(o.earnedOn) == "string" and o.earnedOn or nil
        if item.when then item.detail = item.detail .. " · " .. item.when end
      end
      items[#items + 1] = item
    end
  end
  -- Earned first, newest first; then the rest by name.
  table.sort(items, function(a, b)
    if a.done ~= b.done then return a.done end
    if a.done and a.when ~= b.when then return (a.when or "") > (b.when or "") end
    return byName(a, b)
  end)
  return items, "Achievements: " .. done .. " of " .. #items .. " · " .. points .. " points"
end

local function reputation(key)
  local mine = owned("reputation_owned", key, "factionId")
  local items, exalted = {}, 0
  for _, r in ipairs(E:Rows("reputation_catalog")) do
    if type(r) == "table" and not r.major then
      local o = mine[r.factionId]
      local item = { name = name(r.name), detail = "-", done = false }
      if o and number(o.standing) and number(o.floor) and number(o.ceiling) then
        item.bar = { o.floor, o.ceiling, o.standing }
        item.detail = o.standing .. " / " .. o.ceiling
      end
      if o and number(o.reaction) and o.reaction >= EXALTED then item.done, exalted = true, exalted + 1 end
      items[#items + 1] = item
    end
  end
  table.sort(items, byName)
  return items, "Reputation: " .. #items .. (#items == 1 and " faction" or " factions") .. " · " .. exalted .. " exalted"
end

local function titles(key)
  local known = {}
  for _, r in ipairs(E:Rows("title_owned")) do
    if type(r) == "table" and r.characterKey == key and type(r.titleIds) == "table" then
      for _, id in ipairs(r.titleIds) do known[id] = true end
    end
  end
  local items, n = {}, 0
  for _, t in ipairs(E:Rows("title_catalog")) do
    if type(t) == "table" then
      local done = known[t.titleId] == true
      if done then n = n + 1 end
      items[#items + 1] = { name = name(t.name), detail = "", done = done }
    end
  end
  table.sort(items, byName)
  return items, "Titles: " .. n .. " of " .. #items
end

-- Lockouts as owned.lua wrote them; one whose reset time has passed is gone in the game too.
local function raids(key)
  local now = date("!%Y-%m-%dT%H:%M:%SZ", time())
  local items = {}
  for _, r in ipairs(E:Rows("lockout_owned")) do
    if type(r) == "table" and r.characterKey == key and type(r.resetAt) == "string" and r.resetAt > now then
      local killed, total = r.bossesKilledCount, r.bossesTotal
      local day, hour = r.resetAt:match("^(%d+%-%d+%-%d+)T(%d+:%d+)")
      items[#items + 1] = {
        name = name(r.instance) .. (type(r.difficulty) == "string" and (" · " .. r.difficulty) or ""),
        detail = (number(killed) and killed or "-") .. " of " .. (number(total) and total or "-")
          .. " · resets " .. (day and (day .. " " .. hour) or "-"),
        done = number(killed) and number(total) and killed >= total or false,
      }
    end
  end
  table.sort(items, byName)
  return items, #items > 0 and ("Raids: " .. #items .. " saved this week") or NO_RAIDS
end

local READ = { achievements = achievements, reputation = reputation, titles = titles, raids = raids }

local function draw(row, item)
  row.name:SetText(item.name)
  row.detail:SetText(item.detail)
  row.done:SetText(item.done and "done" or "")
  if item.bar then
    row.bar:SetMinMaxValues(item.bar[1], item.bar[2])
    row.bar:SetValue(item.bar[3])
    row.bar:Show()
  else
    row.bar:Hide()
  end
end

-- Fills the list from `items` at its offset. With no items, the empty line.
local function show(rows, items, empty)
  local n = #items
  rows.offset = math.min(rows.offset, math.floor(math.max(n - 1, 0) / ROWS) * ROWS)
  for i, row in ipairs(rows) do
    local item = items[rows.offset + i]
    if item then draw(row, item); row:Show() else row:Hide() end
  end
  rows.empty:SetText(empty)
  if n == 0 then rows.empty:Show() else rows.empty:Hide() end
  if rows.offset > 0 then rows.up:Show() else rows.up:Hide() end
  if rows.offset + ROWS < n then rows.down:Show() else rows.down:Hide() end
end

function refresh(f)
  local c = f.collection
  -- Turned on this session: the tracker starts reading after /reload, so the page keeps saying so until then.
  if c.turnedOn or not E:IsEnabled("completion") then
    c.offPage:Show(); c.onPage:Hide()
    return
  end
  c.offPage:Hide(); c.onPage:Show()
  for _, s in ipairs(SECTIONS) do lit(c.sections[s[1]], s[1] == c.section) end
  c.missingOnly:SetText(c.missing and "Show all" or "Missing only")
  local ok, key = pcall(E.CharacterKey)
  local items, summary, empty = {}, "", NO_KEY
  if ok and key then
    items, summary = READ[c.section](key)
    empty = c.section == "raids" and NO_RAIDS or NOTHING_READ
    if c.missing and #items > 0 then
      local left = {}
      for _, item in ipairs(items) do if not item.done then left[#left + 1] = item end end
      items, empty = left, NOTHING_MISSING
    end
  end
  c.summary:SetText(summary)
  show(c.rows, items, empty)
end

local function build(f, parent)
  local c = { section = "achievements", missing = false, sections = {} }
  f.collection = c

  -- Off: what the tracker reads and where its rows go, and the command that turns it on.
  c.offPage = box(parent, 0, 0, W, 120)
  c.offText = text(c.offPage, 12)
  c.offText:SetPoint("TOPLEFT", 10, -10)
  c.offText:SetWidth(W - 20)
  c.offText:SetJustifyV("TOP")
  c.offText:SetText(OFF_TEXT)
  c.turnOn = button(c.offPage, "Turn on", 90, function()
    pcall(SlashCmdList.EVERLOOT, "completion on")
    if E:IsEnabled("completion") then
      c.turnedOn = true
      c.offText:SetText(TURNED_ON)
      c.turnOn:Hide()
    end
  end)
  c.turnOn:SetPoint("BOTTOMLEFT", 10, 10)

  -- On: the sections and the missing-only switch at the top, the summary, then the list.
  c.onPage = CreateFrame("Frame", nil, parent)
  c.onPage:SetPoint("TOPLEFT", 0, 0)
  c.onPage:SetSize(W, 390)
  for i, s in ipairs(SECTIONS) do
    c.sections[s[1]] = button(c.onPage, s[2], 100, function() c.section = s[1]; c.rows.offset = 0 end)
    c.sections[s[1]]:SetPoint("TOPLEFT", (i - 1) * 104, -8)
  end
  c.missingOnly = button(c.onPage, "Missing only", 100, function() c.missing = not c.missing; c.rows.offset = 0 end)
  c.missingOnly:SetPoint("TOPRIGHT", 0, -8)
  c.summary = text(c.onPage, 13)
  c.summary:SetPoint("TOPLEFT", 4, -40)
  c.summary:SetWidth(W - 8)

  local list = box(c.onPage, 0, -62, W, 260)
  local rows = { offset = 0 }
  for i = 1, ROWS do
    local row = CreateFrame("Frame", nil, list)
    row:SetPoint("TOPLEFT", 4, -8 - (i - 1) * ROW_H)
    row:SetSize(W - 8, ROW_H)
    for _, col in ipairs({ { "name", 4, 250 }, { "detail", 258, 180 }, { "done", 540, 50 } }) do
      local s = text(row, 11, NARROW)
      s:SetPoint("LEFT", col[2], 0)
      s:SetWidth(col[3])
      if s.SetWordWrap then s:SetWordWrap(false) end
      row[col[1]] = s
    end
    row.done:SetJustifyH("RIGHT")
    row.done:SetTextColor(unpack(COLORS.accent))
    local bar = CreateFrame("StatusBar", nil, row)
    bar:SetPoint("LEFT", 444, 0)
    bar:SetSize(90, 6)
    bar:SetStatusBarTexture("Interface\\TargetingFrame\\UI-StatusBar")
    bar:SetStatusBarColor(unpack(COLORS.accent))
    local back = bar:CreateTexture(nil, "BACKGROUND")
    back:SetAllPoints()
    back:SetColorTexture(0.133, 0.137, 0.114, 1)
    row.bar = bar
    rows[i] = row
  end
  rows.empty = text(list, 11, nil, COLORS.muted)
  rows.empty:SetPoint("TOPLEFT", 8, -12)
  rows.empty:SetWidth(W - 16)
  rows.up = button(list, "Up", 48, function() rows.offset = math.max(0, rows.offset - ROWS) end)
  rows.up:SetPoint("BOTTOMRIGHT", -58, 6)
  rows.down = button(list, "Down", 48, function() rows.offset = rows.offset + ROWS end)
  rows.down:SetPoint("BOTTOMRIGHT", -6, 6)
  c.rows = rows
end

U.Views.collection = { build = build, refresh = refresh }
