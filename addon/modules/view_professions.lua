-- Everloot window, Professions: each profession in the character's profession book with its rank bar, how many recipes
-- the addon has recorded for it by difficulty colour (professions.lua writes them, read here through Everloot:Rows),
-- the day they were last read, and the next recipes a trainer teaches at or above the current rank, with the cost and
-- the trainer's name (trainer_seen rows, the name from the matching npc_sighting row). Under the blocks, every other
-- character in the roster (roster.lua) with its professions and ranks. Display only: it registers no events and
-- records nothing; the window builds it the first time Professions is opened.

local E = Everloot
if not (E.Window and E.Window.Views) then return end
local U = E.Window
local COLORS, NARROW, text, surface = U.COLORS, U.NARROW, U.Text, U.Surface

local W, H = 604, 390  -- the view frame window.lua gives every view (W - MAIN - 12 wide, H - 60 tall)
local BLOCKS, GAP = 5, 4           -- the profession book has five slots
local HEAD_H, LINE_H = 44, 13      -- a block: the name, bar and recipe line, then one line per trainer recipe
local TRAINER_LINES = 3            -- per block; two when four or five professions must share the view
local OTHER_ROWS = 6               -- the most characters the list under the blocks holds
local FOOTER_H = 24
local BUCKETS = { optimal = "orange", medium = "yellow", easy = "green", trivial = "grey" }
local READ_IT = "Open the profession window to read its recipes."
local NO_TRAINER = "Nothing from a trainer yet. Open a trainer's window."
local OTHERS = "Other characters"
local NO_OTHERS = "No other characters seen by this install yet."
local NO_BOOK = "No profession book in this client."
local NONE_LEARNED = "No professions learned yet."
local FOOTER = "Full planner: everloot.app/tools/profession-planner"
local FALLBACK_ICON = "Interface\\Icons\\INV_Misc_QuestionMark"

local refresh

-- What was recorded for one profession: how many recipes, each colour's count, and the newest read day. A recipe
-- whose colour changed has a row per colour (professions.lua), so only its newest row counts.
local function recorded(name)
  local latest = {}
  for _, r in ipairs(E:Rows("recipe_observed")) do
    if type(r) == "table" and r.profession == name then
      local id = r.recipeId ~= nil and r.recipeId or r.recipe
      local at = type(r.kindLoggedAt) == "string" and r.kindLoggedAt:match("^%d%d%d%d%-%d%d%-%d%d") or ""
      if id ~= nil then
        local seen = latest[id]
        if not seen or at >= seen.at then latest[id] = { at = at, difficulty = r.difficulty } end
      end
    end
  end
  local out = { n = 0, orange = 0, yellow = 0, green = 0, grey = 0 }
  for _, r in pairs(latest) do
    out.n = out.n + 1
    local bucket = BUCKETS[r.difficulty]
    if bucket then out[bucket] = out[bucket] + 1 end
    if r.at ~= "" and (not out.newest or r.at > out.newest) then out.newest = r.at end
  end
  return out
end

-- The trainer's name for an NPC id, from the newest npc_sighting row that has one.
local function trainerNames()
  local names = {}
  for _, r in ipairs(E:Rows("npc_sighting")) do
    if type(r) == "table" and r.npcId ~= nil and type(r.name) == "string" and r.name ~= "" then names[r.npcId] = r.name end
  end
  return names
end

