-- Everloot talent plan: loads an Everloot share code and shows it next to the talent window.
-- DISPLAY ONLY. It lists where your build differs from the plan and, when the plan carries a spend
-- order, names the next point in it. It never spends a point, clicks a talent, imports a loadout or acts
-- for the player.
--
-- Share code (documented in addon/README.md and docs/2026-10-17-talent-share-code.md):
--   EL1-<class>-<spec>-<build>-<payload>
--   class    lowercase class token, e.g. mage
--   spec     client spec id, or 0 when unknown
--   build    client build the plan was made on, e.g. 1.60.1.70450
--   payload  base64url (no padding) of the text "node:rank,node:rank:choice,...". The site lists the
--            items by node id; their order is not a spend order.
--
-- Spend order: a token of its own beside the code, after &order= (&order2= for a second set) in a link:
--   O1<mode>-<sequence>
--   mode      p when a player planned the order, g when a tool generated a provisional one
--   sequence  one base64url character per point, in spend order: the node's index among the code's
--             nodes by ascending id (A is the lowest)
-- A plan without one has no known order, and no point is named next.

local E = Everloot
local T = E.Talents
local P = {}
E.Plan = P

local VERSION = 1
local MAX_ENTRIES = 600
local ORDER_VERSION = 1
local ORDER_LIMIT = 64
local ORIGINS = { p = "planned", g = "provisional" }

local B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
local B64URL_VALUE = {}
for i = 1, #B64URL do B64URL_VALUE[B64URL:sub(i, i)] = i - 1 end

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

-- Whitespace around an order token is ignored: exactly what ECMAScript's String.prototype.trim removes,
-- as the format doc lists it, matched as UTF-8. Lua's %s is the C library's idea of a space and misses
-- the non-ASCII ones.
local SPACES = { "\9", "\10", "\11", "\12", "\13", " ", "\194\160", "\225\154\128", "\226\128\168", "\226\128\169",
  "\226\128\175", "\226\129\159", "\227\128\128", "\239\187\191" }
