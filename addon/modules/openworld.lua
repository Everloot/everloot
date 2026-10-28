-- Everloot open-world collector: NPC sightings, loot windows, quests, vendors, items seen, minimap vignettes,
-- dungeon entrances and boss encounters.
-- Anonymous by design: no character or guild names, no chat. Matches the intake contract
-- (web/src/lib/intake.ts kinds: npc_sighting, loot, quest, vendor, item_seen, object_sighting, instance_entrance,
-- encounter).
-- NPC type, rank and a quest's category, group size, tag and faction are game facts about the NPC or quest.
-- The faction is the accepting character's side only; no character name is read or stored.

local E = Everloot

local function mapPosition()
  if C_Map and C_Map.GetPlayerMapPosition and C_Map.GetBestMapForUnit then
    local mapId = C_Map.GetBestMapForUnit("player")
    if not mapId then return nil end
    local pos = C_Map.GetPlayerMapPosition(mapId, "player")
    if not pos then return { mapId = mapId } end
    return { mapId = mapId, x = pos.x * 100, y = pos.y * 100 }
  end
  return nil
end

local npcIdFromGuid = E.NpcIdFromGuid

-- The object id in a game object GUID (GameObject-0-server-instance-zone-ID-spawn); nil for anything else.
local function objectIdFromGuid(guid)
  return type(guid) == "string" and tonumber(guid:match("^GameObject%-%d+%-%d+%-%d+%-%d+%-(%d+)%-")) or nil
end

-- True for an item GUID (Item-server-0-id): a disenchanted item or an opened container. The GUID does not hold
-- the item's id; see itemIdFromGuid.
local function isItemGuid(guid)
  return type(guid) == "string" and guid:find("^Item%-") ~= nil
end

-- A whole number from lo to hi, else nil.
local function whole(v, lo, hi)
  if type(v) == "number" and v == math.floor(v) and v >= lo and v <= hi then return v end
  return nil
end
local MAX_ID = 9007199254740991

-- The English creature types the protocol accepts. A localized client names them in its own language and
-- they do not match, so no type is recorded there rather than a guess.
local CREATURE_TYPES = {}
for _, t in ipairs({ "Beast", "Dragonkin", "Demon", "Elemental", "Giant", "Undead", "Humanoid", "Critter",
  "Mechanical", "Not specified", "Totem", "Non-combat Pet", "Gas Cloud" }) do CREATURE_TYPES[t] = true end

-- UnitClassification: trivial and minus are left out, they are not ranks a player looks up.
local RANKS = { normal = "normal", elite = "elite", rare = "rare", rareelite = "rare_elite", worldboss = "boss" }

local function creatureTraits(unit)
  local creatureType, rank
  if UnitCreatureType then
    local ok, t = pcall(UnitCreatureType, unit)
    if ok and type(t) == "string" and CREATURE_TYPES[t] then creatureType = t end
  end
  if UnitClassification then
    local ok, c = pcall(UnitClassification, unit)
    if ok and type(c) == "string" then rank = RANKS[c] end
  end
  return creatureType, rank
end

-- Each share of a kind has its own cap, so targeting and corpses cannot use up the room that NPC windows
-- and object positions need. Rows keep their kind and shape; the share is read from the row.
local function sightingShare(row)
  return (row.positionKind == "interaction" or row.positionKind == "vignette") and row.positionKind or "targeting"
end
local function lootShare(row) return row.sourceItemId and "items" or row.sourceObjectId and "objects" or "creatures" end
local TARGETING = { name = "targeting", of = sightingShare }
local INTERACTION = { name = "interaction", of = sightingShare }
local VIGNETTE = { name = "vignette", of = sightingShare }
local OBJECTS = { name = "objects", of = lootShare }
local CREATURES = { name = "creatures", of = lootShare }
local ITEMS = { name = "items", of = lootShare }