-- The recipes a trainer teaches for one profession at or above the character's rank, lowest rank first, at most
-- `limit` of them. A recipe listed by two trainers at the same rank is one line.
local function nextFromTrainer(name, rank, limit, names)
  local rows, seen = {}, {}
  for _, r in ipairs(E:Rows("trainer_seen")) do
    if type(r) == "table" and r.profession == name and type(r.requiredRank) == "number" and r.requiredRank >= rank
      and type(r.recipe) == "string" then
      local key = r.recipe .. "|" .. r.requiredRank
      if not seen[key] then
        seen[key] = true
        rows[#rows + 1] = { rank = r.requiredRank, recipe = r.recipe, cost = r.costCopper, trainer = names[r.trainerNpcId] }
      end
    end
  end
  table.sort(rows, function(a, b)
    if a.rank ~= b.rank then return a.rank < b.rank end
    return a.recipe < b.recipe
  end)
  for i = #rows, limit + 1, -1 do rows[i] = nil end
  return rows
end

local function trainerLine(r)
  local s = "Rank " .. r.rank .. ": " .. r.recipe
  if type(r.cost) == "number" then s = s .. " · " .. U.MoneyShort(r.cost) end
  if r.trainer then s = s .. " · " .. r.trainer end
  return s
end

-- Draws one block and returns its height.
local function draw(block, p, lines, names)
  local got = recorded(p.name)
  block.name:SetText(p.name)
  block.icon:SetTexture(p.icon or FALLBACK_ICON)
  block.bar:SetMinMaxValues(0, p.maxRank or math.max(p.rank, 1))
  block.bar:SetValue(p.rank)
  block.rank:SetText(p.maxRank and (p.rank .. " / " .. p.maxRank) or tostring(p.rank))
  if got.n == 0 then
    block.recipes:SetText(READ_IT)
  else
    block.recipes:SetText(got.n .. (got.n == 1 and " recipe" or " recipes") .. " recorded: " .. got.orange .. " orange · "
      .. got.yellow .. " yellow · " .. got.green .. " green · " .. got.grey .. " grey")
  end
  if got.n > 0 and got.newest then
    block.last:SetText("Last read: " .. got.newest)
    block.last:Show()
  else
    block.last:Hide()
  end
  local rows = nextFromTrainer(p.name, p.rank, lines, names)
  for i, line in ipairs(block.trainer) do
    if rows[i] then
      line:SetText(trainerLine(rows[i]))
      line:Show()
    elseif i == 1 then
      line:SetText(NO_TRAINER)
      line:Show()
    else
      line:Hide()
    end
  end
  local height = HEAD_H + LINE_H * math.max(#rows, 1)
  block:SetSize(W, height)
  return height
end

local function professionText(list)
  local parts = {}
  for _, prof in ipairs(type(list) == "table" and list or {}) do
    if type(prof) == "table" and type(prof.name) == "string" then
      parts[#parts + 1] = prof.name .. (type(prof.rank) == "number" and (" " .. prof.rank) or "")
    end
  end
  return #parts > 0 and table.concat(parts, ", ") or "no professions read yet"
end

-- The other characters' professions under the blocks, as many rows as fit above the footer; hidden when none fits.
local function drawOthers(p, y)
  local me = E.Roster and E.Roster.Current and E.Roster.Current() or nil
  local rows = {}
  for _, c in ipairs(E.Roster and E.Roster.Rows and E.Roster.Rows() or {}) do
    if c.key ~= me and type(c.name) == "string" then
      rows[#rows + 1] = c.name .. (type(c.realm) == "string" and (" · " .. c.realm) or "") .. ": " .. professionText(c.professions)
    end
  end
  local room = math.floor((H - FOOTER_H - y - LINE_H) / LINE_H)
  if room < 1 then
    p.others:Hide()
    for _, line in ipairs(p.other) do line:Hide() end
    return
  end
  p.others:SetPoint("TOPLEFT", 8, -y)
  p.others:Show()
  for i, line in ipairs(p.other) do
    if i == 1 and #rows == 0 then
      line:SetText(NO_OTHERS); line:Show()
    elseif rows[i] and i <= room then
      line:SetText(rows[i]); line:Show()
    else
      line:Hide()
    end
  end
end

function refresh(f)
  local p = f.professions
  local list = U.Professions()
  local empty = list == nil and NO_BOOK or (#list == 0 and NONE_LEARNED) or nil
  local lines = list and #list > 3 and TRAINER_LINES - 1 or TRAINER_LINES
  local names = trainerNames()
  local y = 0
  for i, block in ipairs(p.blocks) do
    local prof = list and list[i]
    if prof then
      block:SetPoint("TOPLEFT", 0, -y)
      y = y + draw(block, prof, lines, names) + GAP
      block:Show()
    else
      block:Hide()
    end
  end
  if empty then p.empty:SetText(empty); p.empty:Show() else p.empty:Hide() end
  drawOthers(p, empty and 32 or y + 4)
end

local function build(f, parent)
  local p = { blocks = {} }
  f.professions = p
  for i = 1, BLOCKS do
    local b = CreateFrame("Frame", nil, parent)
    b:SetPoint("TOPLEFT", 0, -(i - 1) * (HEAD_H + LINE_H + GAP))
    b:SetSize(W, HEAD_H + LINE_H)
    surface(b)
    b.icon = b:CreateTexture(nil, "ARTWORK")
    b.icon:SetSize(28, 28)
    b.icon:SetPoint("TOPLEFT", 10, -8)
    b.icon:SetTexCoord(0.08, 0.92, 0.08, 0.92)
    b.name = text(b, 14)
    b.name:SetPoint("TOPLEFT", 46, -8)
    b.name:SetWidth(200)
    b.bar = CreateFrame("StatusBar", nil, b)
    b.bar:SetPoint("TOPLEFT", 250, -13)
    b.bar:SetSize(250, 8)
    b.bar:SetStatusBarTexture("Interface\\TargetingFrame\\UI-StatusBar")
    b.bar:SetStatusBarColor(unpack(COLORS.accent))
    local back = b.bar:CreateTexture(nil, "BACKGROUND")
    back:SetAllPoints()
    back:SetColorTexture(0.133, 0.137, 0.114, 1)
    b.rank = text(b, 12, NARROW)
    b.rank:SetPoint("TOPRIGHT", -10, -10)
    b.rank:SetJustifyH("RIGHT")
    b.recipes = text(b, 11, NARROW, COLORS.muted)
    b.recipes:SetPoint("TOPLEFT", 46, -28)
    b.recipes:SetWidth(W - 236)
    b.last = text(b, 11, NARROW, COLORS.muted)
    b.last:SetPoint("TOPRIGHT", -10, -28)
    b.last:SetWidth(170)
    b.last:SetJustifyH("RIGHT")
    b.trainer = {}
    for j = 1, TRAINER_LINES do
      local line = text(b, 11, NARROW, COLORS.muted)
      line:SetPoint("TOPLEFT", 46, -(HEAD_H + (j - 1) * LINE_H))
      line:SetWidth(W - 56)
      b.trainer[j] = line
    end
    p.blocks[i] = b
  end
  p.empty = text(parent, 12, nil, COLORS.muted)
  p.empty:SetPoint("TOPLEFT", 8, -12)
  p.empty:SetWidth(W - 16)
  p.others = text(parent, 12)
  p.others:SetPoint("TOPLEFT", 8, -8)
  p.others:SetWidth(W - 16)
  p.others:SetText(OTHERS)
  p.other = {}
  for i = 1, OTHER_ROWS do
    local line = text(parent, 11, NARROW, COLORS.muted)
    line:SetPoint("TOPLEFT", p.others, "BOTTOMLEFT", 0, -(i - 1) * LINE_H - 2)
    line:SetWidth(W - 16)
    p.other[i] = line
  end
  p.footer = text(parent, 11, NARROW, COLORS.muted)
  -- At the bottom of the view, under the blocks and the other characters.
  p.footer:SetPoint("BOTTOMLEFT", 8, 8)
  p.footer:SetWidth(W - 8)
  p.footer:SetText(FOOTER)
end

U.Views.professions = { build = build, refresh = refresh }
