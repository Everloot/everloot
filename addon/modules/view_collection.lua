-- Everloot window, Collection: achievements, reputation, titles, quest chains, dungeons and raids with their bosses'
-- drops, mounts, battle pets and toys, drawn as completionist addons draw them: a tree of headings that open and close,
-- each with how much of it is done, an icon on each row, a green check for done and a red cross for missing.
-- The lists are the catalog rows the completion tracker (completion.lua) wrote; titles, lockouts and boss kills are the
-- rows it and owned.lua wrote, read through Everloot:Rows. Achievements, reputation, completed quests, mounts, pets and
-- toys are not recorded: they are read from the game when the view draws, so they are this character's only. A boss's
-- drops are the public drop rates the Desktop App wrote into the price file (drops.lua), from the creatures this
-- install saw in that encounter or, failing that, the creatures the file names as the boss is named; whether a drop is
-- collected (its mount, pet, toy or appearance) is read from the game. This character by default; Account joins every
-- character in the roster (roster.lua) for titles, lockouts and boss kills, and names the one that holds each item.
-- Display only: it reads, the one button runs /everloot completion on, the command the player could type, and
-- nothing here records. It registers no events; the window builds it the first time Collection is opened.

local E = Everloot
if not (E.Window and E.Window.Views) then return end
local U = E.Window
local COLORS, text, surface = U.COLORS, U.Text, U.Surface

local W = 604          -- the view frame window.lua gives every view (W - MAIN - 12 wide)
local ROWS, ROW_H = 12, 18
-- Two rows of section buttons: { key, label, width }.
local SECTIONS = { { "achievements", "Achievements", 100 }, { "reputation", "Reputation", 92 }, { "titles", "Titles", 62 },
  { "quests", "Quests", 66 }, { "raids", "Dungeons & raids", 140, true }, { "mounts", "Mounts", 72 }, { "pets", "Pets", 60 },
  { "toys", "Toys", 60 } }
local SCOPES = { { "character", "This character", 110 }, { "account", "Account", 80 } }
local EXALTED = 8
local OFF_TEXT = "The completion tracker reads the game's achievement, reputation, title and quest chain lists, and records "
  .. "the titles you hold, this week's raid lockouts and your boss kills, never writing back. This page shows your "
  .. "achievements, reputation and quests from the game as it draws; they are not recorded. The lists and your titles leave "
  .. "from the upload page; lockouts and boss kills never go in an upload."
local TURNED_ON = "Turned on. /reload to start reading."
local NOTHING_READ = "Nothing read yet. Open the achievements, reputation or titles window, then /reload."
local NO_CHAINS = "No quest chains read yet. They are read at login and each time you turn in a quest."
local NOTHING_MISSING = "Nothing missing here."
local NO_KEY = "This character cannot be identified yet."
local NO_MOUNTS = "The game lists no mounts on this client."
local NO_PETS = "The Pet Journal lists no pets here. Open it once (Collections), clear its filters, then come back."
local NO_TOYS = "The Toy Box lists no toys here. Open it once (Collections), clear its filters, then come back."
-- The columns: the name after the indent, the open/close button and the icon; the detail from DETAIL_X, narrower
-- beside a bar; the mark at the right edge.
local INDENT, NAME_END, DETAIL_X = 14, 296, 304
local DETAIL_W, DETAIL_WIDE = 140, 262
-- The game's ready-check marks, as completionist lists draw them: a green check for done, a red cross for missing.
local DONE_MARK, MISSING_MARK = "Interface\\RaidFrame\\ReadyCheck-Ready", "Interface\\RaidFrame\\ReadyCheck-NotReady"
local OPEN_BUTTON, CLOSED_BUTTON = "Interface\\Buttons\\UI-MinusButton-Up", "Interface\\Buttons\\UI-PlusButton-Up"
local GOLD = { 1, 0.82, 0, 1 } -- the game's heading yellow (GameFontNormal)
local QUESTION = "Interface\\Icons\\INV_Misc_QuestionMark"

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
-- " (75%)" after a count, as completionist lists write it; nothing when there is nothing to count.
local function percent(n, total) return total > 0 and (" (" .. math.floor(n * 100 / total) .. "%)") or "" end

