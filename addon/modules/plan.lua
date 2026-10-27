-- Everloot talent plan: loads an Everloot share code and shows it next to the talent window.
-- DISPLAY ONLY. With the plan's point order it names the next point of that order; without one it lists
-- the points the game shows as open, unranked. It also lists where your build differs from the plan.
-- It never spends a point, clicks a talent, imports a loadout or acts for the player.
--
-- Share code (documented in addon/README.md and docs/2026-10-17-talent-share-code.md):
--   EL1-<class>-<spec>-<build>-<payload>
--   class    lowercase class token, e.g. mage
--   spec     client spec id, or 0 when unknown
--   build    client build the plan was made on, e.g. 1.60.1.70450
--   payload  base64url (no padding) of the text "node:rank,node:rank:choice,...", the nodes in any
--            order (the site writes ascending ids). The order of the items is not a spend order.
-- Point order, a token of its own next to the code (same doc, "Spend order"):
--   O1<mode>-<sequence>
--   mode     p: planned in the talent calculator; g: provisional, made by a tool
--   sequence one base64url character per point, in spend order, each the index of a node among the
--            code's nodes with points, by ascending node id

local E = Everloot
local T = E.Talents
local P = {}
E.Plan = P

local VERSION = 1
local MAX_ENTRIES = 600
local ORDER_VERSION = 1
local ORDER_LIMIT = 64
local ORIGIN = { p = "planned", g = "provisional" }

local B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
local B64URL_VALUE = {}
for i = 1, #B64URL do B64URL_VALUE[B64URL:sub(i, i)] = i - 1 end

-- Whitespace around an order token: exactly the code points ECMAScript's String.prototype.trim removes, as
-- the share-code doc lists them, matched as UTF-8 bytes. Lua's %s knows only the ASCII ones.
local SPACES = { "\t", "\n", "\v", "\f", "\r", " ", "\194\160", "\225\154\128", "\226\128\168", "\226\128\169",
  "\226\128\175", "\226\129\159", "\227\128\128", "\239\187\191" }
