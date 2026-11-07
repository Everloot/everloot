-- Everloot window, Professions: each profession in the character's profession book with its rank bar, how many recipes
-- the addon has recorded for it by difficulty colour (professions.lua writes them, read here through Everloot:Rows),
-- and the day they were last read. Display only: it registers no events and records nothing; the window builds it the
-- first time Professions is opened.

local E = Everloot
if not (E.Window and E.Window.Views) then return end
local U = E.Window
local COLORS, NARROW, text, surface = U.COLORS, U.NARROW, U.Text, U.Surface

local W = 604          -- the view frame window.lua gives every view (W - MAIN - 12 wide)
local BLOCKS, BLOCK_H, GAP = 5, 64, 4   -- the profession book has five slots
local BUCKETS = { optimal = "orange", medium = "yellow", easy = "green", trivial = "grey" }
local READ_IT = "Open the profession window to read its recipes."
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

local function draw(block, p)
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
end

function refresh(f)
  local p = f.professions
  local list = U.Professions()
  local empty = list == nil and NO_BOOK or (#list == 0 and NONE_LEARNED) or nil
  for i, block in ipairs(p.blocks) do
    local prof = list and list[i]
    if prof then draw(block, prof); block:Show() else block:Hide() end
  end
  if empty then p.empty:SetText(empty); p.empty:Show() else p.empty:Hide() end
end

local function build(f, parent)
  local p = { blocks = {} }
  f.professions = p
  for i = 1, BLOCKS do
    local b = CreateFrame("Frame", nil, parent)
    b:SetPoint("TOPLEFT", 0, -(i - 1) * (BLOCK_H + GAP))
    b:SetSize(W, BLOCK_H)
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
    b.recipes:SetPoint("TOPLEFT", 46, -30)
    b.recipes:SetWidth(W - 56)
    b.last = text(b, 11, NARROW, COLORS.muted)
    b.last:SetPoint("TOPLEFT", 46, -46)
    b.last:SetWidth(W - 56)
    p.blocks[i] = b
  end
  p.empty = text(parent, 12, nil, COLORS.muted)
  p.empty:SetPoint("TOPLEFT", 8, -12)
  p.empty:SetWidth(W - 16)
  p.footer = text(parent, 11, NARROW, COLORS.muted)
  -- At the bottom of the view, under the five blocks (5 x 68 = 340 of the view's 390).
  p.footer:SetPoint("BOTTOMLEFT", 8, 8)
  p.footer:SetWidth(W - 8)
  p.footer:SetText(FOOTER)
end

U.Views.professions = { build = build, refresh = refresh }