local function targetSighting(unit)
  local guid = UnitGUID(unit)
  local npcId = npcIdFromGuid(guid)
  if not npcId then return end
  local name = UnitName(unit)
  local level = UnitLevel(unit)
  if not name or not level or level < 1 then return end
  local where = mapPosition()
  if not where or not where.x or not where.y then return end
  -- One row per NPC, zone and spot (rounded to 1 on the 0..100 scale): retargeting the same NPC adds nothing.
  EverlootDB.targetSeen = EverlootDB.targetSeen or {}
  local seenKey = npcId .. ":" .. where.mapId .. ":" .. math.floor(where.x + 0.5) .. ":" .. math.floor(where.y + 0.5)
  if EverlootDB.targetSeen[seenKey] then return end
  local reaction = "neutral"
  if UnitIsFriend("player", unit) then reaction = "friendly"
  elseif UnitCanAttack("player", unit) then reaction = "hostile" end
  local creatureType, rank = creatureTraits(unit)
  local stored = E:Store("npc_sighting", {
    installId = EverlootDB.installId,
    capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    npcId = npcId, name = name,
    mapId = where.mapId, x = where.x, y = where.y, positionKind = "player",
    level = level, reaction = reaction,
    creatureType = creatureType, rank = rank,
  }, nil, TARGETING)
  if stored then EverlootDB.targetSeen[seenKey] = true end
end

-- NPC windows. While one is open the player stands within a few yards of the NPC that opened it, so the
-- player's position is recorded as the NPC's (positionKind "interaction") with the window's role. A gossip
-- window names no service; its role comes from the old gossip option types when the client has them.
-- Event names that were not checked on the Forever client are registered under pcall: one that never
-- fires records nothing.
local WINDOW_ROLES = {
  MERCHANT_SHOW = "vendor", TRAINER_SHOW = "trainer", QUEST_DETAIL = "questgiver", QUEST_GREETING = "questgiver",
  TAXIMAP_OPENED = "flightmaster", BANKFRAME_OPENED = "banker", AUCTION_HOUSE_SHOW = "auctioneer",
  PET_STABLE_SHOW = "stablemaster", CONFIRM_BINDER = "innkeeper", GOSSIP_SHOW = false,
}
-- The newer clients' PLAYER_INTERACTION_MANAGER_FRAME_SHOW, by Enum.PlayerInteractionType name.
local INTERACTION_ROLES = {
  Merchant = "vendor", Trainer = "trainer", QuestGiver = "questgiver", TaxiNode = "flightmaster", Banker = "banker",
  Auctioneer = "auctioneer", StableMaster = "stablemaster", Binder = "innkeeper", Gossip = false,
}

local function interactionRole(kind)
  local types = Enum and Enum.PlayerInteractionType
  if type(types) ~= "table" or kind == nil then return nil end
  for name, role in pairs(INTERACTION_ROLES) do
    if types[name] == kind then return role end
  end
  return nil
end

local function gossipRole()
  if not GetGossipOptions then return false end
  local options = { pcall(GetGossipOptions) }
  if not options[1] then return false end
  -- Old clients return text, type, text, type: "binder" is an innkeeper.
  for i = 3, #options, 2 do
    if options[i] == "binder" then return "innkeeper" end
  end
  return false
end

local function interactionSighting(role)
  local unit = "npc"
  local npcId = npcIdFromGuid(UnitGUID(unit))
  if not npcId and role == "questgiver" then
    unit = "questnpc"
    npcId = npcIdFromGuid(UnitGUID(unit))
  end
  if not npcId then return end
  if role == "vendor" and CanMerchantRepair then
    local ok, repairs = pcall(CanMerchantRepair)
    if ok and repairs then role = "repair" end
  end
  local name, level = UnitName(unit), UnitLevel(unit)
  if type(name) ~= "string" or name == "" or type(level) ~= "number" or level < 1 or level > 100 then return end
  local where = mapPosition()
  if not where or not where.x or not where.y then return end
  EverlootDB.interactionSeen = EverlootDB.interactionSeen or {}
  local seenKey = npcId .. ":" .. (role or "") .. ":" .. where.mapId
  if EverlootDB.interactionSeen[seenKey] then return end
  local reaction = "neutral"
  if UnitIsFriend("player", unit) then reaction = "friendly"
  elseif UnitCanAttack("player", unit) then reaction = "hostile" end
  local creatureType, rank = creatureTraits(unit)
  local stored = E:Store("npc_sighting", {
    installId = EverlootDB.installId,
    capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    npcId = npcId, name = name:sub(1, 120),
    mapId = where.mapId, x = where.x, y = where.y, positionKind = "interaction", role = role or nil,
    level = level, reaction = reaction,
    creatureType = creatureType, rank = rank,
  }, nil, INTERACTION)
  if stored then EverlootDB.interactionSeen[seenKey] = true end
end