for byte = 128, 138 do SPACES[#SPACES + 1] = "\226\128" .. string.char(byte) end -- U+2000 to U+200A

--- The byte length of the whitespace that starts at first (or, from the back, ends at last), if any.
local function spaceAt(text, first, last, back)
  for _, space in ipairs(SPACES) do
    local from = back and last - #space + 1 or first
    if from >= first and from + #space - 1 <= last and text:sub(from, from + #space - 1) == space then return #space end
  end
end

local function trim(text)
  local first, last = 1, #text
  while first <= last do
    local width = spaceAt(text, first, last, false)
    if not width then break end
    first = first + width
  end
  while first <= last do
    local width = spaceAt(text, first, last, true)
    if not width then break end
    last = last - width
  end
  return text:sub(first, last)
end

local function encode64(text)
  local out = {}
  for i = 1, #text, 3 do
    local a, b, c = text:byte(i, i + 2)
    local n = a * 65536 + (b or 0) * 256 + (c or 0)
    local chars = { math.floor(n / 262144) % 64, math.floor(n / 4096) % 64, math.floor(n / 64) % 64, n % 64 }
    local keep = c and 4 or (b and 3 or 2)
    for k = 1, keep do out[#out + 1] = B64URL:sub(chars[k] + 1, chars[k] + 1) end
  end
  return table.concat(out)
end

local function decode64(text)
  if #text % 4 == 1 then return nil end
  local out = {}
  for i = 1, #text, 4 do
    local n, count = 0, 0
    for k = i, math.min(i + 3, #text) do
      local value = B64URL_VALUE[text:sub(k, k)]
      if not value then return nil end
      n = n * 64 + value
      count = count + 1
    end
    for _ = count + 1, 4 do n = n * 64 end
    local bytes = { math.floor(n / 65536) % 256, math.floor(n / 256) % 256, n % 256 }
    for k = 1, count - 1 do out[#out + 1] = string.char(bytes[k]) end
  end
  return table.concat(out)
end

--- Encode { class, spec, build, entries = { { nodeId, rank, choice? } } } as a share code.
function P.Encode(plan)
  local parts = {}
  for _, entry in ipairs(plan.entries) do
    local text = entry.nodeId .. ":" .. entry.rank
    if entry.choice then text = text .. ":" .. entry.choice end
    parts[#parts + 1] = text
  end
  return string.format("EL%d-%s-%d-%s-%s", VERSION, plan.class:lower(), plan.spec or 0, plan.build, encode64(table.concat(parts, ",")))
end

--- Decode a share code: plan table, or nil and the reason.
function P.Decode(code)
  if type(code) ~= "string" then return nil, "no code" end
  -- Padding is not part of the format, but a tool that adds it should not break the code.
  code = code:gsub("^%s+", ""):gsub("%s+$", ""):gsub("=+$", "")
  local version, class, spec, build, payload = code:match("^EL(%d+)%-(%a+)%-(%d+)%-([%d%.]+)%-([%w_%-]*)$")
  -- Same shape as the intake schema's build: digits in dot-separated groups, at least two.
  if build and not (build:find("^%d+%.[%d%.]*%d$") and not build:find("%.%.")) then version = nil end
  if not version then return nil, "that is not an Everloot share code (EL1-class-spec-build-payload)" end
  if tonumber(version) ~= VERSION then return nil, "share code version " .. version .. " is not supported by this addon (it reads version " .. VERSION .. ")" end
  local text = decode64(payload)
  if not text then return nil, "the plan part of the code is damaged" end
  local entries = {}
  local seen = {}
  for item in text:gmatch("[^,]+") do
    local node, rank, choice = item:match("^(%d+):(%d+):?(%d*)$")
    node, rank = tonumber(node), tonumber(rank)
    if not node or node < 1 or not rank or rank < 1 or rank > 50 then return nil, "the plan part of the code is damaged" end
    local pick = choice ~= "" and tonumber(choice) or nil
    if pick and pick > 3 then return nil, "the plan part of the code is damaged" end
    if seen[node] then return nil, "the plan lists node " .. node .. " twice" end
    seen[node] = true
    entries[#entries + 1] = { nodeId = node, rank = rank, choice = pick }
    if #entries > MAX_ENTRIES then return nil, "the plan has too many nodes" end
  end
  if #entries == 0 then return nil, "the plan has no talents in it" end
  return { version = VERSION, class = class:upper(), spec = tonumber(spec), build = build, entries = entries }
end

--- Read a point order token against the plan it came with. Returns { origin, order }, order being node ids
--- one per point in spend order, or nil and the error the share-code doc names, the first that applies of
--- newer-version, malformed, unsupported-mode, over-limit, extra-points and missing-points. A known order
--- only means its points are the plan's; whether each could be spent at its place is not checked here.
function P.DecodeOrder(token, plan)
  if type(token) ~= "string" then return nil, "malformed" end
  token = trim(token)
  local version = token:match("^O([1-9]%d*)")
  if not version then return nil, "malformed" end
  -- A newer token may change everything after its version: say so rather than guess.
  if tonumber(version) > ORDER_VERSION then return nil, "newer-version" end
  local mode, sequence = token:sub(#version + 2):match("^([a-z])%-([A-Za-z0-9_%-]+)$")
  if not mode then return nil, "malformed" end
  local origin = ORIGIN[mode]
  if not origin then return nil, "unsupported-mode" end
  local nodes, left, total = {}, {}, 0
  for _, entry in ipairs(plan and plan.entries or {}) do
    if entry.rank > 0 then
      nodes[#nodes + 1] = entry.nodeId
      left[entry.nodeId] = entry.rank
      total = total + entry.rank
    end
  end
  if #sequence > ORDER_LIMIT or total > ORDER_LIMIT then return nil, "over-limit" end
  table.sort(nodes)
  local order = {}
  for i = 1, #sequence do
    local nodeId = nodes[B64URL_VALUE[sequence:sub(i, i)] + 1]
    if not nodeId or left[nodeId] == 0 then return nil, "extra-points" end
    left[nodeId] = left[nodeId] - 1
    order[i] = nodeId
  end
  if #order < total then return nil, "missing-points" end
  return { origin = origin, order = order }
end

--- The codes and orders a link's #fragment carries, read as the site reads them: each value is the run of
--- letters, digits, _ . and - after its key, and a key that is missing is nil. An order belongs only with
--- its own set's code (order with plan, order2 with plan2); a link may carry one whose set has no code.
function P.ReadLink(text)
  local fragment = type(text) == "string" and text:match("#.*$") or ""
  local function value(key) return fragment:match("[#&]" .. key .. "=([A-Za-z0-9_%.%-]+)") end
  return { first = value("plan"), second = value("plan2"), firstOrder = value("order"), secondOrder = value("order2") }
end

--- The #fragment for these codes and orders, as the site writes it: the codes first, so a reader that stops
--- at & still finds them, then the order of each set that has a code. Empty without a code.
function P.Fragment(first, second, firstOrder, secondOrder)
  local parts = {}
  if first then parts[#parts + 1] = "plan=" .. first end
  if second then parts[#parts + 1] = "plan2=" .. second end
  if first and firstOrder then parts[#parts + 1] = "order=" .. firstOrder end
  if second and secondOrder then parts[#parts + 1] = "order2=" .. secondOrder end
  return #parts > 0 and "#" .. table.concat(parts, "&") or ""
end

--- Compare a plan with the client's current state (T.State). Pure: no game calls. order is what
--- P.DecodeOrder read for this plan, or nil: only an order names a next point, and never skips past it.
--- Returns { total, done, mismatches = { { kind, nodeId, have, want } } } and, with an order, origin, steps,
--- next = { entry, step, blocked, unsure, missing } until the order is done, and ahead, the points spent
--- that the order places after next; without one, open, the plan's entries the game shows as buyable now
--- (unranked), and waiting, how many more are short of their rank.
function P.Evaluate(plan, state, order)
  local result = { total = 0, done = 0, mismatches = {} }
  local planned = {}
  local deficits = {}
  for _, entry in ipairs(plan.entries) do
    planned[entry.nodeId] = entry
    result.total = result.total + entry.rank
    local node = state.nodes[entry.nodeId]
    if not node then
      result.mismatches[#result.mismatches + 1] = { kind = "unknown", nodeId = entry.nodeId, want = entry.rank }
    else
      result.done = result.done + math.min(node.ranks, entry.rank)
      if node.ranks > entry.rank then
        result.mismatches[#result.mismatches + 1] = { kind = "extra", nodeId = entry.nodeId, have = node.ranks, want = entry.rank }
      elseif node.ranks > 0 and entry.choice ~= nil and node.choice ~= nil and node.choice ~= entry.choice then
        result.mismatches[#result.mismatches + 1] = { kind = "choice", nodeId = entry.nodeId, have = node.choice, want = entry.choice }
      elseif node.ranks < entry.rank then
        deficits[#deficits + 1] = { entry = entry, node = node }
      end
    end
  end
  for _, nodeId in ipairs(state.order) do
    local node = state.nodes[nodeId]
    if not planned[nodeId] and node.ranks > 0 then
      result.mismatches[#result.mismatches + 1] = { kind = "extra", nodeId = nodeId, have = node.ranks, want = 0 }
    end
  end
  if order then
    result.origin, result.steps, result.ahead = order.origin, #order.order, 0
    local used = {}
    for step, nodeId in ipairs(order.order) do
      local node = state.nodes[nodeId]
      local spent = used[nodeId] or 0
      if node and spent < node.ranks then
        used[nodeId] = spent + 1
      else
        result.next = { entry = planned[nodeId], step = step, missing = node == nil,
          blocked = node == nil or node.canBuy == false, unsure = node ~= nil and node.canBuy == nil }
        -- Every point before this step is spent, so any other spent point of the plan is ahead of the order.
        result.ahead = result.done - (step - 1)
        break
      end
    end
  else
    result.open, result.waiting = {}, 0
    for _, d in ipairs(deficits) do
      if d.node.canBuy == true then result.open[#result.open + 1] = d.entry else result.waiting = result.waiting + 1 end
    end
  end
  return result
end

local function spellName(configID, nodeId, state, choice)
  local node = state and state.nodes[nodeId]
  local entries = node and node.entryIDs
  local entryId = type(entries) == "table" and (entries[(choice or 0) + 1] or entries[1]) or nil
  local name
  if entryId and C_Traits and T.Call then
    local entry = T.Call(C_Traits.GetEntryInfo, configID, entryId)
    local definition = type(entry) == "table" and entry.definitionID and T.Call(C_Traits.GetDefinitionInfo, entry.definitionID)
    local spellId = type(definition) == "table" and definition.spellID
    if spellId then
      if C_Spell and C_Spell.GetSpellName then name = T.Call(C_Spell.GetSpellName, spellId)
      elseif GetSpellInfo then name = T.Call(GetSpellInfo, spellId) end
    end
  end
  if type(name) == "string" and name ~= "" then return name end
  return "node " .. nodeId
end

---------------------------------------------------------------- saved builds (EverlootBuilds slot addon)

-- The Desktop App writes the player's saved builds from everloot.app into the EverlootBuilds slot addon,
-- which sets EverlootBuildsData = { version, syncedAt, builds = { { name, character, realm, class, code,
-- code2, active, gameBuild } } }. Read only, at command time; nothing is saved or sent from here.

local function savedData()
  local data = EverlootBuildsData
  if type(data) == "table" and type(data.builds) == "table" then return data end
  return nil
end

--- Chat-safe: one line, and a typed | cannot start a WoW escape sequence.
local function plain(text)
  return (text:gsub("[%z\1-\31\127]", " "):gsub("|", "||"))
end

--- Lower case for comparing names: ASCII, plus the Latin-1 capitals typed as UTF-8 (À to Þ, not ×),
--- which string.lower leaves alone.
local function fold(text)
  -- Byte ranges, not string.lower or %u: those follow the C locale, which may fold single high bytes.
  return (text:gsub("[A-Z]", function(c) return string.char(c:byte() + 32) end):gsub("\195([\128-\158])", function(c)
    if c ~= "\151" then return "\195" .. string.char(c:byte() + 32) end
  end))
end
P.Fold = fold

--- The player's realm, folded with its spaces taken out; nil when the client does not say.
local function realmKey(realm)
  if type(realm) ~= "string" or realm == "" then return nil end
  return (fold(realm):gsub("[ \t]", ""))
end

--- The saved builds for this player, in the order /everloot plan numbers them: those filed under this
--- character (name, case-insensitive; the label's realm too when it has one) and class, the active one
--- first, then the class's other builds.
--- Nil when the EverlootBuilds addon is not loaded.
function P.SavedBuilds()
  local data = savedData()
  if not data then return nil end
  local class = T.Player()
  local me
  if UnitName then
    local ok, name = pcall(UnitName, "player")
    if ok and type(name) == "string" and name ~= "" then me = fold(name) end
  end
  local here
  if GetRealmName then
    local ok, realm = pcall(GetRealmName)
    if ok then here = realmKey(realm) end
  end
  local active, mine, others = {}, {}, {}
  for _, b in ipairs(data.builds) do
    if type(b) == "table" and type(b.name) == "string" and type(b.code) == "string" and type(b.class) == "string" then
      if not class or b.class:gsub("%A", ""):upper() == class then
        local realmOk = b.realm == nil or (here ~= nil and realmKey(b.realm) == here)
        if me and type(b.character) == "string" and fold(b.character) == me and realmOk then
          table.insert(b.active == true and active or mine, b)
        else
          others[#others + 1] = b
        end
      end
    end
  end
  for _, b in ipairs(mine) do active[#active + 1] = b end
  for _, b in ipairs(others) do active[#active + 1] = b end
  return active
end

--- Print the numbered list. Returns false when there is no EverlootBuilds data.
function P.ListSaved()
  local list = P.SavedBuilds()
  if not list then return false end
  if #list == 0 then
    print("Everloot: no saved builds for this class in the last Desktop App sync.")
    return true
  end
  print("Everloot: your saved builds (/everloot plan <number> loads one, <number> 2 its second set):")
  for i, b in ipairs(list) do
    if i > 20 then print("  and " .. (#list - 20) .. " more, up to /everloot plan " .. #list); break end
    local who = type(b.character) == "string" and (" - " .. plain(b.character)) or ""
    print(string.format("  %d. %s%s%s%s", i, plain(b.name), who, b.active == true and " (active)" or "",
      type(b.code2) == "string" and " [2 sets]" or ""))
  end
  return true
end

local current       -- the loaded plan
local currentOrder  -- what P.DecodeOrder read for it, or nil
local orderProblem  -- why the order that came with it is unknown, or nil
local last          -- { configID, state, result } from the latest refresh

local ORDER_PROBLEMS = {
  malformed = "the order is damaged",
  ["newer-version"] = "a newer version of Everloot made it",
  ["unsupported-mode"] = "it is a kind of order this addon does not read",
  ["over-limit"] = "it is for more than " .. ORDER_LIMIT .. " points, the most an order carries",
  ["extra-points"] = "it lists points the plan does not have",
  ["missing-points"] = "it leaves out points the plan has",
}

--- One line on the loaded plan's point order: who made it, or why there is none to follow.
function P.OrderLine()
  if currentOrder then
    return currentOrder.origin == "planned" and "Point order: planned in the talent calculator, not recorded play."
      or "Point order: provisional, made by a tool, not a recommendation or recorded play."
  end
  if orderProblem then return "Point order unknown: " .. ORDER_PROBLEMS[orderProblem] .. ", so no next point is ranked." end
  return "Point order unavailable: none came with this plan, so no next point is ranked."
end

--- The text lines shown in the panel and printed to chat.
local function lines()
  if not current then
    return { "No plan loaded. Paste an Everloot share code below, or /everloot plan <code>.",
      savedData() and "/everloot plan lists your saved builds; /everloot plan <number> loads one."
        or "Builds saved on everloot.app show here after a Desktop App sync and /reload." }
  end
  local out = {}
  local here = EverlootDB and EverlootDB.clientBuild
  out[#out + 1] = string.format("%s plan, made on build %s", current.class, current.build)
  if here and here ~= current.build then
    out[#out + 1] = "You are on build " .. here .. ": node ids may have moved since this plan was made."
  end
  out[#out + 1] = P.OrderLine()
  if not last then
    out[#out + 1] = "Open the talent window, or wait: your talents have not been read yet."
    return out
  end
  local r, state, configID = last.result, last.state, last.configID
  out[#out + 1] = string.format("%d of %d planned points match.", r.done, r.total)
  local function point(entry)
    local node = state.nodes[entry.nodeId]
    return string.format("%s (rank %d of %d)", spellName(configID, entry.nodeId, state, entry.choice), (node and node.ranks or 0) + 1, entry.rank)
  end
  if r.next then
    out[#out + 1] = string.format("Next point: %s, point %d of %d in the %s order%s", point(r.next.entry), r.next.step, r.steps, r.origin,
      r.next.missing and " - not in your talent tree (plan from another build?)"
        or r.next.blocked and " - not available yet (a gate or no point to spend)"
        or r.next.unsure and " - the game does not say whether it is available yet" or "")
    if r.ahead > 0 then
      out[#out + 1] = string.format("Your build is off this order: you have %d %s it spends later.", r.ahead, r.ahead == 1 and "point" or "points")
    end
  elseif r.open and #r.open > 0 then
    -- Sorted by name, so the list cannot read as a sequence.
    local open = {}
    for i, entry in ipairs(r.open) do open[i] = point(entry) end
    table.sort(open)
    if #open > 8 then
      local more = #open - 8
      for i = #open, 9, -1 do open[i] = nil end
      open[9] = "and " .. more .. " more"
    end
    out[#out + 1] = "Points you can spend now, in no order: " .. table.concat(open, ", ")
  elseif r.open and r.waiting > 0 then
    out[#out + 1] = "The game shows none of the plan's remaining points as available now."
  end
  if r.total > 0 and r.done == r.total and #r.mismatches == 0 then
    out[#out + 1] = "Your build matches the plan."
  end
  if #r.mismatches > 0 then
    out[#out + 1] = string.format("Differences from the plan (%d):", #r.mismatches)
    for i, m in ipairs(r.mismatches) do
      if i > 8 then out[#out + 1] = "  and " .. (#r.mismatches - 8) .. " more"; break end
      if m.kind == "unknown" then
        out[#out + 1] = "  node " .. m.nodeId .. " is not in your talent tree (plan from another build?)"
      elseif m.kind == "choice" then
        out[#out + 1] = string.format("  %s: you chose option %d, the plan says %d", spellName(configID, m.nodeId, state, m.have), m.have + 1, m.want + 1)
      else
        out[#out + 1] = string.format("  %s: you have %d, the plan has %d", spellName(configID, m.nodeId, state), m.have, m.want)
      end
    end
  end
  return out
end
P.Lines = lines

---------------------------------------------------------------- panel (all guarded)

local panel
local nextMark
local flagMarks = {}
local userHidden = false

--- A talent button in Blizzard's window, if it is open. Looked up only; never clicked.
local function buttonFor(nodeId)
  local talents = PlayerSpellsFrame and PlayerSpellsFrame.TalentsFrame
  if not (talents and type(talents.GetTalentButtonByNodeID) == "function") then return nil end
  if type(talents.IsShown) == "function" and not talents:IsShown() then return nil end
  local ok, button = pcall(talents.GetTalentButtonByNodeID, talents, nodeId)
  if ok and type(button) == "table" then return button end
  return nil
end

--- A click-through coloured overlay on a talent button.
local function overlay(slot, button, r, g, b)
  local mark = slot
  if not mark then
    mark = CreateFrame("Frame", nil, UIParent)
    mark:SetFrameStrata("HIGH")
    mark:EnableMouse(false)
    mark.texture = mark:CreateTexture(nil, "OVERLAY")
    mark.texture:SetAllPoints(mark)
    mark.texture:SetColorTexture(r, g, b, 0.4)
  end
  -- A child of the talent button, so it goes away with the button when the window closes or the tab changes.
  mark:SetParent(button)
  mark:SetFrameStrata("HIGH")
  mark:ClearAllPoints()
  mark:SetAllPoints(button)
  mark:Show()
  return mark
end

local function clearMarks()
  if nextMark then nextMark:Hide() end
  for _, mark in ipairs(flagMarks) do mark:Hide() end
end
P.HideMarks = clearMarks

local function workspaceVisible()
  local workspace = E.Planner
  return workspace and workspace.tab == "talents" and workspace.frame and workspace.frame:IsShown()
end

local function mark()
  clearMarks()
  if not (current and last) then return end
  local r = last.result
  if r.next and not r.next.blocked then
    local button = buttonFor(r.next.entry.nodeId)
    if button then nextMark = overlay(nextMark, button, 0.2, 1, 0.2) end
  end
  local used = 0
  for _, m in ipairs(r.mismatches) do
    local button = m.kind ~= "unknown" and buttonFor(m.nodeId)
    if button and used < 12 then
      used = used + 1
      flagMarks[used] = overlay(flagMarks[used], button, 1, 0.2, 0.2)
    end
  end
end

local function buildPanel()
  if panel then return panel end
  if not CreateFrame then return nil end
  local ok, frame = pcall(CreateFrame, "Frame", "EverlootPlanFrame", UIParent, "BackdropTemplate")
  if not ok or not frame then ok, frame = pcall(CreateFrame, "Frame", "EverlootPlanFrame", UIParent) end
  if not ok or not frame then return nil end
  local built = pcall(function()
    frame:SetSize(330, 280)
    frame:SetPoint("CENTER")
    frame:SetMovable(true)
    frame:EnableMouse(true)
    frame:SetClampedToScreen(true)
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", frame.StartMoving)
    frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
    if frame.SetBackdrop then
      frame:SetBackdrop({ bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background", edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
        tile = true, tileSize = 16, edgeSize = 16, insets = { left = 4, right = 4, top = 4, bottom = 4 } })
    end
    local title = frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    title:SetPoint("TOPLEFT", 14, -12)
    title:SetText("Everloot talent plan (display only)")
    frame.body = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    frame.body:SetPoint("TOPLEFT", 14, -34)
    frame.body:SetWidth(300)
    frame.body:SetJustifyH("LEFT")
    frame.body:SetJustifyV("TOP")
    local close = CreateFrame("Button", nil, frame, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", -2, -2)
    local box = CreateFrame("EditBox", nil, frame, "InputBoxTemplate")
    box:SetSize(280, 20)
    box:SetPoint("BOTTOMLEFT", 20, 12)
    box:SetAutoFocus(false)
    box:SetScript("OnEnterPressed", function(self)
      local text = self:GetText()
      self:SetText("")
      self:ClearFocus()
      P.Load(text)
    end)
    box:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
    -- The panel only hides when the player closes it, so the talent window must not bring it back.
    frame:SetScript("OnHide", function() userHidden = true; clearMarks() end)
  end)
  if not built then return nil end
  panel = frame
  return panel
end

function P.UseWorkspace()
  userHidden = true
  EverlootDB.planView = "workspace"
  if panel then panel:Hide() end
end

--- Read the active spec group and recompute the plan. Safe to call at any time.
function P.Refresh()
  if not current then last = nil; clearMarks(); return end
  local active
  for _, entry in ipairs(T.Groups()) do
    if entry.active then active = entry end
  end
  local state = active and T.State(active.configID)
  last = state and { configID = active.configID, state = state, result = P.Evaluate(current, state, currentOrder) } or nil
  if panel and panel:IsShown() then
    panel.body:SetText(table.concat(lines(), "\n"))
  end
  if (panel and panel:IsShown()) or workspaceVisible() then pcall(mark) else clearMarks() end
end

--- Show the panel, beside the talent window when it is open.
function P.Show()
  userHidden = false
  EverlootDB.planView = "guide"
  if E.Planner and E.Planner.frame then E.Planner.frame:Hide() end
  local frame = buildPanel()
  if not frame then
    P.Refresh()
    print(table.concat(lines(), "\n"))
    return
  end
  local talents = PlayerSpellsFrame
  if talents and type(talents.IsShown) == "function" and talents:IsShown() then
    pcall(function()
      frame:ClearAllPoints()
      frame:SetPoint("TOPLEFT", talents, "TOPRIGHT", 6, 0)
    end)
  end
  frame:Show()
  P.Refresh()
  frame.body:SetText(table.concat(lines(), "\n"))
  pcall(mark)
end

--- Forget the loaded plan and everything kept with it.
local function forget()
  current, currentOrder, orderProblem, last = nil, nil, nil, nil
  EverlootDB.plan, EverlootDB.planOrder, EverlootDB.planOrderProblem, EverlootDB.planSet = nil, nil, nil, nil
end

--- Load a share code with the point order token that came with it, if any; set is 2 for a plan's second
--- talent set. Only a token that fits the code is kept: with any other the talents load, the order is
--- unknown and the reason is kept. Returns true, or false and the reason (also printed).
function P.Load(code, embedded, order, set)
  if type(code) == "string" and code:find("^%s*https?://") then
    local reason = "/everloot plan takes a share code; paste a website link into /everloot > Talents > Import"
    print("Everloot: " .. reason)
    return false, reason
  end
  local plan, reason = P.Decode(code)
  if not plan then print("Everloot: " .. reason); return false, reason end
  local class = T.Player()
  if class and class ~= plan.class then
    reason = "that plan is for " .. plan.class .. " and you are playing " .. class
    print("Everloot: " .. reason)
    return false, reason
  end
  if not class then print("Everloot: your class could not be read yet, so this plan was not checked against it.") end
  local spec = T.SpecId()
  if plan.spec and plan.spec > 0 and spec and spec ~= plan.spec then
    print("Everloot: this plan was made for spec id " .. plan.spec .. " and the client reports " .. spec .. ". Check it is the right plan.")
  end
  local decoded, problem
  if order ~= nil then decoded, problem = P.DecodeOrder(order, plan) end
  current, currentOrder, orderProblem = plan, decoded, problem
  EverlootDB.plan = P.Encode(plan)
  EverlootDB.planOrder = decoded and trim(order) or nil
  EverlootDB.planOrderProblem = problem
  EverlootDB.planSet = set == 2 and 2 or nil
  if embedded then
    P.UseWorkspace()
    P.Refresh()
  else P.Show() end
  if not panel then return true end
  print("Everloot: plan loaded (" .. #plan.entries .. " talents). It only shows; it never spends points.")
  return true
end

function P.Clear()
  forget()
  clearMarks()
  if panel then panel.body:SetText(table.concat(lines(), "\n")) end
end

--- The website link for the loaded plan: its code and, when known, its point order, under its own set's
--- keys (plan and order for a first set, plan2 and order2 for a second). Nil without a plan.
function P.Link()
  local plan = EverlootDB and P.Decode(EverlootDB.plan)
  if not plan then return nil end
  local code, token = EverlootDB.plan, EverlootDB.planOrder
  -- Only an order that fits the code is written; an unknown one is left out, never made up.
  token = token and P.DecodeOrder(token, plan) and trim(token) or nil
  local fragment = EverlootDB.planSet == 2 and P.Fragment(nil, code, nil, token) or P.Fragment(code, nil, token, nil)
  return "https://everloot.app/tools/talents/" .. plan.class:lower() .. fragment
end

--- Load saved build number n from the list /everloot plan prints, exactly like a pasted code.
--- set 2 loads the build's second talent set.
function P.LoadSaved(n, set)
  local list = P.SavedBuilds()
  if not list then
    print("Everloot: no saved builds here yet. Sync them with the Everloot Desktop App, then /reload.")
    return false
  end
  local build = list[n]
  if not build then
    print("Everloot: there is no saved build " .. n .. ". /everloot plan lists them.")
    return false
  end
  set = set or 1
  local code = set == 1 and build.code or set == 2 and build.code2 or nil
  if type(code) ~= "string" then
    print(set == 2 and ("Everloot: saved build " .. n .. " has no second talent set.")
      or ("Everloot: a saved build has talent sets 1 and 2, not " .. set .. "."))
    return false
  end
  print("Everloot: loading saved build " .. n .. (set == 2 and " (second set)" or "") .. ", " .. plain(build.name) .. ".")
  return P.Load(code, nil, nil, set)
end

--- /everloot plan [code | number | show | hide | clear]
function E.PlanCommand(arg)
  arg = (arg or ""):gsub("^%s+", ""):gsub("%s+$", "")
  local word = arg:lower()
  if word == "" then P.ListSaved(); return P.Show() end
  if word == "show" then return P.Show() end
  local n, set = word:match("^(%d+)%s*(%d*)$")
  if n then return P.LoadSaved(tonumber(n), tonumber(set)) end
  if word == "hide" then userHidden = true; if panel then panel:Hide() end return end
  if word == "clear" then P.Clear(); print("Everloot: plan cleared."); return end
  P.Load(arg)
end

local function hookTalentFrame()
  local frame = PlayerSpellsFrame
  if not (frame and type(frame.HookScript) == "function") or P.hooked == frame then return end
  local hooked = pcall(frame.HookScript, frame, "OnShow", function()
    if not current then return end
    if workspaceVisible() then P.Refresh() elseif not userHidden then P.Show() end
  end)
  -- Overlays belong to the talent window: take them off when it closes.
  pcall(frame.HookScript, frame, "OnHide", clearMarks)
  if hooked then P.hooked = frame end
end

local refreshPending = false
--- Trait events come in bursts and the panel is usually closed: recompute only for a visible panel, after they settle.
local function scheduleRefresh()
  if not (current and panel and panel:IsShown()) then return end
  if C_Timer and type(C_Timer.After) == "function" then
    if refreshPending then return end
    refreshPending = true
    C_Timer.After(2, function() refreshPending = false; pcall(P.Refresh) end)
  else
    pcall(P.Refresh)
  end
end

E:RegisterModule("plan", function()
  if not (T and T.HasTraitApi()) then error("trait API unavailable", 0) end
  userHidden = EverlootDB.planView == "workspace"
  if EverlootDB.plan then
    local plan = P.Decode(EverlootDB.plan)
    if plan then
      current, currentOrder, orderProblem = plan, nil, nil
      if EverlootDB.planOrder then
        currentOrder, orderProblem = P.DecodeOrder(EverlootDB.planOrder, plan)
        -- A saved order that no longer fits its code is dropped, never repaired.
        if not currentOrder then EverlootDB.planOrder, EverlootDB.planOrderProblem = nil, orderProblem end
      else
        orderProblem = ORDER_PROBLEMS[EverlootDB.planOrderProblem] and EverlootDB.planOrderProblem or nil
        EverlootDB.planOrderProblem = orderProblem
      end
    else forget() end
  end
  local f = E.frame
  for _, name in ipairs({ "ADDON_LOADED", "PLAYER_ENTERING_WORLD", "TRAIT_CONFIG_UPDATED", "TRAIT_NODE_CHANGED",
    "ACTIVE_PLAYER_SPECIALIZATION_CHANGED", "PLAYER_TALENT_UPDATE" }) do
    pcall(function() f:RegisterEvent(name) end)
  end
  f:HookScript("OnEvent", function(_, event)
    if event == "ADDON_LOADED" or event == "PLAYER_ENTERING_WORLD" then hookTalentFrame() end
    if event ~= "ADDON_LOADED" then scheduleRefresh() end
  end)
  hookTalentFrame()
  return "ready (/everloot plan <share code>; shows only, never spends points)"
end)
