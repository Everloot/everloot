-- Local stock only; never E:Store or EverlootDB.records. Capture needs explicit inventoryCapture consent.
-- Shape for later private transport: EverlootDB.inventory[CharacterKey()][location] =
-- { complete = true, observedAt = Unix seconds, items = { [itemID] = total count } }.
-- Locations are bags, bank and mail, each independently replaced after a COMPLETE readable observation.
-- An absent location is unknown; an empty items table is observed empty. No names, money, guild banks,
-- auctions, account bank or network access. At most 50 characters, 200 slots per bag, 100 loaded mails
-- and 16 attachments per mail. Exceeding a cap preserves the previous dated snapshot, never partial stock.
-- Ordinary bag/open-bank/open-mail APIs only. Opened bank/mail still need an in-game check before release.
local E = Everloot
local I = {}
E.Inventory = I
local MAX_CHARACTERS, MAX_SLOTS, MAX_MAIL, MAX_ATTACHMENTS = 50, 200, 100, 16
local MAX_COUNT, MAX_ID = 2147483647, 2000000000
local bankOpen, mailOpen = false, false

local function whole(n, lo, hi)
  return type(n) == "number" and n == math.floor(n) and n >= lo and n <= hi
end

-- Keep call failure separate from a successful empty-slot result.
local function call(fn, ...)
  if type(fn) ~= "function" then return false end
  local ok, a, b, c, d, e, f, g, h = pcall(fn, ...)
  if not ok then return false end
  if type(issecretvalue) == "function" then
    for i = 1, 8 do
      local value = select(i, a, b, c, d, e, f, g, h)
      local checked, secret = pcall(issecretvalue, value)
      if not checked or secret then return false end
    end
  end
  return true, E.Readable(a), E.Readable(b), E.Readable(c), E.Readable(d), E.Readable(e), E.Readable(f), E.Readable(g), E.Readable(h)
end

local function add(items, id, count)
  if not whole(id, 1, MAX_ID) or not whole(count, 1, MAX_COUNT) then return false end
  local total = (items[id] or 0) + count
  if total > MAX_COUNT then return false end
  items[id] = total
  return true
end

local function containers(bags, bank)
  local api = C_Container
  local slotsFn = api and api.GetContainerNumSlots or GetContainerNumSlots
  local infoFn = api and api.GetContainerItemInfo
  local items = {}
  for _, bag in ipairs(bags) do
    local ok, slots = call(slotsFn, bag)
    if not ok or not whole(slots, 0, MAX_SLOTS) or ((bag == 0 or (bank and bag == -1)) and slots == 0) then return nil end
    for slot = 1, slots do
      if infoFn then
        local got, info = call(infoFn, bag, slot)
        if not got then return nil end
        if info ~= nil then
          if type(info) ~= "table" or not add(items, E.Readable(info.itemID), E.Readable(info.stackCount)) then return nil end
        end
      else
        -- Legacy clients expose item count in GetContainerItemInfo and ID separately.
        local got, id = call(GetContainerItemID, bag, slot)
        if not got then return nil end
        if id ~= nil then
          local infoOK, _, count = call(GetContainerItemInfo, bag, slot)
          if not infoOK or not add(items, id, count) then return nil end
        end
      end
    end
  end
  return items
end

local function equippedBags()
  local n = NUM_TOTAL_EQUIPPED_BAG_SLOTS or NUM_BAG_SLOTS or 4
  if not whole(n, 4, 5) then return nil end
  return n
end