-- The `n`th value a game call returns; nil when the call is missing or errors.
local function nth(n, fn, ...)
  if type(fn) ~= "function" then return nil end
  local result = { pcall(fn, ...) }
  if not result[1] then return nil end
  return result[n + 1]
end

-- The game's source text on one line, without its colour codes and line breaks.
local function plain(s)
  if type(s) ~= "string" then return "" end
  return (s:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("|n", " "):gsub("%s+", " "):gsub("^ ", ""):gsub(" $", ""))
end

-- An item as the client knows it now: its name, icon and quality colour. The name may not be cached yet; the client
-- is asked for it, twice at most per item, and the view draws again a moment later.
local pendingNames, asked = false, {}
local function itemFacts(itemId)
  local name, quality, icon
  if type(GetItemInfo) == "function" then
    local ok, n, _, q, _, _, _, _, _, _, t = pcall(GetItemInfo, itemId)
    if ok then name, quality, icon = n, q, t end
  end
  icon = icon or nth(5, C_Item and C_Item.GetItemInfoInstant, itemId) or nth(5, GetItemInfoInstant, itemId)
  asked[itemId] = not name and (asked[itemId] or 0) + 1 or nil
  if asked[itemId] and asked[itemId] <= 2 then
    if C_Item and type(C_Item.RequestLoadItemDataByID) == "function" then pcall(C_Item.RequestLoadItemDataByID, itemId) end
    if not pendingNames and C_Timer and C_Timer.After then
      pendingNames = true
      C_Timer.After(1, function()
        pendingNames = false
        if U.frame and U.frame:IsShown() and U.view == "collection" then pcall(refresh, U.frame) end
      end)
    end
  end
  local color = type(quality) == "number" and type(ITEM_QUALITY_COLORS) == "table" and ITEM_QUALITY_COLORS[quality]
  return name or ("Item " .. itemId), icon, color and { color.r, color.g, color.b, 1 } or nil
end

-- Whether this character has an item's collectible, read from the game: its mount, battle pet, toy or appearance.
-- Nil when the item is none of those, or the game cannot say.
local function collected(itemId)
  local MJ, PJ, TB, TC = C_MountJournal, C_PetJournal, C_ToyBox, C_TransmogCollection
  local mountId = MJ and nth(1, MJ.GetMountFromItem, itemId)
  if mountId then
    local has = nth(11, MJ.GetMountInfoByID, mountId)
    if type(has) == "boolean" then return has end
  end
  local species = PJ and nth(13, PJ.GetPetInfoByItemID, itemId)
  if species then
    local owned = nth(1, PJ.GetNumCollectedInfo, species)
    if type(owned) == "number" then return owned > 0 end
  end
  if TB and type(nth(2, TB.GetToyInfo, itemId)) == "string" then -- a toy has a toy name
    local has = nth(1, PlayerHasToy, itemId)
    if type(has) == "boolean" then return has end
  end
  local source = TC and nth(2, TC.GetItemInfo, itemId)
  if source then
    local has = nth(1, TC.PlayerHasTransmogItemModifiedAppearance, source)
    if type(has) == "boolean" then return has end
  end
  return nil
end

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

-- The summary of a section read from the game: in the account scope it says the list is this character's.
local function live(summary, s)
  return s.holder and (summary .. " · this character") or summary
end

-- Each key's ids from the list-of-ids rows of one kind (titles): [key][id] = true.
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

