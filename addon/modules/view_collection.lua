-- Everloot window, Collection: achievements, reputation, titles, instances and quest chains, from the rows the
-- completion tracker (completion.lua) and owned.lua wrote, read through Everloot:Rows. This character by default;
-- Account joins every character in the roster (roster.lua) and names the one that holds each item.
-- Display only: it reads, the one button runs /everloot completion on, the command the player could type, and
-- nothing here records. It registers no events; the window builds it the first time Collection is opened.

local E = Everloot
if not (E.Window and E.Window.Views) then return end
local U = E.Window
local COLORS, NARROW, text, surface = U.COLORS, U.NARROW, U.Text, U.Surface

local W = 604          -- the view frame window.lua gives every view (W - MAIN - 12 wide)
local ROWS, ROW_H = 12, 18
local SECTIONS = { { "achievements", "Achievements" }, { "reputation", "Reputation" }, { "titles", "Titles" },
  { "raids", "Dungeons & raids" }, { "quests", "Quests" } }
local SCOPES = { { "character", "This character", 110 }, { "account", "Account", 80 } }
local EXALTED = 8
local OFF_TEXT = "The completion tracker reads your achievements, reputation, titles, completed quests, professions, raid "
  .. "lockouts, active talent build, character sheet stats and PvP standing, from the game's own windows, never writing "
  .. "back. Your boss kills stay on this computer. Collection rows leave only from the upload page; professions, lockouts, talents, stats and PvP never go in an upload."
local TURNED_ON = "Turned on. /reload to start reading."
local NOTHING_READ = "Nothing read yet. Open the achievements, reputation or titles window, then /reload."
local NO_CHAINS = "No quest chains read yet. They are read at login and each time you turn in a quest."
local NOTHING_MISSING = "Nothing missing here."
local NO_KEY = "This character cannot be identified yet."
local DETAIL_W, DETAIL_WIDE = 180, 276   -- the detail column, narrower beside a bar

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

