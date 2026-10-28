-- Everloot raid check: reads your group or raid and the buffs on each member, and lists the raid buffs
-- that nobody in a group has. DISPLAY ONLY. It never casts, targets, invites, moves anyone or acts for the
-- player, and it records nothing: a check runs when you type /everloot raid and not before.
--
-- The buff list is raid_data.lua, written from web/src/data/raid-buffs.ts. It is hand-checked for one
-- game build and unconfirmed; the report says so and says when your client is on another build.
--
-- Raid share code (docs/2026-10-18-raid-share-code.md):
--   ELR1-<size>-<build>-<payload>
--   size     10, 20 or 40
--   build    the client build the code was made on, e.g. 1.60.1.70450
--   payload  base64url (no padding) of two digits per slot, class (1-9) then tree (0-3), "00" = empty.
--            The addon cannot read another player's talent tree, so it always writes tree 0 ("any").
--   Class digits: warrior 1, paladin 2, hunter 3, rogue 4, priest 5, shaman 6, mage 7, warlock 8, druid 9.

local E = Everloot
local R = {}
E.Raid = R

local VERSION = 1
local GROUP_SIZE = 5
local MAX_MEMBERS = 40
local SITE = "https://everloot.app/tools/raid#raid="

local CLASS_DIGIT = {
  WARRIOR = 1, PALADIN = 2, HUNTER = 3, ROGUE = 4, PRIEST = 5, SHAMAN = 6, MAGE = 7, WARLOCK = 8, DRUID = 9,
}

local B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
local CLASSES = { "WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST", "SHAMAN", "MAGE", "WARLOCK", "DRUID" }