-- The spell cast on an object, read at UNIT_SPELLCAST_SENT just before its loot window opens. English names
-- and the Classic spell ids; any other spell is "other". The cast's target is the object's name, kept only for
-- herb, ore and chest casts: any other spell's target may be a player, and a player's name never goes on a row.
local GATHER_BY_NAME = {
  ["Herb Gathering"] = "herb", ["Mining"] = "ore", ["Opening"] = "chest", ["Opening - No Text"] = "chest",
  ["Fishing"] = "fishing",
}
local GATHER_BY_ID = {
  [2366] = "herb", [2368] = "herb", [3570] = "herb", [11993] = "herb",
  [2575] = "ore", [2576] = "ore", [3564] = "ore", [10248] = "ore",
  [3365] = "chest", [6247] = "chest", [6477] = "chest", [6478] = "chest", [21651] = "chest", [22810] = "chest",
  [7620] = "fishing", [7731] = "fishing", [7732] = "fishing", [18248] = "fishing",
}
-- The same cast also types a window on a creature or an item (loot tables spec, section 4): pick-pocketing and
-- skinning open a second window on the creature's GUID, disenchanting and picking a lock name an item. Only the
-- spell's English name or Classic id decides it; the cast's target is never kept for these.
local LOOT_BY_NAME = { ["Pick Pocket"] = "pickpocket", ["Skinning"] = "skinning", ["Disenchant"] = "disenchant", ["Pick Lock"] = "container" }
local LOOT_BY_ID = {
  [921] = "pickpocket", [8613] = "skinning", [8617] = "skinning", [8618] = "skinning", [10768] = "skinning",
  [13262] = "disenchant", [1804] = "container",
}
-- A loot window more than this many seconds after the cast is not that cast's. A fish can take longer to bite.
local GATHER_WINDOW, FISHING_WINDOW = 8, 30
local NAMED_KINDS = { herb = true, ore = true, chest = true }
local lastCast

-- True when the name is the targeted player's: such a cast target is never kept.
local function targetPlayerNamed(name)
  if not (UnitName and UnitIsPlayer) then return false end
  local okPlayer, isPlayer = pcall(UnitIsPlayer, "target")
  if not okPlayer or not isPlayer then return false end
  local okName, targetName = pcall(UnitName, "target")
  return okName and targetName == name
end

local function now()
  if not GetTime then return nil end
  local ok, t = pcall(GetTime)
  return ok and type(t) == "number" and t or nil
end

local function spellName(spellId)
  if C_Spell and C_Spell.GetSpellName then
    local ok, name = pcall(C_Spell.GetSpellName, spellId)
    if ok and type(name) == "string" then return name end
  end
  if GetSpellInfo then
    local ok, info = pcall(GetSpellInfo, spellId)
    if ok and type(info) == "table" then info = info.name end
    if ok and type(info) == "string" then return info end
  end
  return nil
end

-- Newer clients send unit, target, castGUID, spellID; old ones unit, spell name, rank, target.
local function castSent(unit, a2, a3, a4)
  if unit ~= "player" then return end
  local spellId, name, target
  if type(a4) == "number" then spellId, target = a4, a2
  elseif type(a2) == "string" then name, target = a2, a4 end
  local spell = name or (spellId and spellName(spellId)) or ""
  local kind = (spellId and GATHER_BY_ID[spellId]) or GATHER_BY_NAME[spell] or "other"
  local lootKind = (spellId and LOOT_BY_ID[spellId]) or LOOT_BY_NAME[spell]
  -- Disenchanting and picking a lock target an item by name: its id is read now, while the item is in the bags.
  local itemId
  if (lootKind == "disenchant" or lootKind == "container") and type(target) == "string" and target ~= "" then
    local info = C_Item and C_Item.GetItemInfoInstant or GetItemInfoInstant
    local ok, id = pcall(info or error, target)
    itemId = ok and whole(id, 1, 10000000) or nil
  end
  if not NAMED_KINDS[kind] or type(target) ~= "string" or target == "" or #target > 120 or targetPlayerNamed(target) then
    target = nil
  end
  lastCast = { gatherKind = kind, lootKind = lootKind, itemId = itemId, name = target, at = now(),
    castGuid = spellId and type(a3) == "string" and a3 or nil }
end

-- True when a cast event is for the pending cast: by cast GUID where both have one, else any cast of the player's.
local function pendingCast(castGuid)
  if not lastCast then return false end
  if lastCast.castGuid and type(castGuid) == "string" and castGuid:find("^Cast%-") then return lastCast.castGuid == castGuid end
  return true
end