-- What a scope covers: `keys`, this character first, then in the account scope every other character in the
-- roster; and, in the account scope only, `holder(key)`, the roster name a detail line ends with. Names come from
-- the roster, the player's own characters in their own saved file.
local function scopeFor(scope, me)
  local s = { keys = { me } }
  if scope ~= "account" or not (E.Roster and E.Roster.Rows) then return s end
  local ok, rows = pcall(E.Roster.Rows)
  local seen, names = { [me] = true }, {}
  for _, r in ipairs(ok and type(rows) == "table" and rows or {}) do
    if type(r) == "table" and type(r.key) == "string" then
      if type(r.name) == "string" and r.name ~= "" then names[r.key] = r.name end
      if not seen[r.key] then seen[r.key] = true; s.keys[#s.keys + 1] = r.key end
    end
  end
  s.holder = function(key) return names[key] or (key == me and "This character") or "Another character" end
  return s
end

-- A detail line, with the holder's name after it in the account scope.
local function held(detail, s, key)
  if not (s.holder and key) then return detail end
  return (detail ~= "" and (detail .. " · ") or "") .. s.holder(key)
end

-- Each key's rows of one owned kind, by the catalog id in `field`: [key][id] = row.
local function owned(kind, s, field)
  local out = {}
  for _, k in ipairs(s.keys) do out[k] = {} end
  for _, r in ipairs(E:Rows(kind)) do
    if type(r) == "table" and out[r.characterKey] and r[field] ~= nil then out[r.characterKey][r[field]] = r end
  end
  return out
end

-- Each key's ids from the list-of-ids rows of one kind (titles, completed quests): [key][id] = true.
local function known(kind, s, field)
  local out = {}
  for _, k in ipairs(s.keys) do out[k] = {} end
  for _, r in ipairs(E:Rows(kind)) do
    if type(r) == "table" and out[r.characterKey] and type(r[field]) == "table" then
      for _, id in ipairs(r[field]) do out[r.characterKey][id] = true end
    end
  end
  return out
end

-- Each section returns its items ({ name, detail, done, bar = { floor, ceiling, standing } }) and its summary line.
-- In the account scope an item is done when any key holds it; the first key in scope order that does is named.
local function achievements(s)
  local mine = owned("achievement_owned", s, "achievementId")
  local items, done, points = {}, 0, 0
  for _, a in ipairs(E:Rows("achievement_catalog")) do
    if type(a) == "table" then
      local o, holder
      for _, k in ipairs(s.keys) do
        local r = mine[k][a.achievementId]
        if r and r.completed == true then o, holder = r, k; break end
      end
      local pts = number(a.points) and a.points or nil
      local item = { name = name(a.name), detail = (pts or "-") .. " pts · " .. name(a.category), done = o ~= nil }
      if item.done then
        done, points = done + 1, points + (pts or 0)
        item.when = type(o.earnedOn) == "string" and o.earnedOn or nil
        if item.when then item.detail = item.detail .. " · " .. item.when end
        item.detail = held(item.detail, s, holder)
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

-- The higher standing of two rows: reaction first, then the points within it.
local function higher(a, b)
  if not b then return true end
  local ra, rb = number(a.reaction) and a.reaction or -1, number(b.reaction) and b.reaction or -1
  if ra ~= rb then return ra > rb end
  return (number(a.standing) and a.standing or -1) > (number(b.standing) and b.standing or -1)
end

-- In the account scope a faction shows the key with the highest standing.
local function reputation(s)
  local mine = owned("reputation_owned", s, "factionId")
  local items, exalted = {}, 0
  for _, r in ipairs(E:Rows("reputation_catalog")) do
    if type(r) == "table" and not r.major then
      local o, holder
      for _, k in ipairs(s.keys) do
        local row = mine[k][r.factionId]
        if row and higher(row, o) then o, holder = row, k end
      end
      local item = { name = name(r.name), detail = "-", done = false }
      if o and number(o.standing) and number(o.floor) and number(o.ceiling) then
        item.bar = { o.floor, o.ceiling, o.standing }
        item.detail = held(o.standing .. " / " .. o.ceiling, s, holder)
      end
      if o and number(o.reaction) and o.reaction >= EXALTED then item.done, exalted = true, exalted + 1 end
      items[#items + 1] = item
    end
  end
  table.sort(items, byName)
  return items, "Reputation: " .. #items .. (#items == 1 and " faction" or " factions") .. " · " .. exalted .. " exalted"
end

local function titles(s)
  local ids = known("title_owned", s, "titleIds")
  local items, n = {}, 0
  for _, t in ipairs(E:Rows("title_catalog")) do
    if type(t) == "table" then
      local holder
      for _, k in ipairs(s.keys) do
        if ids[k][t.titleId] then holder = k; break end
      end
      if holder then n = n + 1 end
      items[#items + 1] = { name = name(t.name), detail = holder and held("", s, holder) or "", done = holder ~= nil }
    end
  end
  table.sort(items, byName)
  return items, "Titles: " .. n .. " of " .. #items
end

-- The shipped player agreement gates instances; personal kills never change that public catalog.
local function raids(s)
  local data = E.InstanceData or { instances = {}, asOf = "unknown" }
  local now = date("!%Y-%m-%dT%H:%M:%SZ", time())
  local keys = {}
  for _, key in ipairs(s.keys) do keys[key] = true end
  local items = {}
  for _, group in ipairs({ "Dungeons", "Raids", "World bosses" }) do
    items[#items + 1] = { name = group, detail = group == "World bosses" and "Found in game files, unconfirmed" or "Agreed by players", done = false }
    local instances = {}
    for _, instance in ipairs(data.instances) do
      if instance.group == group then instances[#instances + 1] = instance end
    end
    table.sort(instances, byName)
    for _, instance in ipairs(instances) do
      items[#items + 1] = { name = instance.name, detail = instance.unconfirmed and "Unconfirmed" or "", done = false }
      for _, r in ipairs(E:Rows("lockout_owned")) do
        if keys[r.characterKey] and (r.instanceId == instance.id or r.instance == instance.name)
          and type(r.resetAt) == "string" and r.resetAt > now then
          local day, hour = r.resetAt:match("^(%d+%-%d+%-%d+)T(%d+:%d+)")
          items[#items + 1] = { name = "  This week's lockout", detail = held((r.bossesKilledCount or "-") .. " of " .. (r.bossesTotal or "-")
            .. " / resets " .. (day and (day .. " " .. hour .. " UTC") or r.resetAt), s, r.characterKey), done = false }
        end
      end
      for _, boss in ipairs(instance.bosses) do
        local kill
        -- The most recent kill across the scope gives both the date and the holder, including across difficulties.
        for _, r in ipairs(E:Rows("boss_kill_owned")) do
          if keys[r.characterKey] and r.instanceMapId == instance.id and r.encounterId == boss.id
            and type(r.lastKillAt) == "string" and (not kill or r.lastKillAt > kill.lastKillAt) then kill = r end
        end
        items[#items + 1] = { name = "  " .. boss.name, done = kill ~= nil,
          detail = kill and held("Last killed " .. kill.lastKillAt, s, kill.characterKey) or "No kill recorded" }
      end
    end
    if #instances == 0 then items[#items + 1] = { name = "No agreed instances yet", detail = "", done = false } end
  end
  return items, "Dungeons & raids / as of " .. data.asOf:sub(1, 10)
end

-- One row per chain the tracker read: its quests done of its total. In the account scope a chain shows the key
-- furthest along it; quests done on different characters are not added together. A chain the tracker cut at its
-- quest limit ("+") is never counted complete.
local function quests(s)
  local ids = known("quest_owned", s, "questIds")
  -- quest id -> the chains holding it, so each key's completed quests are walked once, not once per chain.
  local chains, byQuest = {}, {}
  for _, q in ipairs(E:Rows("quest_chain_catalog")) do
    if type(q) == "table" and type(q.questIds) == "table" and #q.questIds > 0 then
      chains[#chains + 1] = q
      local seen = {}
      for _, id in ipairs(q.questIds) do
        if not seen[id] then
          seen[id] = true
          local list = byQuest[id] or {}
          list[#list + 1] = #chains
          byQuest[id] = list
        end
      end
    end
  end
  local counts = {}
  for _, k in ipairs(s.keys) do
    local mine = {}
    for id in pairs(ids[k]) do
      for _, c in ipairs(byQuest[id] or {}) do mine[c] = (mine[c] or 0) + 1 end
    end
    counts[k] = mine
  end
  local items, complete = {}, 0
  for c, q in ipairs(chains) do
    do
      local total, most, holder = #q.questIds, 0, nil
      for _, k in ipairs(s.keys) do
        local n = counts[k][c] or 0
        if n > most then most, holder = n, k end
      end
      local item = { name = name(q.name), done = most >= total and not q.truncated, bar = { 0, total, most } }
      item.detail = held(most .. " of " .. total .. (q.truncated and "+" or ""), s, holder)
      if item.done then complete = complete + 1 end
      items[#items + 1] = item
    end
  end
  table.sort(items, byName)
  return items, "Quests: " .. complete .. " of " .. #items .. (#items == 1 and " chain" or " chains") .. " complete"
end

local READ = { achievements = achievements, reputation = reputation, titles = titles, raids = raids, quests = quests }
local EMPTY = { quests = NO_CHAINS }

local function draw(row, item)
  row.name:SetText(item.name)
  row.detail:SetText(item.detail)
  row.done:SetText(item.done and "done" or "")
  if item.bar then
    row.detail:SetWidth(DETAIL_W)
    row.bar:SetMinMaxValues(item.bar[1], item.bar[2])
    row.bar:SetValue(item.bar[3])
    row.bar:Show()
  else
    row.detail:SetWidth(DETAIL_WIDE)
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
  for _, s in ipairs(SCOPES) do lit(c.scopes[s[1]], s[1] == c.scope) end
  c.missingOnly:SetText(c.missing and "Show all" or "Missing only")
  local ok, key = pcall(E.CharacterKey)
  local items, summary, empty = {}, "", NO_KEY
  if ok and key then
    items, summary = READ[c.section](scopeFor(c.scope, key))
    empty = EMPTY[c.section] or NOTHING_READ
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
  local c = { section = "achievements", scope = "character", missing = false, sections = {}, scopes = {} }
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

  -- On: the sections and the missing-only switch at the top, the summary and the scope under them, then the list.
  c.onPage = CreateFrame("Frame", nil, parent)
  c.onPage:SetPoint("TOPLEFT", 0, 0)
  c.onPage:SetSize(W, 390)
  for i, s in ipairs(SECTIONS) do
    c.sections[s[1]] = button(c.onPage, s[2], s[1] == "raids" and 140 or 82, function() c.section = s[1]; c.rows.offset = 0 end)
    c.sections[s[1]]:SetPoint("TOPLEFT", (i - 1) * 86 + (i > 4 and 58 or 0), -8)
  end
  c.missingOnly = button(c.onPage, "Missing only", 100, function() c.missing = not c.missing; c.rows.offset = 0 end)
  c.missingOnly:SetPoint("TOPRIGHT", 0, -336)
  local right = 0
  for i = #SCOPES, 1, -1 do
    local s = SCOPES[i]
    c.scopes[s[1]] = button(c.onPage, s[2], s[3], function() c.scope = s[1]; c.rows.offset = 0 end)
    c.scopes[s[1]]:SetPoint("TOPRIGHT", -right, -36)
    right = right + s[3] + 4
  end
  c.summary = text(c.onPage, 13)
  c.summary:SetPoint("TOPLEFT", 4, -40)
  c.summary:SetWidth(W - 8 - right)

  local list = box(c.onPage, 0, -62, W, 260)
  local rows = { offset = 0 }
  for i = 1, ROWS do
    local row = CreateFrame("Frame", nil, list)
    row:SetPoint("TOPLEFT", 4, -8 - (i - 1) * ROW_H)
    row:SetSize(W - 8, ROW_H)
    for _, col in ipairs({ { "name", 4, 250 }, { "detail", 258, DETAIL_W }, { "done", 540, 50 } }) do
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
