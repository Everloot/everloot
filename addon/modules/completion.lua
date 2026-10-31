-- Everloot completion tracker for WoW: Forever (client 1.60.1, interface 16001): achievements,
-- reputation, titles and quest chains. Off until the player runs /everloot completion on.
--
-- Two kinds of rows, both read from the game's own calls and never written back:
--   catalog rows  achievement_catalog, reputation_catalog, title_catalog, quest_chain_catalog:
--                 ids, names, criteria text, standing headers, quest ids. They reflect what this
--                 character's windows list, so the site shows an entry only after 3 upload addresses report it
--                 identically and never serves the raw rows.
--   owned rows    achievement_owned, reputation_owned, title_owned, quest_owned: this character's own
--                 progress, under an opaque 8-digit key (not the name). Shown on the site only from the
--                 upload page's "My collection ownership and completion progress" choice with a
--                 verified grant.
-- A changed achievement or standing replaces its earlier row in this file, so the file does not grow
-- with every point of reputation. Titles and completed quests are written as additions.
--
-- Calls, checked against the client's own files for build 1.60.1.70450 (docs/2026-10-19-addon-0.3.3-beta-checklist.md):
--   GetCategoryList, GetCategoryInfo, GetCategoryNumAchievements, GetAchievementInfo,
--   GetAchievementNumCriteria, GetAchievementCriteriaInfo     achievements (used by Blizzard's windows)
--   C_Reputation.GetNumFactions, GetFactionDataByIndex, IsMajorFaction   reputation (documented)
--   GetNumTitles, GetTitleName, IsTitleKnown                  titles (documented)
--   C_QuestLog.GetAllCompletedQuestIDs                        completed quests (documented)
--   C_QuestLine.GetQuestLineInfo, GetQuestLineQuests          quest chains (documented)
-- A missing call records nothing for that part and /everloot status says which one. The module
-- reads in chunks across frames, pauses in combat and calls nothing that changes the game.

local E = Everloot
local C = {}
E.Completion = C

local BUDGET = 250             -- API reads per frame
local DEBOUNCE_SECONDS = 10    -- events arrive in bursts; read once after they settle
local COMBAT_RETRY_SECONDS = 15
local ACHIEVEMENT_REFRESH_SECONDS = 7 * 24 * 60 * 60  -- a login re-reads achievements at most this often
local MAX_CATEGORIES = 500
local MAX_PER_CATEGORY = 1000
local MAX_CRITERIA = 5000      -- web/src/lib/intake.ts
local MAX_CRITERIA_KEPT = 100
local MAX_CHAIN_QUESTS = 80
local MAX_TITLES = 5000
local MAX_FACTIONS = 600
local MAX_IDS_PER_ROW = 200
local MAX_CHAINS_PER_PASS = 400
local MAX_PENDING = 1000
local FORGET_CHARACTER_SECONDS = 90 * 24 * 60 * 60  -- seen state of a character not seen for this long is dropped
local MAX_ID = 2000000000

--- Limits on what this module keeps in the file. A test lowers them.
C.Limits = {
  rows = 6000,            -- per kind: replaces the file-wide 2000 for these kinds
  achievements = 1500,    -- catalog rows read from the achievement list
  perCharacter = 600,     -- owned achievement and reputation rows for one character
  bytes = 3000000,        -- estimated size of all completion rows together
}

local CATALOG_KINDS = { "achievement_catalog", "reputation_catalog", "title_catalog", "quest_chain_catalog" }
local KINDS = { "achievement_catalog", "reputation_catalog", "title_catalog", "quest_chain_catalog",
  "achievement_owned", "reputation_owned", "title_owned", "quest_owned" }

-- Every call this module may make to the game. A test scans the source against this list.
local API = {
  achievements = { "GetCategoryList", "GetCategoryInfo", "GetCategoryNumAchievements", "GetAchievementInfo",
    "GetAchievementNumCriteria", "GetAchievementCriteriaInfo" },
  reputation = { "C_Reputation.GetNumFactions", "C_Reputation.GetFactionDataByIndex" },
  titles = { "GetNumTitles", "GetTitleName", "IsTitleKnown" },
  quests = { "C_QuestLog.GetAllCompletedQuestIDs" },
  chains = { "C_QuestLine.GetQuestLineInfo", "C_QuestLine.GetQuestLineQuests" },
  optional = { "C_Reputation.IsMajorFaction" },   -- absent: renown factions are not told apart
  player = { "UnitGUID", "UnitClass", "UnitLevel" },
  timer = { "C_Timer.After" },
}
C.API = API

local function resolve(path)
  local value = _G
  for part in path:gmatch("[^%.]+") do
    if type(value) ~= "table" then return nil end
    value = value[part]
  end
  return value
end

local function absent(paths)
  local out = {}
  for _, path in ipairs(paths) do
    if type(resolve(path)) ~= "function" then out[#out + 1] = path end
  end
  return out
end
C.Absent = absent

--- One guarded call. Only the values are returned; an error is a nil.
local function call(path, ...)
  local fn = resolve(path)
  if type(fn) ~= "function" then return nil end
  local ok, a, b, c, d, e, f, g, h, i, j, k, l, m, n = pcall(fn, ...)
  if not ok then return nil end
  return a, b, c, d, e, f, g, h, i, j, k, l, m, n
end

local function whole(n, min, max)
  return type(n) == "number" and n == math.floor(n) and n >= min and n <= max
end

--- Plain text of at most `limit` bytes: colour codes, links and textures out, control characters to spaces.
local function plain(text, limit)
  if type(text) ~= "string" then return nil end
  text = text:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("|T.-|t", ""):gsub("|A.-|a", "")
  text = text:gsub("|H.-|h(.-)|h", "%1"):gsub("%c", " "):gsub("^%s+", ""):gsub("%s+$", "")
  if #text > limit then text = text:sub(1, limit):gsub("[\192-\255][\128-\191]*$", "") end
  if text == "" then return nil end
  return text
end

local function hex8(n)
  return string.format("%04x%04x", math.floor(n / 65536) % 65536, n % 65536)
end

--- This character's opaque key, class token and level, or nil, reason.
function C.Identity()
  local guid = E.Readable(call("UnitGUID", "player"))
  if type(guid) ~= "string" or guid == "" then return nil, "no player id" end
  local _, token = call("UnitClass", "player")
  token = E.Readable(token)
  if type(token) ~= "string" or not token:find("^%a+$") or #token < 2 or #token > 20 then return nil, "no class" end
  local level = tonumber(E.Readable(call("UnitLevel", "player")))
  if not level or level < 1 then return nil, "no level" end
  return hex8(E.Adler32((EverlootDB.installId or "") .. ":" .. guid)), token, math.min(100, math.floor(level))
end

local function daysIn(month, year)
  if month == 2 then
    return (year % 4 == 0 and (year % 100 ~= 0 or year % 400 == 0)) and 29 or 28
  end
  return (month == 4 or month == 6 or month == 9 or month == 11) and 30 or 31
end

--- "YYYY-MM-DD" from the achievement's month, day and year (the game gives the year as two digits), or nil
--- for a date that does not exist.
local function earnedOn(month, day, year)
  if not (whole(month, 1, 12) and whole(day, 1, 31) and whole(year, 0, 2100)) then return nil end
  if year < 100 then year = year + 2000 end
  if day > daysIn(month, year) then return nil end
  return string.format("%04d-%02d-%02d", year, month, day)
end
C.EarnedOn = earnedOn

-- ---------------------------------------------------------------------------------------------
-- Store. One pass at a time. A row replaces the row its entity had; its content is compared in full
-- against that row, so nothing is rewritten unless something changed.

local function seenTable()
  local seen = EverlootDB.completionSeen
  if type(seen) ~= "table" then seen = {}; EverlootDB.completionSeen = seen end
  seen.own = type(seen.own) == "table" and seen.own or {}
  return seen
end

local function ownedSeen(seen, key)
  local own = seen.own[key]
  if type(own) ~= "table" then own = {}; seen.own[key] = own end
  for _, bucket in ipairs({ "t", "q", "pending" }) do
    if type(own[bucket]) ~= "table" then own[bucket] = {} end
  end
  return own
end

local function parts(...)
  local out = {}
  for i = 1, select("#", ...) do out[i] = tostring((select(i, ...))) end
  return table.concat(out, "|")
end

local KEY = {
  achievement_catalog = function(r) return tostring(r.achievementId) end,
  reputation_catalog = function(r) return tostring(r.factionId) end,
  title_catalog = function(r) return tostring(r.titleId) end,
  quest_chain_catalog = function(r) return tostring(r.questLineId) end,
  achievement_owned = function(r) return r.characterKey .. ":" .. r.achievementId end,
  reputation_owned = function(r) return r.characterKey .. ":" .. r.factionId end,
}

--- The whole content of a row but who and when, as one string. Two rows with the same text say the same thing.
local SIGNATURE = {
  achievement_catalog = function(r)
    local out = { parts(r.achievementId, r.name, r.categoryId, r.category, r.parentCategory, r.points, r.criteriaCount) }
    for _, c in ipairs(r.criteria) do out[#out + 1] = c.text .. "=" .. c.required end
    return table.concat(out, "|")
  end,
  reputation_catalog = function(r) return parts(r.factionId, r.name, r.header, r.major) end,
  title_catalog = function(r) return parts(r.titleId, r.name) end,
  quest_chain_catalog = function(r) return parts(r.questLineId, r.name, r.truncated, table.concat(r.questIds, ",")) end,
  achievement_owned = function(r)
    return parts(r.achievementId, r.completed, r.earnedByMe, r.earnedOn, r.criteriaMet, r.criteriaTotal, r.quantity, r.required, r.class, r.level)
  end,
  reputation_owned = function(r) return parts(r.factionId, r.reaction, r.standing, r.floor, r.ceiling, r.class, r.level) end,
}

--- A rough size in bytes of a row as SavedVariables will hold it.
local function weigh(value)
  local t = type(value)
  if t == "string" then return #value + 8 end
  if t == "table" then
    local sum = 16
    for k, v in pairs(value) do sum = sum + weigh(k) + weigh(v) end
    return sum
  end
  return 8
end

-- What E:Store adds to every row: its event id and the time it was logged.
local STORED_FIELDS = weigh({ eventId = string.rep("0", 48), kindLoggedAt = "2026-01-01T00:00:00Z" }) - 16
-- One remembered title or quest id in the seen state ([id] = true).
local SEEN_ID = 16

local function newContext()
  return { dead = {}, index = {}, capped = {}, stats = {}, count = {}, bytes = 0, bytesCounted = false }
end

local function stat(ctx, name, delta)
  ctx.stats[name] = (ctx.stats[name] or 0) + (delta or 1)
end

--- The index of the rows a kind already has in the file, keyed by entity. Built once per pass.
local function indexOf(ctx, kind)
  local index = ctx.index[kind]
  if index then return index end
  index = {}
  ctx.index[kind] = index
  local keyOf = KEY[kind]
  for _, row in ipairs(EverlootDB.records[kind] or {}) do
    local ok, key = pcall(keyOf, row)
    if ok and key then
      index[key] = row
      if row.characterKey then
        ctx.count[kind] = ctx.count[kind] or {}
        ctx.count[kind][row.characterKey] = (ctx.count[kind][row.characterKey] or 0) + 1
      end
    end
  end
  return index
end

--- Everything this module keeps in the file: its rows and its seen state.
local function countBytes(ctx)
  if ctx.bytesCounted then return end
  ctx.bytesCounted = true
  for _, kind in ipairs(KINDS) do
    for _, row in ipairs(EverlootDB.records[kind] or {}) do ctx.bytes = ctx.bytes + weigh(row) end
  end
  if type(EverlootDB.completionSeen) == "table" then ctx.bytes = ctx.bytes + weigh(EverlootDB.completionSeen) end
end

--- Drop a row from the file now (a replacement made at capacity needs the room first).
local function removeNow(kind, row)
  local rows = EverlootDB.records[kind] or {}
  for i = #rows, 1, -1 do
    if rows[i] == row then table.remove(rows, i); return end
  end
end

--- Store `row` as the entity's row unless it already says the same thing. Returns true when a row was written.
local function put(ctx, kind, row)
  if ctx.capped[kind] or ctx.full then return false end
  countBytes(ctx)
  local key = KEY[kind](row)
  local index = indexOf(ctx, kind)
  local old = index[key]
  local sig = SIGNATURE[kind](row)
  if old and SIGNATURE[kind](old) == sig then return false end
  if not old and row.characterKey then
    local count = (ctx.count[kind] or {})[row.characterKey] or 0
    if count >= C.Limits.perCharacter then ctx.capped[kind .. " (per character)"] = true; return false end
  end
  row.installId = EverlootDB.installId
  row.capturedAt = date("!%Y-%m-%dT%H:%M:%SZ")
  local delta = weigh(row) + STORED_FIELDS - (old and weigh(old) or 0)
  if delta > 0 and ctx.bytes + delta > C.Limits.bytes then ctx.full = true; return false end
  local store = EverlootDB.records[kind] or {}
  -- A replacement at capacity removes the old row first, so the room it needs is there.
  if old and #store >= C.Limits.rows then removeNow(kind, old); old = nil end
  if not E:Store(kind, row, C.Limits.rows) then ctx.capped[kind] = true; return false end
  if old then
    ctx.dead[kind] = ctx.dead[kind] or {}
    ctx.dead[kind][old] = true
  end
  index[key] = row
  ctx.bytes = ctx.bytes + delta
  if row.characterKey and not old then
    ctx.count[kind] = ctx.count[kind] or {}
    ctx.count[kind][row.characterKey] = (ctx.count[kind][row.characterKey] or 0) + 1
  end
  stat(ctx, kind)
  return true
end

--- Append a list-of-ids row (titles, completed quests) when it fits the budget.
local function putAddition(ctx, kind, row)
  if ctx.capped[kind] or ctx.full then return false end
  countBytes(ctx)
  row.installId = EverlootDB.installId
  row.capturedAt = date("!%Y-%m-%dT%H:%M:%SZ")
  -- The ids it carries are also remembered in the seen state.
  local delta = weigh(row) + STORED_FIELDS + #(row.titleIds or row.questIds or {}) * SEEN_ID
  if ctx.bytes + delta > C.Limits.bytes then ctx.full = true; return false end
  if not E:Store(kind, row, C.Limits.rows) then ctx.capped[kind] = true; return false end
  ctx.bytes = ctx.bytes + delta
  return true
end

local function compact(ctx)
  for kind, dead in pairs(ctx.dead) do
    local kept = {}
    for _, row in ipairs(EverlootDB.records[kind] or {}) do
      if not dead[row] then kept[#kept + 1] = row end
    end
    EverlootDB.records[kind] = kept
  end
  if EverlootDB.paused then
    for _, kind in ipairs(KINDS) do
      if EverlootDB.paused[kind] and #(EverlootDB.records[kind] or {}) < C.Limits.rows then EverlootDB.paused[kind] = nil end
    end
  end
end

-- ---------------------------------------------------------------------------------------------
-- Readers. Each runs inside a coroutine and calls spend(n) so a long list is read across frames.

local function categoryNames(id, cache)
  if cache[id] ~= nil then return cache[id][1], cache[id][2] end
  local title, parent = call("GetCategoryInfo", id)
  local name = plain(title, 80)
  local parentName
  if whole(parent, 1, MAX_ID) and parent ~= id then
    parentName = plain((call("GetCategoryInfo", parent)), 80)
  end
  cache[id] = { name, parentName }
  return name, parentName
end

local function readAchievements(ctx, own, identity, spend)
  local categories = call("GetCategoryList")
  if type(categories) ~= "table" then stat(ctx, "achievement_unreadable"); return end
  local names = {}
  local visited, total = {}, 0
  for ci = 1, math.min(#categories, MAX_CATEGORIES) do
    local categoryId = categories[ci]
    if whole(categoryId, 0, MAX_ID) then
      local count = call("GetCategoryNumAchievements", categoryId)
      count = whole(count, 0, MAX_PER_CATEGORY) and count or 0
      local category, parentCategory = categoryNames(categoryId, names)
      spend(1)
      for index = 1, count do
        if total >= C.Limits.achievements then
          -- Stopped at the limit is as far as a read goes: it counts as done, so a login does not start it again.
          stat(ctx, "achievement_stopped")
          ctx.achievementsDone = true
          return
        end
        local id, name, points, completed, month, day, year, _, _, _, _, isGuild, byMe = call("GetAchievementInfo", categoryId, index)
        spend(1)
        name = plain(name, 120)
        if category and name and whole(id, 1, MAX_ID) and not visited[id] and not isGuild then
          visited[id] = true
          total = total + 1
          local criteriaCount = call("GetAchievementNumCriteria", id)
          criteriaCount = whole(criteriaCount, 0, MAX_CRITERIA) and criteriaCount or 0
          spend(1)
          local criteria, met, quantity, required = {}, 0, nil, nil
          for ci2 = 1, criteriaCount do
            local text, _, done, have, need = call("GetAchievementCriteriaInfo", id, ci2)
            if done then met = met + 1 end
            local want = whole(need, 0, MAX_ID) and need or 0
            if ci2 <= MAX_CRITERIA_KEPT then criteria[#criteria + 1] = { text = plain(text, 120) or "", required = want } end
            -- A single criterion with a target above 1 is a progress bar: keep its amount.
            if criteriaCount == 1 and want > 1 and whole(have, 0, MAX_ID) then quantity, required = math.min(have, want), want end
            spend(1)
          end
          points = whole(points, 0, 1000) and points or 0
          put(ctx, "achievement_catalog", {
            kind = "achievement_catalog", achievementId = id, name = name, categoryId = categoryId,
            category = category, parentCategory = parentCategory, points = points,
            criteriaCount = criteriaCount, criteria = criteria,
          })
          stat(ctx, "achievement_read")
          if identity then
            local done = completed and true or false
            if done or met > 0 or (quantity and quantity > 0) then
              local earnedByMe, when
              if done then earnedByMe = byMe and true or false; when = earnedOn(month, day, year) end
              put(ctx, "achievement_owned", {
                kind = "achievement_owned", characterKey = identity.key, class = identity.class, level = identity.level,
                achievementId = id, completed = done, earnedByMe = earnedByMe, earnedOn = when,
                criteriaMet = met, criteriaTotal = criteriaCount, quantity = quantity, required = required,
              })
            end
          end
        end
      end
    end
  end
  -- A whole read finished: this build's catalog is recorded, and this character's progress is fresh.
  ctx.achievementsDone = true
end

local function readReputation(ctx, own, identity, spend)
  local count = call("C_Reputation.GetNumFactions")
  if not whole(count, 0, MAX_FACTIONS) then stat(ctx, "reputation_unreadable"); return end
  local header
  local collapsed = 0
  local hasMajor = type(resolve("C_Reputation.IsMajorFaction")) == "function"
  for index = 1, count do
    local data = call("C_Reputation.GetFactionDataByIndex", index)
    spend(1)
    if type(data) == "table" then
      local isHeader = data.isHeader and true or false
      if isHeader and data.isCollapsed then collapsed = collapsed + 1 end
      local name = plain(data.name, 80)
      local id = data.factionID
      if isHeader and not data.isHeaderWithRep then
        header = name
      elseif name and whole(id, 1, MAX_ID) then
        local parent = data.isChild and header or nil
        -- A header that carries its own standing is a faction and also the header of the rows under it.
        if isHeader then header = name end
        local major = hasMajor and call("C_Reputation.IsMajorFaction", id) and true or nil
        put(ctx, "reputation_catalog", { kind = "reputation_catalog", factionId = id, name = name, header = parent, major = major })
        stat(ctx, "reputation_read")
        local reaction, standing, floor, ceiling = data.reaction, data.currentStanding, data.currentReactionThreshold, data.nextReactionThreshold
        if identity and not major and whole(reaction, 1, 20) and whole(standing, -1000000, 10000000)
          and whole(floor, -1000000, 10000000) and whole(ceiling, -1000000, 10000000) and floor <= ceiling then
          put(ctx, "reputation_owned", {
            kind = "reputation_owned", characterKey = identity.key, class = identity.class, level = identity.level,
            factionId = id, reaction = reaction, standing = standing, floor = floor, ceiling = ceiling,
          })
        end
      end
    end
  end
  ctx.collapsed = collapsed
end

local function readTitles(ctx, own, identity, spend)
  local count = call("GetNumTitles")
  if not whole(count, 0, MAX_TITLES) then stat(ctx, "title_unreadable"); return end
  local fresh = {}
  for id = 1, count do
    local title = call("GetTitleName", id)
    spend(1)
    local name = plain(title, 80)
    if name then
      put(ctx, "title_catalog", { kind = "title_catalog", titleId = id, name = name })
      stat(ctx, "title_read")
    end
    if identity and call("IsTitleKnown", id) and not own.t[id] then fresh[#fresh + 1] = id end
  end
  if not identity then return end
  for first = 1, #fresh, MAX_IDS_PER_ROW do
    local ids = {}
    for i = first, math.min(first + MAX_IDS_PER_ROW - 1, #fresh) do ids[#ids + 1] = fresh[i] end
    if putAddition(ctx, "title_owned", {
      kind = "title_owned", characterKey = identity.key, class = identity.class, level = identity.level, titleIds = ids,
    }) then
      for _, id in ipairs(ids) do own.t[id] = true end
      stat(ctx, "title_owned")
    else
      break
    end
  end
end

local function readQuests(ctx, own, identity, spend, wantChains)
  local ids = call("C_QuestLog.GetAllCompletedQuestIDs")
  if type(ids) ~= "table" then stat(ctx, "quest_unreadable"); return end
  local fresh = {}
  for _, id in ipairs(ids) do
    if whole(id, 1, MAX_ID) and not own.q[id] then fresh[#fresh + 1] = id end
    spend(0.1)
  end
  -- Chains are looked up for quests not looked up yet: those newly completed, and those an earlier pass
  -- left over at its limit. Quests a finished lookup covered are not asked about again.
  if wantChains then
    local candidates = {}
    for _, id in ipairs(own.pending) do candidates[#candidates + 1] = id end
    for _, id in ipairs(fresh) do candidates[#candidates + 1] = id end
    local linked, lines, left = {}, 0, {}
    for _, id in ipairs(candidates) do
      if linked[id] then
        -- covered by a chain found earlier in this pass
      elseif lines >= MAX_CHAINS_PER_PASS then
        if #left < MAX_PENDING then left[#left + 1] = id end
      else
        local info = call("C_QuestLine.GetQuestLineInfo", id)
        spend(1)
        local lineId = type(info) == "table" and info.questLineID
        if whole(lineId, 1, MAX_ID) and not indexOf(ctx, "quest_chain_catalog")[tostring(lineId)] then
          local members = call("C_QuestLine.GetQuestLineQuests", lineId)
          spend(1)
          local name = plain(info.questLineName, 120)
          if name and type(members) == "table" and #members > 0 then
            local list = {}
            for _, member in ipairs(members) do
              if whole(member, 1, MAX_ID) then
                linked[member] = true
                if #list < MAX_CHAIN_QUESTS then list[#list + 1] = member end
              end
            end
            if #list > 0 then
              lines = lines + 1
              put(ctx, "quest_chain_catalog", {
                kind = "quest_chain_catalog", questLineId = lineId, name = name, questIds = list,
                truncated = (#members > MAX_CHAIN_QUESTS) or nil,
              })
              stat(ctx, "chain_read")
            end
          end
        end
      end
    end
    own.pending = left
  end
  if not identity then return end
  for first = 1, #fresh, MAX_IDS_PER_ROW do
    local batch = {}
    for i = first, math.min(first + MAX_IDS_PER_ROW - 1, #fresh) do batch[#batch + 1] = fresh[i] end
    if putAddition(ctx, "quest_owned", {
      kind = "quest_owned", characterKey = identity.key, class = identity.class, level = identity.level, questIds = batch,
    }) then
      for _, id in ipairs(batch) do own.q[id] = true end
      stat(ctx, "quest_owned", #batch)
    else
      break
    end
  end
end

-- ---------------------------------------------------------------------------------------------
-- Scheduling

local state = { running = false, again = false, pending = false, epoch = 0, combat = false, waiting = false, started = false,
  warned = {}, dirty = {}, ready = {}, missing = {}, last = nil }
C.State = state

--- Say in chat, once per session, that a limit stopped recording. The status note repeats it until the next /reload.
local function warn(name, text)
  if state.warned[name] then return end
  state.warned[name] = true
  print("Everloot: " .. text)
end

local function warnLimits(ctx)
  if ctx.full then
    warn("bytes", "completion data reached its size budget (about " .. math.floor(C.Limits.bytes / 1000) .. " KB); nothing more is recorded. Upload your file, then /everloot completion off clears it.")
  end
  for kind in pairs(ctx.capped) do
    if kind:find("per character", 1, true) then
      warn(kind, "this character reached " .. C.Limits.perCharacter .. " " .. kind:gsub(" %(per character%)", "") .. " rows; newer progress is not recorded.")
    end
  end
  if ctx.stats.achievement_stopped then
    warn("achievements", "completion read the first " .. C.Limits.achievements .. " achievements and stopped there.")
  end
end

local function summary(ctx)
  local s = ctx.stats
  local out = {}
  local function part(label, read, rows, owned)
    if s[read .. "_unreadable"] then out[#out + 1] = label .. ": unreadable"
    elseif s[read .. "_read"] or rows ~= nil then
      local text = label .. ": " .. (s[read .. "_read"] or 0) .. " read, " .. (rows or 0) .. " new rows"
      if owned and owned > 0 then text = text .. " (+" .. owned .. " yours)" end
      out[#out + 1] = text
    end
  end
  if state.ready.achievements then part("achievements", "achievement", s.achievement_catalog, s.achievement_owned) end
  if state.ready.reputation then
    part("reputation", "reputation", s.reputation_catalog, s.reputation_owned)
    if ctx.collapsed and ctx.collapsed > 0 then
      out[#out] = out[#out] .. "; " .. ctx.collapsed .. " collapsed headers hide their factions, expand them in the reputation window and run /everloot completion"
    end
  end
  if state.ready.titles then part("titles", "title", s.title_catalog, s.title_owned) end
  if state.ready.quests then
    local text = "quests: " .. (s.quest_owned or 0) .. " newly completed"
    if state.ready.chains then text = text .. ", " .. (s.chain_read or 0) .. " chains found" end
    out[#out + 1] = text
  end
  for kind in pairs(ctx.capped) do out[#out + 1] = kind .. " paused at capacity" end
  if ctx.full then
    out[#out + 1] = "completion data reached its size budget (about " .. math.floor(C.Limits.bytes / 1000) .. " KB), nothing more is recorded; /everloot completion off clears it"
  end
  if s.achievement_stopped then out[#out + 1] = "achievements stopped at " .. C.Limits.achievements end
  return table.concat(out, "; ")
end

local function describe()
  local lines = {}
  local function domain(name, ready, missing)
    if ready then lines[#lines + 1] = name .. " ready"
    else lines[#lines + 1] = name .. " unavailable, missing " .. table.concat(missing, ", ") .. " (records nothing)" end
  end
  domain("achievements", state.ready.achievements, state.missing.achievements or {})
  domain("reputation", state.ready.reputation, state.missing.reputation or {})
  domain("titles", state.ready.titles, state.missing.titles or {})
  domain("quests", state.ready.quests, state.missing.quests or {})
  if state.ready.quests and not state.ready.chains then
    lines[#lines + 1] = "quest chains unavailable, missing " .. table.concat(state.missing.chains or {}, ", ") .. " (records no chains)"
  end
  if #(state.missing.player or {}) > 0 then
    lines[#lines + 1] = "your progress not recorded, missing " .. table.concat(state.missing.player, ", ") .. " (catalogs only)"
  end
  return table.concat(lines, "; ")
end

--- The build and addon version the achievement catalog is recorded for.
local function catalogKey()
  return tostring(EverlootDB.clientBuild) .. "|" .. E.VERSION
end

local function body(domains, finish)
  local used = 0
  local epoch = state.epoch
  local function spend(n)
    used = used + n
    if used >= BUDGET then
      used = 0
      coroutine.yield()
      -- Withdrawn while this read was waiting for the next frame: write nothing more.
      if state.epoch ~= epoch then error("withdrawn", 0) end
    end
  end
  return coroutine.create(function()
    -- Withdrawn before it ever ran (off, then on again while it waited out combat): it writes nothing.
    if state.epoch ~= epoch then return end
    local ctx = newContext()
    local seen = seenTable()
    local key, class, level = C.Identity()
    local identity = key and { key = key, class = class, level = level } or nil
    local own = identity and ownedSeen(seen, key) or { t = {}, q = {}, pending = {} }
    -- A character not seen for months (deleted, most likely) stops costing file space in the seen state.
    for other, entry in pairs(seen.own) do
      if other ~= key and type(entry) == "table" and type(entry.seenAt) == "number" and time() - entry.seenAt >= FORGET_CHARACTER_SECONDS then seen.own[other] = nil end
    end
    if identity then own.seenAt = time() end
    -- A login asks for achievements only when due; that is decided here, out of combat, not in the event.
    if (domains.achievements or (domains.achievementsIfDue and C.AchievementsDue())) and state.ready.achievements then
      readAchievements(ctx, own, identity, spend)
      if ctx.achievementsDone then
        seen.catalogKey = catalogKey()
        if identity then own.achievedAt = time() end
      end
    end
    if domains.reputation and state.ready.reputation then readReputation(ctx, own, identity, spend) end
    if domains.titles and state.ready.titles then readTitles(ctx, own, identity, spend) end
    if domains.quests and state.ready.quests then readQuests(ctx, own, identity, spend, state.ready.chains) end
    compact(ctx)
    finish(ctx)
  end)
end

--- In combat from PLAYER_REGEN_DISABLED until PLAYER_REGEN_ENABLED, or while the lockdown says so.
local function inCombat()
  return state.combat or (type(InCombatLockdown) == "function" and InCombatLockdown() and true or false)
end

local pump

--- Pick up a pass that combat paused. Both the end of combat and the retry timer call this; only the first one resumes.
local function resume()
  if not state.waiting then return end
  state.waiting = false
  pump()
end

local function startPass()
  state.pending = false
  if not E:IsEnabled("completion") then state.dirty = {}; return end
  if state.running then state.again = true; return end
  local domains = state.dirty
  state.dirty = {}
  state.running = true
  local failed
  local co = body(domains, function(ctx)
    warnLimits(ctx)
    state.last = summary(ctx)
    E:SetNote("completion", state.last ~= "" and state.last or describe())
  end)
  pump = function()
    -- Off, or in combat: a pass that is mid-way waits here, between frames, and picks up when it can.
    if not E:IsEnabled("completion") then state.running = false; return end
    if inCombat() then state.waiting = true; C_Timer.After(COMBAT_RETRY_SECONDS, resume); return end
    local ok, err = coroutine.resume(co)
    if not ok then failed = tostring(err) end
    if failed or coroutine.status(co) == "dead" then
      state.running = false
      if failed then E:SetNote("completion", "stopped: " .. failed) end
      if state.again then state.again = false; C.Schedule({}) end
    else
      C_Timer.After(0, pump)
    end
  end
  pump()
end

--- Mark domains dirty and read once after the events settle. Nothing is scheduled while the module is off.
function C.Schedule(domains, delay)
  if not E:IsEnabled("completion") then return end
  for name in pairs(domains or { achievements = true, reputation = true, titles = true, quests = true }) do state.dirty[name] = true end
  if state.pending then return end
  state.pending = true
  C_Timer.After(delay or DEBOUNCE_SECONDS, startPass)
end

--- A login re-reads the achievements only when this build's catalog is not recorded yet, or this
--- character's progress is a week old (or was never read). Other times: on ACHIEVEMENT_EARNED, or on request.
function C.AchievementsDue()
  local seen = EverlootDB.completionSeen
  if type(seen) ~= "table" or seen.catalogKey ~= catalogKey() then return true end
  local key = C.Identity()
  local own = key and type(seen.own) == "table" and seen.own[key]
  if not own then return key ~= nil end
  return type(own.achievedAt) ~= "number" or time() - own.achievedAt >= ACHIEVEMENT_REFRESH_SECONDS
end

--- Read now, from /everloot completion.
function C.ReadNow()
  if not E:IsEnabled("completion") then
    print("Everloot: the completion module is off. /everloot completion on, then /reload.")
    return
  end
  -- Turned on in this session: the module starts at the next /reload, not before.
  if not state.started then print("Everloot: the completion tracker is on; /reload to start it.") return end
  if not state.ready.timer then print("Everloot: completion needs C_Timer.After, which this client lacks.") return end
  print("Everloot: reading achievements, reputation, titles and quests across the next few seconds.")
  C.Schedule(nil, 0)
end

--- /everloot completion off: withdraw everything this module wrote.
function C.Withdraw()
  state.epoch = state.epoch + 1
  state.dirty = {}
  for _, kind in ipairs(KINDS) do
    EverlootDB.records[kind] = nil
    if EverlootDB.paused then EverlootDB.paused[kind] = nil end
  end
  EverlootDB.completionSeen = nil
end

E:RegisterModule("completion", function()
  state.started = true
  for name, paths in pairs(API) do
    state.missing[name] = absent(paths)
    state.ready[name] = #state.missing[name] == 0
  end
  if not state.ready.timer then error("missing C_Timer.After (reads are chunked across frames), records nothing", 0) end
  local any = state.ready.achievements or state.ready.reputation or state.ready.titles or state.ready.quests
  if not any then error(describe(), 0) end
  local f = E.frame
  local map = {
    PLAYER_ENTERING_WORLD = { achievementsIfDue = true, reputation = true, titles = true, quests = true },
    ACHIEVEMENT_EARNED = { achievements = true },
    UPDATE_FACTION = { reputation = true },
    FACTION_STANDING_CHANGED = { reputation = true },
    KNOWN_TITLES_UPDATE = { titles = true },
    QUEST_TURNED_IN = { quests = true },
  }
  local watched = {}
  for event, domains in pairs(map) do
    if pcall(function() f:RegisterEvent(event) end) then watched[event] = domains end
  end
  -- Combat pauses a pass between frames; its end resumes it on the next frame instead of at the retry.
  local combatWatched = {}
  for _, event in ipairs({ "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED" }) do
    if pcall(function() f:RegisterEvent(event) end) then combatWatched[event] = true end
  end
  f:HookScript("OnEvent", function(_, event)
    if combatWatched[event] then
      state.combat = event == "PLAYER_REGEN_DISABLED"
      if not state.combat and state.waiting then C_Timer.After(0, resume) end
      return
    end
    local domains = watched[event]
    if not domains then return end
    -- The events stay registered for the session; an off module ignores them.
    if not E:IsEnabled("completion") then return end
    C.Schedule(domains)
  end)
  return "ready: " .. describe() .. " (off: /everloot completion off)"
end)