local function gatherContext()
  local cast = lastCast
  lastCast = nil
  if not cast then return nil end
  local t = now()
  local window = cast.gatherKind == "fishing" and FISHING_WINDOW or GATHER_WINDOW
  if cast.at and t and t - cast.at > window then return nil end
  -- A creature or item type needs the cast to have succeeded; an instant Pick Pocket may also count for 2 seconds
  -- after it was sent. A cast that failed or was interrupted never gets here (it clears lastCast).
  if cast.lootKind and not cast.succeeded and not (cast.lootKind == "pickpocket" and cast.at and t and t - cast.at <= 2) then
    cast.lootKind, cast.itemId = nil, nil
  end
  return cast
end

-- Quest tags by the game's own Enum.QuestTag names; a client without the enum records no tag.
local function questTag(questId)
  local info = C_QuestLog and C_QuestLog.GetQuestTagInfo
  local tags = Enum and Enum.QuestTag
  if not info or not tags then return nil end
  local ok, tagInfo = pcall(info, questId)
  local id = ok and type(tagInfo) == "table" and tagInfo.tagID
  if not id then return nil end
  if id == tags.Dungeon then return "dungeon" end
  if id == tags.Raid then return "raid" end
  if id == tags.PvP then return "pvp" end
  if id == tags.Group then return "group" end
  return nil
end

-- A quest the character just accepted, read from its own quest log row. Level is the quest's level as the log
-- shows it; a row that is not this quest, or has no real level, records nothing.
local function questCapture(index, questId)
  if not GetQuestLogTitle or type(index) ~= "number" or type(questId) ~= "number" then return end
  local faction = UnitFactionGroup and UnitFactionGroup("player")
  faction = faction == "Alliance" and "alliance" or faction == "Horde" and "horde" or nil
  EverlootDB.questSeen = EverlootDB.questSeen or {}
  local seenKey = tostring(questId) .. ":" .. tostring(faction)
  if EverlootDB.questSeen[seenKey] then return end
  local ok, title, level, group, isHeader, _, _, _, logId = pcall(GetQuestLogTitle, index)
  if not ok or isHeader or logId ~= questId or type(title) ~= "string" or title == "" then return end
  if type(level) ~= "number" or level < 1 or level ~= math.floor(level) then return end
  -- The category is the nearest header above the quest in the log.
  local category
  for i = index - 1, 1, -1 do
    local okRow, name, _, _, header = pcall(GetQuestLogTitle, i)
    if okRow and header and type(name) == "string" and name ~= "" then category = name:sub(1, 60); break end
  end
  local row = {
    installId = EverlootDB.installId,
    capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    questId = questId, title = title:sub(1, 200), level = level, rewardItemIds = {},
    category = category, faction = faction, tag = questTag(questId),
  }
  -- A number here is the suggested group size; some clients return a tag string in this place.
  if type(group) == "number" and group >= 2 and group <= 40 and group == math.floor(group) then row.suggestedGroup = group end
  -- The giver is the NPC whose window is open; nothing is recorded for an item, an object or a shared quest.
  row.giverNpcId = npcIdFromGuid(UnitGUID("npc")) or npcIdFromGuid(UnitGUID("questnpc"))
  if E:Store("quest", row) then EverlootDB.questSeen[seenKey] = true end
end

local QUALITY = {
  [0] = "poor", [1] = "common", [2] = "uncommon", [3] = "rare",
  [4] = "epic", [5] = "legendary", [6] = "artifact", [7] = "heirloom",
}

local function rememberItem(itemId)
  if not GetItemInfo then return end
  local name, _, quality = GetItemInfo(itemId)
  local label = QUALITY[quality]
  if not name or not label then return end
  E:Store("item_seen", {
    installId = EverlootDB.installId,
    capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    itemId = itemId, name = name, quality = label,
  })
end