-- Each section returns its items, in order, and its summary line. An item is { name, detail, done, heading, depth,
-- icon, color, itemId, spellId, achievementId, bar = { floor, ceiling, standing } }. `done` true draws a check and
-- false a cross; an information line leaves it nil and draws neither. A heading opens and closes the items under it
-- (those after it with a greater `depth`, 0 when left out); `open` is whether it starts open.
-- In the account scope an item is done when any key holds it; the first key in scope order that does is named.
-- Achievements, reputation and quests are read from the game, so they are this character's (s.keys[1]) in either scope.
local function achievements(s)
  local C, me = E.Completion, s.keys[1]
  local items, done, points = {}, 0, 0
  for _, a in ipairs(E:Rows("achievement_catalog")) do
    if type(a) == "table" then
      local completed, when
      if C and C.Achievement then completed, when = C.Achievement(a.achievementId) end
      local pts = number(a.points) and a.points or nil
      local item = { name = name(a.name), detail = (pts or "-") .. " pts · " .. name(a.category), done = completed == true,
        icon = nth(10, GetAchievementInfo, a.achievementId), achievementId = a.achievementId }
      if item.done then
        done, points = done + 1, points + (pts or 0)
        item.when = when
        if item.when then item.detail = item.detail .. " · " .. item.when end
        item.detail = held(item.detail, s, me)
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
  return items, live("Achievements: " .. done .. " of " .. #items .. percent(done, #items) .. " · " .. points .. " points", s)
end

-- A faction the reputation window does not list now (under a collapsed header) shows "-".
local function reputation(s)
  local C, me = E.Completion, s.keys[1]
  local standing = C and C.Standings and C.Standings() or {}
  local items, exalted = {}, 0
  for _, r in ipairs(E:Rows("reputation_catalog")) do
    if type(r) == "table" and not r.major then
      local o = standing[r.factionId]
      local item = { name = name(r.name), detail = "-", done = false }
      if o and number(o.standing) and number(o.floor) and number(o.ceiling) and o.floor <= o.ceiling then
        item.bar = { o.floor, o.ceiling, o.standing }
        item.detail = held(o.standing .. " / " .. o.ceiling, s, me)
      end
      if o and number(o.reaction) and o.reaction >= EXALTED then item.done, exalted = true, exalted + 1 end
      items[#items + 1] = item
    end
  end
  table.sort(items, byName)
  return items, live("Reputation: " .. #items .. (#items == 1 and " faction" or " factions") .. " · " .. exalted .. " exalted", s)
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
  return items, "Titles: " .. n .. " of " .. #items .. percent(n, #items)
end

-- The creatures a boss's drops are read from: those this install's own encounter rows saw in that encounter, else the
-- NPCs the drops block names as the boss is named. `how` says which, for the boss's detail line.
local function bossNpcs(instance, boss)
  local ids, seen = {}, {}
  for _, r in ipairs(E:Rows("encounter")) do
    if type(r) == "table" and r.encounterId == boss.id and r.instanceMapId == instance.id and type(r.npcIds) == "table" then
      for _, id in ipairs(r.npcIds) do
        if number(id) and not seen[id] then seen[id] = true; ids[#ids + 1] = id end
      end
    end
  end
  if #ids > 0 then return ids, "seen" end
  if E.NpcsNamed then return E:NpcsNamed(boss.name), "named" end
  return {}, "named"
end

-- One boss's drops as items under it (depth 3): each with its icon, name in its quality colour, the rate players
-- recorded and, for a mount, pet, toy or appearance, whether this character has it. Nil and the drops block's status
-- while the block cannot be read.
local function bossDrops(instance, boss)
  if not E.DropsFrom then return nil, "absent" end
  local ready, status = E:DropsFrom("npc", 0) -- the block's state, before any boss is looked up in it
  if not ready then return nil, status end
  local npcs, how = bossNpcs(instance, boss)
  local best, order = {}, {}
  for _, npc in ipairs(npcs) do
    local list, status = E:DropsFrom("npc", npc)
    if not list then return nil, status end
    for _, d in ipairs(list) do
      local kept = best[d.itemId]
      if not kept then order[#order + 1] = d.itemId end
      if not kept or d.drops / d.windows > kept.drops / kept.windows then best[d.itemId] = d end
    end
  end
  table.sort(order, function(a, b)
    local ra, rb = best[a].drops / best[a].windows, best[b].drops / best[b].windows
    if ra ~= rb then return ra > rb end
    return a < b
  end)
  local items = {}
  for _, itemId in ipairs(order) do
    local d = best[itemId]
    local label, icon, color = itemFacts(itemId)
    items[#items + 1] = { name = label, icon = icon or QUESTION, color = color, itemId = itemId, depth = 3, done = collected(itemId),
      detail = string.format("%.1f%% · %d of %d loot windows", 100 * d.drops / d.windows, d.drops, d.windows) }
  end
  return items, "ready", how
end

-- What the summary says about drops while the block cannot be read.
local DROPS_STATUS = { absent = "drops: not in the price file yet (the Desktop App writes it)",
  verifying = "drops: checking the price file", bad = "drops: the price file failed its checksum" }

-- The shipped player agreement gates instances; personal kills never change that public catalog.
local function raids(s)
  local data = E.InstanceData or { instances = {}, asOf = "unknown" }
  local now = date("!%Y-%m-%dT%H:%M:%SZ", time())
  local keys = {}
  for _, key in ipairs(s.keys) do keys[key] = true end
  local items, listed, dropStatus = {}, {}, nil
  for _, group in ipairs({ "Dungeons", "Raids", "World bosses" }) do
    items[#items + 1] = { name = group, detail = group == "World bosses" and "Found in game files, unconfirmed" or "Agreed by players",
      heading = true, key = "group:" .. group, open = true, depth = 0 }
    local instances = {}
    for _, instance in ipairs(data.instances) do
      if instance.group == group then instances[#instances + 1] = instance end
    end
    table.sort(instances, byName)
    for _, instance in ipairs(instances) do
      items[#items + 1] = { name = instance.name, detail = instance.unconfirmed and "Unconfirmed" or "", heading = true,
        key = "instance:" .. instance.id, open = true, depth = 1 }
      for _, r in ipairs(E:Rows("lockout_owned")) do
        if keys[r.characterKey] and (r.instanceId == instance.id or r.instance == instance.name)
          and type(r.resetAt) == "string" and r.resetAt > now then
          listed[r] = true
          local day, hour = r.resetAt:match("^(%d+%-%d+%-%d+)T(%d+:%d+)")
          items[#items + 1] = { name = "This week's lockout", depth = 2, detail = held((r.bossesKilledCount or "-") .. " of "
            .. (r.bossesTotal or "-") .. " / resets " .. (day and (day .. " " .. hour .. " UTC") or r.resetAt), s, r.characterKey) }
        end
      end
      for _, boss in ipairs(instance.bosses) do
        local kill
        -- The most recent kill across the scope gives both the date and the holder, including across difficulties.
        for _, r in ipairs(E:Rows("boss_kill_owned")) do
          if keys[r.characterKey] and r.instanceMapId == instance.id and r.encounterId == boss.id
            and type(r.lastKillAt) == "string" and (not kill or r.lastKillAt > kill.lastKillAt) then kill = r end
        end
        local item = { name = boss.name, done = kill ~= nil, depth = 2,
          detail = kill and held("Last killed " .. kill.lastKillAt:sub(1, 10), s, kill.characterKey) or "No kill recorded" }
        items[#items + 1] = item
        -- Its drops, closed until the boss is opened. A boss with none recorded is a plain row.
        local drops, status, how = bossDrops(instance, boss)
        if not drops then dropStatus = status
        elseif #drops > 0 then
          item.heading, item.key, item.own = true, "boss:" .. instance.id .. ":" .. boss.id, true
          item.tip = how == "seen" and "Drops recorded by players from the creatures you saw in this fight"
            or "Drops recorded by players from an NPC named " .. boss.name
          for _, d in ipairs(drops) do items[#items + 1] = d end
        end
      end
    end
    if #instances == 0 then items[#items + 1] = { name = "No agreed instances yet", detail = "", depth = 1 } end
  end
  -- A lockout the game reports for an instance players have not agreed on yet is still this character's: it is
  -- listed on its own, as the Raids section did before, rather than dropped.
  local other = {}
  for _, r in ipairs(E:Rows("lockout_owned")) do
    if keys[r.characterKey] and not listed[r] and type(r.resetAt) == "string" and r.resetAt > now then
      local day, hour = r.resetAt:match("^(%d+%-%d+%-%d+)T(%d+:%d+)")
      other[#other + 1] = { depth = 1, name = name(r.instance) .. (type(r.difficulty) == "string" and (" / " .. r.difficulty) or ""),
        detail = held((r.bossesKilledCount or "-") .. " of " .. (r.bossesTotal or "-") .. " / resets "
          .. (day and (day .. " " .. hour .. " UTC") or r.resetAt), s, r.characterKey),
        done = number(r.bossesKilledCount) and number(r.bossesTotal) and r.bossesKilledCount >= r.bossesTotal or false }
    end
  end
  if #other > 0 then
    table.sort(other, byName)
    items[#items + 1] = { name = "Other lockouts this week", detail = "Not on the agreed list yet", heading = true,
      key = "other", open = true, depth = 0 }
    for _, item in ipairs(other) do items[#items + 1] = item end
  end
  return items, "Dungeons & raids / as of " .. data.asOf:sub(1, 10) .. (dropStatus and (" · " .. DROPS_STATUS[dropStatus]) or "")
end

-- Every mount the game lists for this character, by name, with where it comes from. A mount the game hides for this
-- character (the other faction's) is left out unless it is collected.
local function mounts(s)
  local MJ = C_MountJournal
  local ids = MJ and nth(1, MJ.GetMountIDs)
  local items, n = {}, 0
  for _, id in ipairs(type(ids) == "table" and ids or {}) do
    local r = { pcall(MJ.GetMountInfoByID, id) }
    local label, spellId, icon, hidden, has = r[2], r[3], r[4], r[11], r[12]
    if r[1] and type(label) == "string" and (has or not hidden) then
      local item = { name = label, icon = icon, spellId = spellId, done = has == true,
        detail = plain(nth(3, MJ.GetMountInfoExtraByID, id)) }
      if item.done then n = n + 1 end
      items[#items + 1] = item
    end
  end
  table.sort(items, byName)
  return items, live("Mounts: " .. n .. " of " .. #items .. percent(n, #items), s)
end

-- The battle pets the Pet Journal lists under its own filters, one row per species, by name.
local function pets(s)
  local PJ = C_PetJournal
  local count = PJ and nth(1, PJ.GetNumPets)
  local items, bySpecies, n = {}, {}, 0
  for i = 1, number(count) and count or 0 do
    local r = { pcall(PJ.GetPetInfoByIndex, i) }
    local species, owned, label, icon, source = r[3], r[4], r[9], r[10], r[13]
    if r[1] and species and type(label) == "string" then
      local item = bySpecies[species]
      if not item then
        item = { name = label, icon = icon, done = false, detail = plain(source) }
        bySpecies[species] = item
        items[#items + 1] = item
      end
      if owned and not item.done then item.done, n = true, n + 1 end
    end
  end
  table.sort(items, byName)
  return items, live("Pets: " .. n .. " of " .. #items .. " species" .. percent(n, #items) .. " · as the Pet Journal's filters list them", s)
end

-- The toys the Toy Box lists under its own filters, by name.
local function toys(s)
  local TB = C_ToyBox
  local count = TB and nth(1, TB.GetNumFilteredToys)
  local items, n = {}, 0
  for i = 1, number(count) and count or 0 do
    local itemId = nth(1, TB.GetToyFromIndex, i)
    if number(itemId) and itemId > 0 then
      local r = { pcall(TB.GetToyInfo, itemId) }
      local label, icon = r[1] and r[3], r[1] and r[4]
      local has = nth(1, PlayerHasToy, itemId) == true
      local fallback, fallbackIcon, color = itemFacts(itemId)
      items[#items + 1] = { name = type(label) == "string" and label or fallback, icon = icon or fallbackIcon, color = color,
        itemId = itemId, done = has, detail = "" }
      if has then n = n + 1 end
    end
  end
  table.sort(items, byName)
  return items, live("Toys: " .. n .. " of " .. #items .. percent(n, #items) .. " · as the Toy Box's filters list them", s)
end

-- One row per chain the tracker read: this character's quests done of its total, from the game's list of completed
-- quests. A chain the tracker cut at its quest limit ("+") is never counted complete.
local function quests(s)
  local C, me = E.Completion, s.keys[1]
  local completed = C and C.CompletedQuests and C.CompletedQuests() or {}
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
  for id in pairs(completed) do
    for _, c in ipairs(byQuest[id] or {}) do counts[c] = (counts[c] or 0) + 1 end
  end
  local items, complete = {}, 0
  for c, q in ipairs(chains) do
    local total, n = #q.questIds, counts[c] or 0
    local item = { name = name(q.name), done = n >= total and not q.truncated, bar = { 0, total, n } }
    item.detail = held(n .. " of " .. total .. (q.truncated and "+" or ""), s, n > 0 and me or nil)
    if item.done then complete = complete + 1 end
    items[#items + 1] = item
  end
  table.sort(items, byName)
  return items, live("Quests: " .. complete .. " of " .. #items .. (#items == 1 and " chain" or " chains") .. " complete"
    .. percent(complete, #items), s)
end

local READ = { achievements = achievements, reputation = reputation, titles = titles, raids = raids, quests = quests,
  mounts = mounts, pets = pets, toys = toys }
local EMPTY = { quests = NO_CHAINS, mounts = NO_MOUNTS, pets = NO_PETS, toys = NO_TOYS }

-- Each heading's count of the marked items under it, as completionist lists show it ("3 / 8 (37%)"), added to its
-- detail. A heading's own mark (a boss's kill) counts for the headings above it, not its own.
local function count(items)
  local stack = {}
  local function close(depth)
    while #stack > 0 and stack[#stack].depth >= depth do
      local h = table.remove(stack)
      if h.total > 0 then
        local tally = h.done_ .. " / " .. h.total .. percent(h.done_, h.total)
        h.item.detail = (h.item.detail ~= "" and h.item.detail and (h.item.detail .. " · ") or "") .. tally
        h.item.left = h.total - h.done_
      end
    end
  end
  for _, item in ipairs(items) do
    local depth = item.depth or 0
    close(depth)
    if item.done ~= nil then
      for _, h in ipairs(stack) do
        h.total = h.total + 1
        if item.done then h.done_ = h.done_ + 1 end
      end
    end
    if item.heading then stack[#stack + 1] = { item = item, depth = depth, total = 0, done_ = 0 } end
  end
  close(-1)
end

-- The items to draw: those under a closed heading are left out, and with Missing only, every done item and every
-- heading with nothing missing under it.
local function visible(items, open, missing)
  local out, hideBelow = {}, nil
  for _, item in ipairs(items) do
    local depth = item.depth or 0
    if hideBelow and depth <= hideBelow then hideBelow = nil end
    local finished = item.done == true
    -- A heading is finished when nothing under it is missing and its own mark (a boss's kill) is not either.
    if item.heading and item.left then finished = item.left == 0 and item.done ~= false end
    local skip = hideBelow ~= nil or (missing and finished)
    if not skip then
      out[#out + 1] = item
      if item.heading then
        local isOpen = open[item.key]
        if isOpen == nil then isOpen = item.open == true end
        item.isOpen = isOpen
        if not isOpen then hideBelow = depth end
      end
    elseif not hideBelow and item.heading then
      hideBelow = depth -- a heading Missing only hides takes everything under it along
    end
  end
  return out
end

local function draw(row, item)
  local x = 4 + (item.depth or 0) * INDENT
  row.item = item
  if item.heading then
    row.toggle:SetTexture(item.isOpen and OPEN_BUTTON or CLOSED_BUTTON)
    row.toggle:SetPoint("LEFT", x, 0)
    row.toggle:Show()
  else
    row.toggle:Hide()
  end
  if item.icon then
    row.icon:SetTexture(item.icon)
    row.icon:SetPoint("LEFT", x + 16, 0)
    row.icon:Show()
  else
    row.icon:Hide()
  end
  local nameX = x + 16 + (item.icon and 20 or 0)
  row.name:SetPoint("LEFT", nameX, 0)
  row.name:SetWidth(NAME_END - nameX)
  row.name:SetText(item.name)
  row.name:SetTextColor(unpack(item.color or (item.heading and GOLD) or COLORS.text))
  row.detail:SetText(item.detail or "")
  if item.done == nil then row.done:Hide()
  else row.done:SetTexture(item.done and DONE_MARK or MISSING_MARK); row.done:Show() end
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

-- Fills the list from `items` at its offset, held so the last row stays at the bottom. With no items, the empty line.
local function show(rows, items, empty)
  local n = #items
  rows.offset = math.max(0, math.min(rows.offset, n - ROWS))
  for i, row in ipairs(rows) do
    local item = items[rows.offset + i]
    if item then draw(row, item); row:Show() else row.item = nil; row:Hide() end
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
    -- Scrolling, opening a heading and Missing only reuse the section as last read; anything else reads it again.
    local cache = c.cache
    if not (c.soft and cache and cache.section == c.section and cache.scope == c.scope and cache.key == key) then
      local all, said = READ[c.section](scopeFor(c.scope, key))
      count(all)
      cache = { section = c.section, scope = c.scope, key = key, items = all, summary = said }
      c.cache = cache
    end
    items, summary = cache.items, cache.summary
    empty = EMPTY[c.section] or NOTHING_READ
    if #items > 0 then
      items = visible(items, c.open, c.missing)
      if c.missing and #items == 0 then empty = NOTHING_MISSING end
    end
  end
  c.soft = false
  c.summary:SetText(summary)
  show(c.rows, items, empty)
end

-- The game's tooltip for what a row holds: the item (with Everloot's own lines), the mount's spell, the achievement.
local function tooltip(row)
  local item = row.item
  if not item or type(GameTooltip) ~= "table" then return end
  GameTooltip:SetOwner(row, "ANCHOR_RIGHT")
  if item.itemId and GameTooltip.SetItemByID then GameTooltip:SetItemByID(item.itemId)
  elseif item.spellId and GameTooltip.SetSpellByID then GameTooltip:SetSpellByID(item.spellId)
  elseif item.achievementId and type(GetAchievementLink) == "function" and GetAchievementLink(item.achievementId) then
    GameTooltip:SetHyperlink(GetAchievementLink(item.achievementId))
  else
    GameTooltip:AddLine(item.name, 1, 1, 1)
    if item.detail and item.detail ~= "" then GameTooltip:AddLine(item.detail, nil, nil, nil, true) end
  end
  if item.tip then GameTooltip:AddLine(item.tip, 0.788, 0.765, 0.69, true) end
  if item.heading then GameTooltip:AddLine(item.isOpen and "Click to close" or "Click to open", 0.788, 0.765, 0.69) end
  GameTooltip:Show()
end

local function build(f, parent)
  local c = { section = "achievements", scope = "character", missing = false, sections = {}, scopes = {}, open = {} }
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

  -- On: two rows of sections with the missing-only switch, the summary and the scope under them, then the list.
  c.onPage = CreateFrame("Frame", nil, parent)
  c.onPage:SetPoint("TOPLEFT", 0, 0)
  c.onPage:SetSize(W, 390)
  local x, line = 0, 0
  for _, s in ipairs(SECTIONS) do
    if s[4] then x, line = 0, line + 1 end
    c.sections[s[1]] = button(c.onPage, s[2], s[3], function() c.section = s[1]; c.rows.offset = 0 end)
    c.sections[s[1]]:SetPoint("TOPLEFT", x, -8 - line * 24)
    x = x + s[3] + 4
  end
  c.missingOnly = button(c.onPage, "Missing only", 100, function() c.missing = not c.missing; c.rows.offset = 0; c.soft = true end)
  c.missingOnly:SetPoint("TOPRIGHT", 0, -8)
  local right = 0
  for i = #SCOPES, 1, -1 do
    local s = SCOPES[i]
    c.scopes[s[1]] = button(c.onPage, s[2], s[3], function() c.scope = s[1]; c.rows.offset = 0 end)
    c.scopes[s[1]]:SetPoint("TOPRIGHT", -right, -60)
    right = right + s[3] + 4
  end
  c.summary = text(c.onPage, 13)
  c.summary:SetPoint("TOPLEFT", 4, -64)
  c.summary:SetWidth(W - 8 - right)

  local list = box(c.onPage, 0, -86, W, 260)
  local rows = { offset = 0 }
  for i = 1, ROWS do
    -- A row is a button: a heading opens and closes on a click, and every row shows the game's tooltip on hover.
    local row = CreateFrame("Button", nil, list)
    row:SetPoint("TOPLEFT", 4, -8 - (i - 1) * ROW_H)
    row:SetSize(W - 8, ROW_H)
    if row.SetHighlightTexture then
      row:SetHighlightTexture("Interface\\QuestFrame\\UI-QuestTitleHighlight", "ADD")
    end
    row.toggle = row:CreateTexture(nil, "ARTWORK")
    row.toggle:SetSize(14, 14)
    row.icon = row:CreateTexture(nil, "ARTWORK")
    row.icon:SetSize(16, 16)
    if row.icon.SetTexCoord then row.icon:SetTexCoord(0.08, 0.92, 0.08, 0.92) end
    row.name = text(row, 12)
    row.detail = text(row, 12)
    row.detail:SetPoint("LEFT", DETAIL_X, 0)
    for _, s in ipairs({ row.name, row.detail }) do if s.SetWordWrap then s:SetWordWrap(false) end end
    row.done = row:CreateTexture(nil, "ARTWORK")
    row.done:SetSize(14, 14)
    row.done:SetPoint("RIGHT", -6, 0)
    local bar = CreateFrame("StatusBar", nil, row)
    bar:SetPoint("LEFT", DETAIL_X + DETAIL_W + 6, 0)
    bar:SetSize(DETAIL_WIDE - DETAIL_W - 6, 6)
    bar:SetStatusBarTexture("Interface\\TargetingFrame\\UI-StatusBar")
    bar:SetStatusBarColor(unpack(COLORS.accent))
    local back = bar:CreateTexture(nil, "BACKGROUND")
    back:SetAllPoints()
    back:SetColorTexture(0.133, 0.137, 0.114, 1)
    row.bar = bar
    row:SetScript("OnClick", function(self)
      local item = self.item
      if not (item and item.heading and item.key) then return end
      c.open[item.key] = not item.isOpen
      c.soft = true
      redraw()
      tooltip(self)
    end)
    row:SetScript("OnEnter", tooltip)
    row:SetScript("OnLeave", function() if type(GameTooltip) == "table" then GameTooltip:Hide() end end)
    rows[i] = row
  end
  rows.empty = text(list, 12, nil, COLORS.muted)
  rows.empty:SetPoint("TOPLEFT", 8, -12)
  rows.empty:SetWidth(W - 16)
  rows.up = button(list, "Up", 48, function() rows.offset = math.max(0, rows.offset - ROWS); c.soft = true end)
  rows.up:SetPoint("BOTTOMRIGHT", -58, 6)
  rows.down = button(list, "Down", 48, function() rows.offset = rows.offset + ROWS; c.soft = true end)
  rows.down:SetPoint("BOTTOMRIGHT", -6, 6)
  -- The mouse wheel scrolls three rows at a time.
  if list.EnableMouseWheel then list:EnableMouseWheel(true) end
  list:SetScript("OnMouseWheel", function(_, delta)
    rows.offset = math.max(0, rows.offset - (tonumber(delta) or 0) * 3)
    c.soft = true
    redraw()
  end)
  c.rows = rows
end

U.Views.collection = { build = build, refresh = refresh }
