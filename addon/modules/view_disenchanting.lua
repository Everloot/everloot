-- This character's local disenchant history, valued at current house prices. Display only.
local E = Everloot
if not (E.Window and E.Window.Views) then return end
local U, D = E.Window, E.Disenchant
local ROWS = 17

local function plural(n, word) return n .. " " .. word .. (n == 1 and "" or "s") end

local function estimate(value, missing)
  return (missing and "at least " or "") .. U.Money(value)
end

local function contents()
  local lines = {}
  local function add(s) lines[#lines + 1] = s end
  if #D.History() == 0 then
    add("Disenchant an item with Everloot on to start your local history.")
    add("This character's last 500 disenchants stay in this file; never uploaded.")
    return lines
  end
  local today = time() - time() % 86400
  add((E:MarketHouse() or "Unknown") .. " house · current gross estimates, before fees; no sale guaranteed")
  for _, period in ipairs({ { "Today (UTC)", today }, { "Last 7 days", time() - 7 * 86400 } }) do
    local s = D.Summary(period[2])
    add(period[1] .. ": " .. plural(s.count, "disenchant") .. " · estimated value " .. estimate(s.value, s.missing))
    if s.known == s.count and s.count > 0 then
      add("  Cost (average paid): " .. U.Money(s.cost) .. " · estimated difference " .. estimate(s.value - s.cost, s.missing))
    else
      add("  Known cost: " .. U.Money(s.cost) .. " for " .. s.known .. "/" .. s.count .. " · difference unknown")
    end
    local ids = {}
    for id in pairs(s.mats) do ids[#ids + 1] = id end
    table.sort(ids)
    for _, id in ipairs(ids) do add("  " .. D.Label(id) .. " × " .. s.mats[id]) end
    if #ids == 0 then add("  No materials recorded in this period.") end
  end
  add("Recent disenchants · saved average paid is a cost estimate")
  local log = D.History()
  for i = #log, 1, -1 do
    local row = log[i]
    local value, missing = D.Value(E.CurrentRealm(), row.mats)
    add(date("!%m-%d %H:%M", row.t) .. " " .. D.Label(row.item) .. " · estimated " .. estimate(value, missing))
    add(row.cost and ("  Cost " .. U.Money(row.cost) .. " · estimated difference " .. estimate(value - row.cost, missing)) or "  Cost and difference unknown")
    local ids = {}
    for id in pairs(row.mats) do ids[#ids + 1] = id end
    table.sort(ids)
    for _, id in ipairs(ids) do add("  " .. D.Label(id) .. " × " .. row.mats[id]) end
  end
  return lines
end

local function refresh(f)
  local p = f.disenchanting
  local lines = contents()
  p.offset = math.min(p.offset, math.max(0, #lines - ROWS))
  for i, row in ipairs(p.lines) do
    row:SetText(lines[p.offset + i] or "")
  end
  p.page:SetText((p.offset + 1) .. "-" .. math.min(#lines, p.offset + ROWS) .. " / " .. #lines)
end

local function build(f, parent)
  local p = { offset = 0, lines = {} }
  f.disenchanting = p
  for i = 1, ROWS do
    local row = U.Text(parent, 11, nil, U.COLORS.text)
    row:SetPoint("TOPLEFT", 4, -8 - (i - 1) * 20)
    row:SetWidth(590)
    if row.SetWordWrap then row:SetWordWrap(false) end
    p.lines[i] = row
  end
  for i, button in ipairs({ { "Up", -ROWS }, { "Down", ROWS } }) do
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetSize(60, 22)
    b:SetPoint("BOTTOMRIGHT", -((2 - i) * 64), 4)
    b:SetText(button[1])
    b:SetScript("OnClick", function()
      p.offset = math.max(0, p.offset + button[2])
      refresh(f)
    end)
  end
  p.page = U.Text(parent, 11, nil, U.COLORS.muted)
  p.page:SetPoint("BOTTOMLEFT", 4, 10)
end

U.Views.disenchanting = { build = build, refresh = refresh }