--- Read the website's ELR1 code. Bound input before decoding; never evaluate pasted text.
function R.Decode(input)
  if type(input) ~= "string" or #input > 2048 then return nil, "paste an Everloot raid code or link" end
  local code = input:match("^%s*(.-)%s*$")
  code = code:match("^https?://[^/]+/tools/raid/?[^#]*#raid=([^&]+)")
    or code:match("^https?://[^/]+/tools/raid/r/([^/?#]+)") or code
  code = code:gsub("=+$", "")
  local version, size, build, payload = code:match("^ELR(%d+)%-(%d+)%-([%d%.]+)%-([%w_%-]*)$")
  if not version then return nil, "that is not an Everloot raid code" end
  if tonumber(version) ~= VERSION then return nil, "this addon reads raid code version 1" end
  size = tonumber(size)
  if size ~= 10 and size ~= 20 and size ~= 40 then return nil, "raid size must be 10, 20 or 40" end
  if not build:match("^%d+%.[%d%.]*%d$") or build:find("%.%.") then return nil, "the plan build is damaged" end
  if #payload % 4 == 1 then return nil, "the raid slots are damaged" end
  local bytes = {}
  for i = 1, #payload, 4 do
    local n, count = 0, math.min(4, #payload - i + 1)
    for k = i, i + count - 1 do
      local index = B64URL:find(payload:sub(k, k), 1, true)
      if not index then return nil, "the raid slots are damaged" end
      n = n * 64 + index - 1
    end
    n = n * 64 ^ (4 - count)
    local part = { math.floor(n / 65536) % 256, math.floor(n / 256) % 256, n % 256 }
    for k = 1, count - 1 do bytes[#bytes + 1] = string.char(part[k]) end
  end
  local text = table.concat(bytes)
  if #text % 2 ~= 0 or #text > size * 2 or text:find("%D") then return nil, "the raid slots are damaged" end
  local slots = {}
  for i = 1, size do
    local class, tree = tonumber(text:sub(i * 2 - 1, i * 2 - 1)), tonumber(text:sub(i * 2, i * 2))
    if not class or (class == 0 and tree == 0) then
      slots[i] = false
    elseif not CLASSES[class] or tree > 3 then
      return nil, "the raid slots are damaged"
    else
      slots[i] = { class = CLASSES[class], tree = tree }
    end
  end
  return { size = size, build = build, slots = slots }, nil, code
end

function R.Load(input)
  local plan, reason, code = R.Decode(input)
  if not plan then return false, reason end
  EverlootDB.raidPlan = code
  return true
end

function R.ClearPlan() EverlootDB.raidPlan = nil end

--- Count classes per group; codes carry neither player names nor identities.
function R.Compare(plan, members)
  local groups = {}
  local count = plan.size / GROUP_SIZE
  for _, m in ipairs(members) do count = math.max(count, math.min(8, m.group or 1)) end
  for g = 1, count do
    local planned, actual = {}, {}
    local row = { group = g, planned = 0, actual = 0, matched = 0, differences = {} }
    for i = (g - 1) * GROUP_SIZE + 1, math.min(g * GROUP_SIZE, plan.size) do
      local slot = plan.slots[i]
      if slot then planned[slot.class] = (planned[slot.class] or 0) + 1; row.planned = row.planned + 1 end
    end
    for _, m in ipairs(members) do
      if (m.group or 1) == g then
        row.actual = row.actual + 1
        if m.class then actual[m.class] = (actual[m.class] or 0) + 1 end
      end
    end
    for _, class in ipairs(CLASSES) do
      local want, have = planned[class] or 0, actual[class] or 0
      row.matched = row.matched + math.min(want, have)
      if want ~= have then
        row.differences[#row.differences + 1] = { class = class, need = math.max(0, want - have), extra = math.max(0, have - want) }
      end
    end
    groups[#groups + 1] = row
  end
  return groups
end

function R.PlanLines(members)
  local plan, reason = R.Decode(EverlootDB and EverlootDB.raidPlan)
  if not plan then return { EverlootDB and EverlootDB.raidPlan and ("Saved plan could not load: " .. reason)
    or "No raid plan loaded. Build a roster on everloot.app/tools/raid, then copy it for the addon." } end
  local out = { string.format("%d-slot plan / build %s", plan.size, plan.build) }
  if EverlootDB.clientBuild and EverlootDB.clientBuild ~= plan.build then
    out[#out + 1] = "Your client is on a different build. Check the plan's rules before using it."
  end
  out[#out + 1] = "Class counts by group; player identities and talent choices cannot be verified."
  for _, row in ipairs(R.Compare(plan, members or {})) do
    local needs = {}
    for _, d in ipairs(row.differences) do
      needs[#needs + 1] = (d.need > 0 and ("need " .. d.need) or ("extra " .. d.extra)) .. " " .. d.class:lower()
    end
    out[#out + 1] = string.format("Group %d / %d planned, %d present, %d match%s", row.group, row.planned, row.actual,
      row.matched, #needs > 0 and (": " .. table.concat(needs, ", ")) or "")
  end
  return out
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

--- members: { { group = 1..8, class = "MAGE", ... } } in roster order. Pure: no game calls.
--- Returns the share code, or nil and the reason.
function R.Code(members, build)
  if type(build) ~= "string" or not build:find("^%d+%.[%d%.]*%d$") or build:find("%.%.") then
    return nil, "the client build is unknown, so a code would not say which rules it was made for"
  end
  local topGroup, perGroup, slots = 1, {}, {}
  for _, m in ipairs(members) do
    local g = math.max(1, math.min(8, m.group or 1))
    perGroup[g] = (perGroup[g] or 0) + 1
    if perGroup[g] <= GROUP_SIZE then
      slots[(g - 1) * GROUP_SIZE + perGroup[g]] = m
      if g > topGroup then topGroup = g end
    end
  end
  local size = topGroup <= 2 and 10 or (topGroup <= 4 and 20 or 40)
  local pairs_ = {}
  for i = 1, size do
    local digit = slots[i] and CLASS_DIGIT[slots[i].class]
    pairs_[i] = digit and (digit .. "0") or "00"
  end
  -- Only whole pairs are dropped from the end ("1000" keeps its "10").
  local text = table.concat(pairs_)
  while #text >= 2 and text:sub(-2) == "00" do text = text:sub(1, -3) end
  return string.format("ELR%d-%d-%s-%s", VERSION, size, build, encode64(text))
end

--- members: { { group, name, readable, auras = { [auraName or spellId] = true } } }.
--- Returns { { group, size, readable, missing = { family label, ... } } } in group order, and the number
--- of members that could not be read. A member out of range or offline is not counted as lacking a buff.
function R.Missing(members, data)
  local groups, order, unreadable = {}, {}, 0
  for _, m in ipairs(members) do
    local g = m.group or 1
    if not groups[g] then groups[g] = { group = g, size = 0, readable = 0, held = {} }; order[#order + 1] = g end
    local entry = groups[g]
    entry.size = entry.size + 1
    if m.readable then
      entry.readable = entry.readable + 1
      for _, buff in ipairs(data.buffs) do
        local has = false
        for _, name in ipairs(buff.names) do if m.auras[name] then has = true; break end end
        for _, id in ipairs(buff.spellIds or {}) do if m.auras[id] then has = true; break end end
        if has then entry.held[buff.family] = true end
      end
    else
      unreadable = unreadable + 1
    end
  end
  table.sort(order)
  local result = {}
  for _, g in ipairs(order) do
    local entry = groups[g]
    local missing = {}
    if entry.readable > 0 then
      for _, family in ipairs(data.families) do
        if not entry.held[family.id] then missing[#missing + 1] = family.label end
      end
    end
    result[#result + 1] = { group = g, size = entry.size, readable = entry.readable, missing = missing }
  end
  return result, unreadable
end

local function call(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b, c, d, e, f = pcall(fn, ...)
  if ok then return a, b, c, d, e, f end
  return nil
end

--- The names and spell ids of the helpful auras on a unit. Prefers C_UnitAuras, falls back to UnitAura.
local function readAuras(unit)
  local set = {}
  local byIndex = C_UnitAuras and C_UnitAuras.GetAuraDataByIndex
  for i = 1, 40 do
    if byIndex then
      local aura = call(byIndex, unit, i, "HELPFUL")
      if type(aura) ~= "table" then break end
      if aura.name then set[aura.name] = true end
      if aura.spellId then set[aura.spellId] = true end
    elseif UnitAura then
      local name, _, _, _, _, _, _, _, _, spellId = call(UnitAura, unit, i, "HELPFUL")
      if not name then break end
      set[name] = true
      if type(spellId) == "number" then set[spellId] = true end
    else
      return nil
    end
  end
  return set
end

--- The current group as { { unit, name, class, group, readable, auras } }, or nil and a reason.
function R.ReadGroup()
  if not (IsInGroup and call(IsInGroup)) then return nil, "you are not in a group" end
  local count = tonumber(call(GetNumGroupMembers)) or 0
  if count < 1 then return nil, "you are not in a group" end
  count = math.min(count, MAX_MEMBERS)
  local inRaid = IsInRaid and call(IsInRaid)
  local members = {}
  for i = 1, count do
    local unit, group, class, name
    if inRaid then
      unit = "raid" .. i
      local rosterName, _, subgroup, _, _, fileName = call(GetRaidRosterInfo, i)
      name, group, class = rosterName, subgroup, fileName
    else
      unit = (i == 1) and "player" or ("party" .. (i - 1))
      group = 1
    end
    if not class then
      local ok, _, token = pcall(UnitClass, unit)
      if ok then class = token end
    end
    local readable = call(UnitExists, unit) and call(UnitIsConnected, unit) and (unit == "player" or call(UnitIsVisible, unit))
    local auras = readable and readAuras(unit) or nil
    members[#members + 1] = {
      unit = unit, name = name or call(UnitName, unit) or unit, class = class, group = group or 1,
      readable = auras ~= nil, auras = auras or {},
    }
  end
  return members
end

local function report(members, data)
  local lines = {}
  local client = EverlootDB and EverlootDB.clientBuild
  lines[#lines + 1] = string.format("Everloot raid: %d members. Buff list for build %s, hand-checked and unconfirmed.", #members, data.build)
  if client and client ~= data.build then
    lines[#lines + 1] = string.format("  Your client is build %s, so the list may be out of date.", client)
  end
  local groups, unreadable = R.Missing(members, data)
  for _, g in ipairs(groups) do
    if g.readable == 0 then
      lines[#lines + 1] = string.format("  Group %d: nobody could be read (out of range or offline).", g.group)
    elseif #g.missing == 0 then
      lines[#lines + 1] = string.format("  Group %d: no raid buff missing.", g.group)
    else
      lines[#lines + 1] = string.format("  Group %d: missing %s", g.group, table.concat(g.missing, ", "))
    end
  end
  if unreadable > 0 then
    lines[#lines + 1] = string.format("  %d member(s) could not be read; a buff on them is not counted.", unreadable)
  end
  lines[#lines + 1] = "  /everloot raid code gives a link that opens this raid on everloot.app/tools/raid."
  return table.concat(lines, "\n")
end
R.Report = report

local function showCode(url)
  -- A window with the link selected for copying. Any missing frame function falls back to chat.
  local ok = pcall(function()
    local frame = R.frame
    if not frame then
      frame = CreateFrame("Frame", "EverlootRaidCode", UIParent)
      frame:SetSize(520, 60)
      frame:SetPoint("CENTER")
      frame:SetFrameStrata("DIALOG")
      R.frame = frame
      local box = CreateFrame("EditBox", nil, frame)
      box:SetAllPoints(frame)
      box:SetAutoFocus(true)
      box:SetFontObject(ChatFontNormal)
      box:SetScript("OnEscapePressed", function() frame:Hide() end)
      box:SetScript("OnEnterPressed", function() frame:Hide() end)
      frame.box = box
    end
    frame:Show()
    frame.box:SetText(url)
    frame.box:HighlightText()
    frame.box:SetFocus()
  end)
  if not ok then print("Everloot raid link: " .. url) end
end

--- /everloot raid and /everloot raid code. Display only.
function R.Command(arg)
  local data = E.RaidData
  if not data then print("Everloot raid: the buff list did not load."); return end
  local members, reason = R.ReadGroup()
  if not members then print("Everloot raid: " .. reason .. "."); return end
  if arg == "code" then
    local code, why = R.Code(members, EverlootDB and EverlootDB.clientBuild)
    if not code then print("Everloot raid: " .. why .. "."); return end
    print("Everloot raid code: " .. code)
    showCode(SITE .. code)
    return
  end
  print(report(members, data))
end

E:RegisterModule("raid", function()
  if not (GetNumGroupMembers and IsInGroup and UnitClass) then error("group API unavailable", 0) end
  if not E.RaidData then error("raid buff list missing", 0) end
  E.RaidCommand = R.Command
  return "ready (/everloot raid; display only, nothing recorded)"
end)