for byte = 128, 138 do SPACES[#SPACES + 1] = "\226\128" .. string.char(byte) end -- U+2000 to U+200A

local function trim(text)
  local first, last, again = 1, #text, true
  while again do
    again = false
    for _, space in ipairs(SPACES) do
      local n = #space
      if last - first + 1 >= n and text:sub(first, first + n - 1) == space then first, again = first + n, true end
      if last - first + 1 >= n and text:sub(last - n + 1, last) == space then last, again = last - n, true end
    end
  end
  return text:sub(first, last)
end

--- Read a spend order token against the plan it came with. Returns { origin = "planned" or "provisional",
--- sequence = { nodeId, ... } one per point in spend order, token = the token without the whitespace
--- around it }, or nil and the format's error: newer-version for any version above 1, else the first of
--- malformed, unsupported-mode, over-limit, extra-points and missing-points that applies. A known order
--- only means its points match the plan's ranks; whether each point could be spent at its place is not
--- checked here.
function P.DecodeOrder(token, plan)
  if type(token) ~= "string" then return nil, "malformed" end
  token = trim(token)
  local version = token:match("^O([1-9][0-9]*)")
  if not version then return nil, "malformed" end
  -- A newer token may change everything after its version: say so rather than guess.
  if tonumber(version) > ORDER_VERSION then return nil, "newer-version" end
  local mode, sequence = token:sub(#version + 2):match("^([a-z])%-([A-Za-z0-9_%-]+)$")
  if not mode then return nil, "malformed" end
  local origin = ORIGINS[mode]
  if not origin then return nil, "unsupported-mode" end
  local nodes, left, total = {}, {}, 0
  for _, entry in ipairs(plan.entries) do
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
  return { origin = origin, sequence = order, token = token }
end

--- What a talent calculator link carries, read as the site reads it: the first set's code after plan=,
--- the second's after plan2=, and their spend orders after order= and order2=, each as found, or nil.
--- A value ends at the first character that is not a letter, a digit, _, . or -.
function P.ReadLink(text)
  local function value(key) return text:match("[#&]" .. key .. "=([A-Za-z0-9_%.%-]+)") end
  return { first = value("plan"), second = value("plan2"), firstOrder = value("order"), secondOrder = value("order2") }
end

--- The fragment for one set, as the site writes it: the code after plan= (plan2= for the second set),
--- then its spend order, when it has one, after order= (order2=).
function P.Fragment(code, order, set)
  local key = set == 2 and "2" or ""
  return "#plan" .. key .. "=" .. code .. (order and ("&order" .. key .. "=" .. order) or "")
end

--- The site link for the saved plan: its code and the order it came with, under its set's own keys. An
--- order that does not fit the code is left out, never made up. Nil without a plan.
function P.Link()
  local plan = P.Decode(EverlootDB.plan)
  if not plan then return nil end
  local order = EverlootDB.planOrder and P.DecodeOrder(EverlootDB.planOrder, plan)
  return "https://everloot.app/tools/talents/" .. plan.class:lower()
    .. P.Fragment(EverlootDB.plan, order and order.token or nil, EverlootDB.planSet)
end

--- Compare a plan with the client's current state (T.State). Pure: no game calls.
--- Returns { total, done, order, next, unplaced, candidates, unsure, missing, mismatches }:
---   order       the origin of the plan's order (plan.order, from P.DecodeOrder) when it is followed
---   next        { entry, blocked }: the first point of that order not spent yet, blocked when the game
---               says it cannot be bought now. Only an order names one: item order and node ids never do.
---   unplaced    true when the plan's order names a node this tree does not have, so it is not followed
---   candidates  without a followed order, the missing points the game says can be bought now, and
---   unsure      those it says nothing about, each { entry, have }, in plan order: none comes first
---   missing     how many planned nodes still need points
---   mismatches  { { kind, nodeId, have, want } }
function P.Evaluate(plan, state)
  local result = { total = 0, done = 0, candidates = {}, unsure = {}, mismatches = {} }
  local planned = {}
  local deficits = {}
  local unknown = false
  for _, entry in ipairs(plan.entries) do
    planned[entry.nodeId] = true
    result.total = result.total + entry.rank
    local node = state.nodes[entry.nodeId]
    if not node then
      unknown = true
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
  result.missing = #deficits
  if plan.order and unknown then
    result.unplaced = true
  elseif plan.order then
    result.order = plan.order.origin
    -- The k-th time the order names a node is that node's k-th point.
    local need, seen = {}, {}
    for _, d in ipairs(deficits) do need[d.entry.nodeId] = d end
    for _, nodeId in ipairs(plan.order.sequence) do
      seen[nodeId] = (seen[nodeId] or 0) + 1
      local d = need[nodeId]
      if d and seen[nodeId] > d.node.ranks then
        result.next = { entry = d.entry, blocked = d.node.canBuy == false }
        break
      end
    end
    return result
  end
  for _, d in ipairs(deficits) do
    local list = d.node.canBuy == true and result.candidates or d.node.canBuy == nil and result.unsure
    if list then list[#list + 1] = { entry = d.entry, have = d.node.ranks } end
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
local last          -- { configID, state, result } from the latest refresh

-- Why an order that came with a plan is not used, by the format's error.
local ORDER_REASONS = {
  malformed = "is damaged",
  ["newer-version"] = "was made by a newer version of Everloot",
  ["unsupported-mode"] = "is of a kind this addon does not read",
  ["over-limit"] = "is for more than " .. ORDER_LIMIT .. " points, the most an order carries",
  ["extra-points"] = "lists points the plan does not have",
  ["missing-points"] = "leaves out points the plan has",
}

--- One line on the plan's spend order: who made it, or that there is none to follow and why.
local function orderText(plan)
  if plan.order and plan.order.origin == "planned" then return "Spend order: planned by a player." end
  if plan.order then return "Spend order: provisional, generated by a tool; not a recommendation or a record of play." end
  local text = "Spend order: unknown, so no point is named next."
  if plan.orderProblem then text = text .. " The order that came with this plan " .. ORDER_REASONS[plan.orderProblem] .. "." end
  return text
end

--- The order line for the loaded plan, or nil without one.
function P.OrderText()
  return current and orderText(current)
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
  out[#out + 1] = orderText(current)
  if not last then
    out[#out + 1] = "Open the talent window, or wait: your talents have not been read yet."
    return out
  end
  local r, state, configID = last.result, last.state, last.configID
  local function point(entry, have)
    return string.format("%s (rank %d of %d)", spellName(configID, entry.nodeId, state, entry.choice), have + 1, entry.rank)
  end
  local function points(list)
    local names = {}
    for i, p in ipairs(list) do
      if i > 8 then names[#names + 1] = "and " .. (#list - 8) .. " more"; break end
      names[#names + 1] = point(p.entry, p.have)
    end
    return table.concat(names, ", ")
  end
  out[#out + 1] = string.format("%d of %d planned points match.", r.done, r.total)
  if r.unplaced then
    out[#out + 1] = "Not every planned point is in your talent tree, so the spend order is not followed."
  end
  if r.next then
    local want = r.next.entry
    local node = state.nodes[want.nodeId]
    out[#out + 1] = string.format("Next point%s: %s%s", r.order == "provisional" and " (provisional order)" or "", point(want, node.ranks),
      r.next.blocked and " - not available yet (a gate or no point to spend)"
        or node.canBuy == nil and " - the game does not say whether it can be bought now" or "")
  elseif r.missing > 0 then
    if #r.candidates > 0 then out[#out + 1] = "You can add any of these now: " .. points(r.candidates) end
    if #r.unsure > 0 then out[#out + 1] = "The game does not say whether you can add these now: " .. points(r.unsure) end
    if #r.candidates == 0 and #r.unsure == 0 then
      out[#out + 1] = "None of the points the plan still needs can be added right now (a gate or no point to spend)."
    end
  elseif r.total > 0 and #r.mismatches == 0 then
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
  last = state and { configID = active.configID, state = state, result = P.Evaluate(current, state) } or nil
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

--- Keep the plan in SavedVariables: its code, its order token when the order fits, and set 2 when the
--- code is a link's second set. Nil forgets all three.
local function save(plan)
  EverlootDB.plan = plan and P.Encode(plan) or nil
  EverlootDB.planOrder = plan and plan.order and plan.order.token or nil
  EverlootDB.planSet = plan and plan.set or nil
end

--- Load a share code with the spend order token that came with it, if any; set 2 marks the code as a
--- link's second set. Returns true, or false and the reason (also printed). An order that does not fit
--- leaves the talents loaded and the order unknown, and says why.
function P.Load(code, embedded, order, set)
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
  if order ~= nil then
    plan.order, plan.orderProblem = P.DecodeOrder(order, plan)
    if plan.orderProblem then
      print("Everloot: the plan's spend order " .. ORDER_REASONS[plan.orderProblem] .. ", so the order is unknown. The talents still loaded.")
    end
  end
  plan.set = set == 2 and 2 or nil
  current = plan
  save(plan)
  if embedded then
    P.UseWorkspace()
    P.Refresh()
  else P.Show() end
  if not panel then return true end
  print("Everloot: plan loaded (" .. #plan.entries .. " talents). It only shows; it never spends points.")
  return true
end

function P.Clear()
  current, last = nil, nil
  save(nil)
  clearMarks()
  if panel then panel.body:SetText(table.concat(lines(), "\n")) end
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
  return P.Load(code)
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
  -- A saved order is read again: one that no longer fits is dropped and its reason shown; a damaged
  -- code takes its order and set with it.
  local plan = EverlootDB.plan and P.Decode(EverlootDB.plan)
  if plan then
    if EverlootDB.planOrder ~= nil then plan.order, plan.orderProblem = P.DecodeOrder(EverlootDB.planOrder, plan) end
    plan.set = EverlootDB.planSet == 2 and 2 or nil
    current = plan
  end
  save(plan)
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