-- The game's own "N Gold", "N Silver" and "N Copper" strings, as patterns, so a coin slot's text reads in any
-- language; English where the client does not define them. A count may carry a thousands separator.
local COIN_UNITS = { { "GOLD_AMOUNT", "%d Gold", 10000 }, { "SILVER_AMOUNT", "%d Silver", 100 }, { "COPPER_AMOUNT", "%d Copper", 1 } }
local function coinPatterns()
  local out = {}
  for _, unit in ipairs(COIN_UNITS) do
    local fmt = type(_G[unit[1]]) == "string" and _G[unit[1]] or unit[2]
    out[#out + 1] = { fmt:gsub("[%^%$%(%)%.%[%]%*%+%-%?]", "%%%0"):gsub("%%d", "([%%d,%%.]+)"), unit[3] }
  end
  return out
end

-- The copper in loot slot i when it is the coin slot, read from the slot's text; nil for an item slot or a text
-- that holds no amount.
local function slotCopper(i, text)
  local slotType = GetLootSlotType and select(2, pcall(GetLootSlotType, i))
  if slotType ~= (Enum and Enum.LootSlotType and Enum.LootSlotType.Money or LOOT_SLOT_MONEY or 2) or type(text) ~= "string" then
    return nil
  end
  local total = 0
  for _, unit in ipairs(coinPatterns()) do
    local digits = text:match(unit[1])
    local amount = digits and tonumber((digits:gsub("%D", "")))
    if amount then total = total + amount * unit[2] end
  end
  return total >= 1 and total <= 10000000000 and total or nil
end

-- The id of the item an item GUID names. The GUID itself does not hold it: the disenchant or lock cast read it
-- from the target's name, and an item opened with no cast is looked up by its GUID. Nil when neither works.
local function itemIdFromGuid(guid, cast)
  if cast and cast.itemId and (cast.lootKind == "disenchant" or cast.lootKind == "container") then return cast.itemId end
  if not C_Item then return nil end
  if C_Item.GetItemIDByGUID then
    local ok, id = pcall(C_Item.GetItemIDByGUID, guid)
    if ok and whole(id, 1, 10000000) then return id end
  end
  if C_Item.GetItemLocation and C_Item.GetItemID then
    local okLoc, location = pcall(C_Item.GetItemLocation, guid)
    local ok, id = pcall(C_Item.GetItemID, location)
    if okLoc and location and ok and whole(id, 1, 10000000) then return id end
  end
  return nil
end

-- What opened the window, from the source and the cast just before it. A creature's skinning window shares its
-- GUID with the kill; an item is disenchanted or opened as a container.
local function lootTypeOf(group, cast)
  local lootKind, gatherKind = cast and cast.lootKind, cast and cast.gatherKind
  if group.itemGuid then return lootKind == "disenchant" and "disenchant" or "container" end
  if group.sourceObjectId then return gatherKind == "fishing" and "fishing" or "gather" end
  if lootKind == "pickpocket" then return "pickpocket" end
  if lootKind == "skinning" or gatherKind == "herb" or gatherKind == "ore" then return "skinning" end
  return "kill"
end

local function lootCapture()
  -- Source pairs are GUID, quantity, GUID, quantity. Never infer loot from the target.
  if not (GetLootSourceInfo and GetLootSlotInfo and GetLootSlotLink) then return end
  local cast = gatherContext()
  EverlootDB.lootSources = EverlootDB.lootSources or {}
  local groups = {}
  local function groupFor(guid)
    local npcId, objectId = npcIdFromGuid(guid), objectIdFromGuid(guid)
    local itemGuid = not npcId and not objectId and isItemGuid(guid) and guid or nil
    if not (npcId or objectId or itemGuid) then return nil end
    groups[guid] = groups[guid] or { sourceNpcId = npcId, sourceObjectId = objectId, itemGuid = itemGuid, items = {} }
    return groups[guid]
  end
  local n = GetNumLootItems and GetNumLootItems() or 0
  for i = 1, math.min(n, 50) do
    local okLink, link = pcall(GetLootSlotLink, i)
    local okInfo, _, slotText, count = pcall(GetLootSlotInfo, i)
    if not okLink or not okInfo or type(link) ~= "string" then link = nil end
    local itemId = link and tonumber(link:match("item:(%d+)"))
    local copper = not link and okInfo and slotCopper(i, slotText) or nil
    if (itemId and type(count) == "number" and count > 0) or copper then
      local sources = { pcall(GetLootSourceInfo, i) }
      local coinSources, shared = {}, 0
      if sources[1] then
        for j = 2, #sources, 2 do
          local guid, quantity = sources[j], sources[j + 1]
          if copper then
            local group = groupFor(guid)
            if group and type(quantity) == "number" then coinSources[#coinSources + 1] = { group, quantity } end
          elseif type(quantity) == "number" and quantity >= 1 and quantity <= 1000 and quantity == math.floor(quantity) then
            local group = groupFor(guid)
            if group then group.items[#group.items + 1] = { itemId = itemId, count = quantity } end
          end
        end
      end
      -- Coin shared by several sources is split only when the per-source amounts add up to the slot's.
      for _, source in ipairs(coinSources) do shared = shared + source[2] end
      if #coinSources == 1 then coinSources[1][1].copper = copper
      elseif #coinSources > 1 and shared == copper then
        for _, source in ipairs(coinSources) do source[1].copper = source[2] end
      end
      if itemId then rememberItem(itemId) end
    end
  end
  local where
  for guid, group in pairs(groups) do
    local lootType = lootTypeOf(group, cast)
    -- Windows from before the type existed were keyed by the GUID alone, and were kill or gathering windows.
    local skip = EverlootDB.lootSources[guid .. ":" .. lootType]
      or (EverlootDB.lootSources[guid] and (lootType == "kill" or lootType == "gather" or lootType == "fishing"))
    if group.itemGuid then group.sourceItemId = itemIdFromGuid(group.itemGuid, cast) end
    -- An item whose id cannot be read, or a source with nothing in it, records nothing.
    if (group.itemGuid and not group.sourceItemId) or (#group.items == 0 and not group.copper) then skip = true end
    if not skip then
      group.itemGuid = nil
      group.lootType = lootType
      -- An object stays where it is: the player's position, how it was opened and its name go with it.
      if group.sourceObjectId then
        if where == nil then
          local ok, pos = pcall(mapPosition)
          where = ok and pos and pos.x and pos.y and pos or false
        end
        if where then group.mapId, group.x, group.y = where.mapId, where.x, where.y end
        if cast then group.gatherKind, group.sourceObjectName = cast.gatherKind, cast.name end
      end
      group.installId = EverlootDB.installId
      group.capturedAt = date("!%Y-%m-%dT%H:%M:%SZ")
      group.sourceEvidence = "loot-api"
      if E:Store("loot", group, nil, group.sourceItemId and ITEMS or group.sourceObjectId and OBJECTS or CREATURES) then
        -- Local-only corpse identity, by GUID and loot type so a kill and a skinning window on one corpse are both
        -- kept: retained across reloads, never exported as a row.
        -- Bounded by the same retained loot-row capacity; failures do not mark seen.
        EverlootDB.lootSources[guid .. ":" .. lootType] = true
      end
    end
  end
end

-- GetInstanceInfo: name, instanceType, difficultyID, ..., the 8th return is the instance's map id (a map, not a
-- UiMap), the 10th a dungeon finder id. Nil when the call is missing or fails.
local function instanceInfo()
  if not GetInstanceInfo then return nil end
  local ok, name, instanceType, difficulty, _, _, _, _, instanceMapId, _, lfgDungeonId = pcall(GetInstanceInfo)
  if not ok then return nil end
  return { name = name, instanceType = instanceType, difficulty = difficulty, instanceMapId = instanceMapId,
    lfgDungeonId = lfgDungeonId }
end

-- Vignettes: a rare or a treasure the minimap shows, at its own position as the game's vignette API gives it, not
-- the player's. A creature becomes an npc_sighting with positionKind "vignette", a game object an object_sighting.
local function vignetteSighting(guid)
  local api = C_VignetteInfo
  if type(guid) ~= "string" or not (api and api.GetVignetteInfo and api.GetVignettePosition) then return end
  if not (C_Map and C_Map.GetBestMapForUnit) then return end
  local info = api.GetVignetteInfo(guid)
  if type(info) ~= "table" then return end
  local npcId = npcIdFromGuid(info.objectGUID)
  local objectId = not npcId and objectIdFromGuid(info.objectGUID)
  local name = info.name
  if not (npcId or objectId) or type(name) ~= "string" or name == "" or #name > 120 then return end
  local mapId = whole(C_Map.GetBestMapForUnit("player"), 0, MAX_ID)
  if not mapId then return end
  local pos = api.GetVignettePosition(guid, mapId)
  local x, y = type(pos) == "table" and pos.x, type(pos) == "table" and pos.y
  if type(x) ~= "number" or type(y) ~= "number" or x < 0 or x > 1 or y < 0 or y > 1 then return end
  x, y = x * 100, y * 100
  EverlootDB.vignetteSeen = EverlootDB.vignetteSeen or {}
  local seenKey = (npcId and "npc:" .. npcId or "object:" .. objectId) .. ":" .. mapId .. ":"
    .. math.floor(x + 0.5) .. ":" .. math.floor(y + 0.5)
  if EverlootDB.vignetteSeen[seenKey] then return end
  local stored
  if npcId then
    stored = E:Store("npc_sighting", {
      installId = EverlootDB.installId,
      capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
      npcId = npcId, name = name, mapId = mapId, x = x, y = y, positionKind = "vignette",
    }, nil, VIGNETTE)
  else
    local inside = instanceInfo()
    stored = E:Store("object_sighting", {
      installId = EverlootDB.installId,
      capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
      objectId = objectId, name = name, mapId = mapId, x = x, y = y,
      instanceMapId = inside and inside.instanceType ~= "none" and whole(inside.instanceMapId, 1, MAX_ID) or nil,
    })
  end
  if stored then EverlootDB.vignetteSeen[seenKey] = true end
end

local function vignettesUpdated()
  local api = C_VignetteInfo
  if not (api and api.GetVignettes) then return end
  local guids = api.GetVignettes()
  if type(guids) ~= "table" then return end
  for _, guid in ipairs(guids) do pcall(vignetteSighting, guid) end
end

-- Dungeon and raid entrances. The loading screen into an instance starts outdoors: PLAYER_LEAVING_WORLD keeps the
-- player's position there, and PLAYER_ENTERING_WORLD inside a dungeon or raid records it as the entrance. A dungeon
-- finder teleport starts anywhere, so it records nothing.
local outside

local function leavingWorld()
  outside = nil
  local info = instanceInfo()
  if not info or info.instanceType ~= "none" then return end
  local where = mapPosition()
  if where and where.x and where.y then outside = where end
end

local function enteringWorld()
  local from = outside
  outside = nil
  local info = instanceInfo()
  if not from or not info or (info.instanceType ~= "party" and info.instanceType ~= "raid") then return end
  if type(info.lfgDungeonId) == "number" and info.lfgDungeonId > 0 then return end
  local instanceMapId = whole(info.instanceMapId, 1, MAX_ID)
  local name = info.name
  if not instanceMapId or type(name) ~= "string" or name == "" or #name > 120 then return end
  if from.x < 0 or from.x > 100 or from.y < 0 or from.y > 100 then return end
  EverlootDB.entranceSeen = EverlootDB.entranceSeen or {}
  local seenKey = instanceMapId .. ":" .. from.mapId
  if EverlootDB.entranceSeen[seenKey] then return end
  if E:Store("instance_entrance", {
    installId = EverlootDB.installId,
    capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    instanceMapId = instanceMapId, name = name, instanceType = info.instanceType,
    difficulty = whole(info.difficulty, 0, 255),
    mapId = from.mapId, x = from.x, y = from.y,
  }) then EverlootDB.entranceSeen[seenKey] = true end
end

-- ENCOUNTER_END inside a dungeon or raid: encounterID, encounterName, difficultyID, groupSize, success (1 a kill, 0 a wipe) and, on clients
-- that send it, the boss units engaged, each with a creatureID.
local function encounterEnd(encounterId, name, difficulty, size, success, units)
  encounterId = whole(encounterId, 1, MAX_ID)
  if success == 1 then success = true elseif success == 0 then success = false end
  if not encounterId or type(name) ~= "string" or name == "" or #name > 120 or type(success) ~= "boolean" then return end
  local info = instanceInfo()
  if not info or (info.instanceType ~= "party" and info.instanceType ~= "raid") then return end
  local instanceMapId = whole(info.instanceMapId, 1, MAX_ID)
  if not instanceMapId then return end
  local npcIds, seen = {}, {}
  if type(units) == "table" then
    for _, unit in ipairs(units) do
      local npcId = type(unit) == "table" and whole(unit.creatureID, 1, MAX_ID)
      if npcId and not seen[npcId] and #npcIds < 40 then seen[npcId] = true; npcIds[#npcIds + 1] = npcId end
    end
  end
  E:Store("encounter", {
    installId = EverlootDB.installId,
    capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    encounterId = encounterId, name = name, instanceMapId = instanceMapId, success = success,
    difficulty = whole(difficulty, 0, 255), size = whole(size, 1, 40),
    npcIds = #npcIds > 0 and npcIds or nil,
  })
end

local function vendorCapture()
  if not GetMerchantNumItems or not GetMerchantItemLink or not GetMerchantItemInfo then return end
  local vendorNpcId = npcIdFromGuid(UnitGUID("npc")) or npcIdFromGuid(UnitGUID("target"))
  if not vendorNpcId then return end
  local okCount, count = pcall(GetMerchantNumItems)
  if not okCount or type(count) ~= "number" or count < 1 then return end
  local items = {}
  for i = 1, math.min(count, 200) do
    local okLink, link = pcall(GetMerchantItemLink, i)
    local itemId = okLink and type(link) == "string" and tonumber(link:match("item:(%d+)"))
    if itemId then
      local okInfo, _, _, price, _, stock = pcall(GetMerchantItemInfo, i)
      if okInfo and type(price) == "number" and price >= 0 and price == math.floor(price) then
        local row = { itemId = itemId, priceCopper = price }
        if type(stock) == "number" and stock > 0 and stock == math.floor(stock) then
          row.limitedStock = stock
        end
        items[#items + 1] = row
        rememberItem(itemId)
      end
    end
  end
  if #items == 0 then return end
  E:Store("vendor", {
    installId = EverlootDB.installId,
    capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    vendorNpcId = vendorNpcId,
    items = items,
  })
end

E:RegisterModule("openworld", function()
  local f = E.frame
  f:RegisterEvent("PLAYER_TARGET_CHANGED")
  f:RegisterEvent("UPDATE_MOUSEOVER_UNIT")
  f:RegisterEvent("LOOT_OPENED")
  pcall(function() f:RegisterEvent("QUEST_ACCEPTED") end)
  -- MERCHANT_SHOW is an old client event. A missing event disables the hook.
  pcall(function() f:RegisterEvent("MERCHANT_SHOW") end)
  -- 0.3.7 and earlier paused a whole kind; these kinds now pause one share at a time.
  if EverlootDB.paused then EverlootDB.paused.npc_sighting, EverlootDB.paused.loot = nil, nil end
  for event in pairs(WINDOW_ROLES) do pcall(function() f:RegisterEvent(event) end) end
  for _, event in ipairs({ "PLAYER_INTERACTION_MANAGER_FRAME_SHOW", "UNIT_SPELLCAST_SENT", "UNIT_SPELLCAST_FAILED",
    "UNIT_SPELLCAST_FAILED_QUIET", "UNIT_SPELLCAST_SUCCEEDED", "UNIT_SPELLCAST_INTERRUPTED", "LOOT_CLOSED", "VIGNETTE_MINIMAP_UPDATED", "VIGNETTES_UPDATED", "PLAYER_LEAVING_WORLD",
    "PLAYER_ENTERING_WORLD", "ENCOUNTER_END" }) do
    pcall(function() f:RegisterEvent(event) end)
  end
  f:HookScript("OnEvent", function(_, event, arg1, arg2, arg3, arg4, arg5, arg6)
    if event == "PLAYER_TARGET_CHANGED" then targetSighting("target")
    elseif event == "UPDATE_MOUSEOVER_UNIT" then targetSighting("mouseover")
    elseif event == "LOOT_OPENED" then lootCapture()
    elseif event == "QUEST_ACCEPTED" then questCapture(arg1, arg2)
    elseif event == "UNIT_SPELLCAST_SENT" then pcall(castSent, arg1, arg2, arg3, arg4)
    elseif (event == "UNIT_SPELLCAST_FAILED" or event == "UNIT_SPELLCAST_FAILED_QUIET" or event == "UNIT_SPELLCAST_INTERRUPTED")
      and arg1 == "player" then
      if pendingCast(arg2) then lastCast = nil end
    elseif event == "UNIT_SPELLCAST_SUCCEEDED" and arg1 == "player" then
      if pendingCast(arg2) then lastCast.succeeded = true end
    elseif event == "LOOT_CLOSED" then lastCast = nil
    elseif event == "VIGNETTE_MINIMAP_UPDATED" then if arg2 then pcall(vignetteSighting, arg1) end
    elseif event == "VIGNETTES_UPDATED" then pcall(vignettesUpdated)
    elseif event == "PLAYER_LEAVING_WORLD" then pcall(leavingWorld)
    elseif event == "PLAYER_ENTERING_WORLD" then pcall(enteringWorld)
    elseif event == "ENCOUNTER_END" then pcall(encounterEnd, arg1, arg2, arg3, arg4, arg5, arg6)
    elseif event == "PLAYER_INTERACTION_MANAGER_FRAME_SHOW" then
      local role = interactionRole(arg1)
      if role ~= nil then pcall(interactionSighting, role or nil) end
    end
    if event == "MERCHANT_SHOW" then vendorCapture() end
    local role = WINDOW_ROLES[event]
    if role == false then
      local ok, found = pcall(gossipRole)
      role = ok and found or false
    end
    if role ~= nil then pcall(interactionSighting, role or nil) end
  end)
  if not GetQuestLogTitle then
    return "ready (target/mouseover/loot/merchant/NPC windows; quests off, this client has no GetQuestLogTitle)"
  end
  return "ready (target/mouseover/loot/merchant/NPC windows/quest accept)"
end)
