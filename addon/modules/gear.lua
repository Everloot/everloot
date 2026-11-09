-- Everloot gear sampler: equipped item ids + item levels, max once per hour.
-- Feeds the roster-strength / armor-weight inputs of the guild score.

local E = Everloot

local SLOTS = {
  "HeadSlot", "NeckSlot", "ShoulderSlot", "BackSlot", "ChestSlot", "WristSlot",
  "HandsSlot", "WaistSlot", "LegsSlot", "FeetSlot", "Finger0Slot", "Finger1Slot",
  "Trinket0Slot", "Trinket1Slot", "MainHandSlot", "SecondaryHandSlot",
}

local function sample()
  local now = time()
  local name = UnitName and E.Readable(UnitName("player"))
  local realm = GetRealmName and E.Readable(GetRealmName())
  -- The hour is kept per character in SavedVariables, so a /reload does not start it again.
  local key = E.CharacterKey and E.CharacterKey()
  if not key and name then key = name .. "-" .. (realm or "?") end
  if type(EverlootDB.gearSampledAt) ~= "table" then EverlootDB.gearSampledAt = {} end
  local last = key and tonumber(EverlootDB.gearSampledAt[key]) or 0
  if now - last < 3600 then return "sampled recently, skipping" end
  if not (GetInventoryItemLink and GetDetailedItemLevelInfo) then
    return "inventory API unavailable in beta"
  end
  if not name then return "no player yet" end
  local equipped = {}
  for _, slotName in ipairs(SLOTS) do
    local slotId, _ = GetInventorySlotInfo(slotName)
    if slotId then
      local link = GetInventoryItemLink("player", slotId)
      local itemId = link and tonumber(link:match("item:(%d+)"))
      local ok, detailed = pcall(GetDetailedItemLevelInfo, link)
      local ilvl = (ok and type(detailed) == "number") and math.floor(detailed) or nil
      if itemId and ilvl and ilvl >= 1 then
        equipped[#equipped + 1] = { slot = slotName, itemId = itemId, itemLevel = ilvl }
      end
    end
  end
  if #equipped == 0 then return "nothing equipped readable" end
  if key then EverlootDB.gearSampledAt[key] = now end
  E:Store("gear_snapshot", {
    installId = EverlootDB.installId,
    capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    character = name, realm = realm or "?", equipped = equipped,
  })
  return "sampled " .. #equipped .. " slots"
end

E:RegisterModule("gear", function()
  local f = E.frame
  f:RegisterEvent("PLAYER_ENTERING_WORLD")
  f:HookScript("OnEvent", function(_, event)
    if event == "PLAYER_ENTERING_WORLD" then pcall(sample) end
  end)
  return "ready (hourly sample)"
end)