local function readBags()
  local n = equippedBags()
  if not n then return nil end
  local bags = {}
  for i = 0, n do bags[#bags + 1] = i end
  return containers(bags)
end

local function readBank()
  if not bankOpen then return nil end
  local n, count = equippedBags(), NUM_BANKBAGSLOTS or 7
  if not n or not whole(count, 0, 7) then return nil end
  local bags = { -1 }
  for i = 1, count do bags[#bags + 1] = n + i end
  return containers(bags, true)
end

local function readMail()
  if not mailOpen then return nil end
  local ok, count, total = call(GetInboxNumItems)
  if not ok or not whole(count, 0, MAX_MAIL) or not whole(total, 0, MAX_MAIL) or count ~= total
    or type(GetInboxItemLink) ~= "function" or type(GetInboxItem) ~= "function" then return nil end
  local items = {}
  for mail = 1, count do
    local headerOK, _, _, _, subject, _, _, daysLeft, attached = call(GetInboxHeaderInfo, mail)
    if not headerOK or type(subject) ~= "string" or type(daysLeft) ~= "number" or daysLeft ~= daysLeft
      or daysLeft < 0 or daysLeft > 365 or not whole(attached or 0, 0, MAX_ATTACHMENTS) then return nil end
    local found = 0
    for slot = 1, MAX_ATTACHMENTS do
      local got, link = call(GetInboxItemLink, mail, slot)
      if not got then return nil end
      if link ~= nil then
        if type(link) ~= "string" then return nil end
        local itemOK, _, id, _, amount = call(GetInboxItem, mail, slot)
        if not itemOK or not add(items, id, amount) then return nil end
        found = found + 1
      end
    end
    -- A header can arrive before its item links/counts are cached. That is unavailable, never empty.
    if found ~= (attached or 0) then return nil end
  end
  return items
end

function I.Withdraw()
  if EverlootDB then EverlootDB.inventory = nil end
end

function I.Forget(key)
  if EverlootDB and EverlootDB.inventory then EverlootDB.inventory[key] = nil end
end

local function capture(location, read)
  if not EverlootDB or EverlootDB.inventoryCapture ~= true then return end
  local key = E.CharacterKey()
  if not key then return end
  local items = read()
  if not items then return end
  local at = E.Readable(time())
  if not whole(at, 1, MAX_COUNT) then return end
  local stock = EverlootDB.inventory or {}
  local row = stock[key]
  if not row then
    local count = 0
    for _ in pairs(stock) do count = count + 1 end
    if count >= MAX_CHARACTERS then return end
    row = {}
  end
  row[location] = { complete = true, observedAt = at, items = items }
  stock[key] = row
  EverlootDB.inventory = stock
end

E:RegisterModule("inventory", function()
  -- Old stock must not survive withdrawn consent, including a manually edited saved setting.
  if EverlootDB.inventoryCapture ~= true then I.Withdraw() end
  local f = E.frame
  for _, event in ipairs({ "PLAYER_ENTERING_WORLD", "PLAYER_LEAVING_WORLD", "BAG_UPDATE_DELAYED",
    "BANKFRAME_OPENED", "BANKFRAME_CLOSED", "PLAYERBANKSLOTS_CHANGED", "PLAYERBANKBAGSLOTS_CHANGED",
    "MAIL_SHOW", "MAIL_CLOSED", "MAIL_INBOX_UPDATE" }) do
    pcall(function() f:RegisterEvent(event) end)
  end
  f:HookScript("OnEvent", function(_, event)
    if event == "PLAYER_ENTERING_WORLD" or event == "PLAYER_LEAVING_WORLD" then
      bankOpen, mailOpen = false, false
      if event == "PLAYER_ENTERING_WORLD" then capture("bags", readBags) end
    elseif event == "BANKFRAME_CLOSED" then bankOpen = false
    elseif event == "MAIL_CLOSED" then mailOpen = false
    elseif event == "BANKFRAME_OPENED" then
      bankOpen = true; capture("bank", readBank)
    elseif event == "MAIL_SHOW" then
      mailOpen = true; capture("mail", readMail)
    elseif event == "BAG_UPDATE_DELAYED" then
      capture("bags", readBags); capture("bank", readBank)
    elseif event == "PLAYERBANKSLOTS_CHANGED" or event == "PLAYERBANKBAGSLOTS_CHANGED" then
      capture("bank", readBank)
    elseif event == "MAIL_INBOX_UPDATE" then capture("mail", readMail) end
  end)
  return "local inventory capture needs its own consent; bank and mail only while open; never uploaded"
end)
