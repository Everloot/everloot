-- Two chores, each off until the player turns it on, each started by something the player did.
-- At a merchant window: sell every grey (poor quality) item in the bags and repair all gear, with the
-- player's own gold only. At the mailbox: a "Collect all" button that takes the money and items of
-- auction-house letters, one take at a time. It never uses guild-bank repair, never touches a letter
-- with cash on delivery, never takes from a letter that is not an auction invoice, never reads or
-- stores a sender, buyer or any other player's name, and writes no record: the gold module watches
-- the same events and records vendor sales and auction sales as it does for a click of the player's own.

local E = Everloot

local VENDOR_SETTLE_SECONDS = 0.3 -- lets the merchant window finish opening
local REPAIR_WAIT_SECONDS = 1 -- the longest repairing waits for the sales' money to arrive
local MAIL_THROTTLE_SECONDS = 0.4 -- between two takes, so the server keeps up
local MAIL_MONEY_WAIT_SECONDS = 3 -- the longest a money take waits for the gold change before moving on
local MAX_TAKES_PER_LETTER = 16 -- a letter holds at most 12 items; a safety bound

local C = {}
E.Conveniences = C

local function vendorOn() return EverlootDB and EverlootDB.autoVendor == true end
local function mailOn() return EverlootDB and EverlootDB.mailCollect == true end

local function after(seconds, f)
  if C_Timer and C_Timer.After then return pcall(C_Timer.After, seconds, f) end
  return false
end

-- Bags -----------------------------------------------------------------------------------------

local function bagCount() return type(NUM_BAG_SLOTS) == "number" and NUM_BAG_SLOTS or 4 end

local function slotCount(bag)
  local fn = (C_Container and C_Container.GetContainerNumSlots) or GetContainerNumSlots
  if not fn then return 0 end
  local ok, n = pcall(fn, bag)
  return ok and type(n) == "number" and n or 0
end

--- quality, stack count, link, no-vendor-value flag of one bag slot; nil for an empty slot. The modern
--- client returns a table, the older one a list of values.
local function slotItem(bag, slot)
  if C_Container and C_Container.GetContainerItemInfo then
    local ok, info = pcall(C_Container.GetContainerItemInfo, bag, slot)
    if not ok or type(info) ~= "table" then return nil end
    return info.quality, info.stackCount or 1, info.hyperlink, info.hasNoValue
  end
  if GetContainerItemInfo then
    -- icon, count, locked, quality, readable, lootable, link, isFiltered, noValue
    local ok, _, count, _, quality, _, _, link, _, noValue = pcall(GetContainerItemInfo, bag, slot)
    if not ok or not link then return nil end
    return quality, count or 1, link, noValue
  end
end

local function sellPrice(link)
  local fn = (C_Item and C_Item.GetItemInfo) or GetItemInfo
  if not fn then return nil end
  local ok, _, _, _, _, _, _, _, _, _, _, price = pcall(fn, link)
  if ok and type(price) == "number" and price > 0 then return price end
end

local function freeSlots()
  local fn = (C_Container and C_Container.GetContainerNumFreeSlots) or GetContainerNumFreeSlots
  if not fn then return nil end
  local total = 0
  for bag = 0, bagCount() do
    -- free slots, bag family: only a general bag (family 0) takes a letter's items
    local ok, free, family = pcall(fn, bag)
    if ok and type(free) == "number" and (family == nil or family == 0) then total = total + free end
  end
  return total
end

-- Merchant -------------------------------------------------------------------------------------

local merchantOpen = false
local vendorRun = 0 -- which merchant visit a pending step belongs to
local pendingRepair = nil -- { finish }: the repair waiting for the sales' gold change

local function summary(sold, earned, repaired)
  local parts = {}
  if sold > 0 then parts[#parts + 1] = string.format("sold %d grey item%s for %s", sold, sold == 1 and "" or "s", E.Coins(earned)) end
  if repaired then parts[#parts + 1] = "repaired for " .. E.Coins(repaired) end
  if #parts > 0 then print("Everloot: " .. table.concat(parts, ", ") .. ".") end
end

--- Repairs with the player's own gold: the guild-bank argument is passed false, never true.
local function repairAll()
  if not (CanMerchantRepair and GetRepairAllCost and RepairAllItems) then return nil end
  local okCan, can = pcall(CanMerchantRepair)
  if not okCan or not can then return nil end
  local okCost, cost = pcall(GetRepairAllCost)
  if not okCost or type(cost) ~= "number" or cost < 1 then return nil end
  local purse = GetMoney and GetMoney()
  if type(purse) ~= "number" or cost > purse then return nil end
  if not pcall(RepairAllItems, false) then return nil end
  return cost
end

local function sellGreys()
  local use = (C_Container and C_Container.UseContainerItem) or UseContainerItem
  if not use then return 0, 0 end
  local sold, earned = 0, 0
  for bag = 0, bagCount() do
    for slot = 1, slotCount(bag) do
      local quality, count, link, noValue = slotItem(bag, slot)
      local price = quality == 0 and not noValue and link and sellPrice(link)
      if price and pcall(use, bag, slot) then
        sold = sold + 1
        earned = earned + price * (type(count) == "number" and count or 1)
      end
    end
  end
  return sold, earned
end

local function vendorVisit(run)
  if run ~= vendorRun or not merchantOpen or not vendorOn() then return end
  local sold, earned = sellGreys()
  local function finish()
    if run ~= vendorRun or not merchantOpen then return end
    -- Switched off while the repair waited: the sales are made and still reported; no gold is spent.
    summary(sold, earned, vendorOn() and repairAll() or nil)
  end
  -- The sales' gold change must reach the ledger before the repair's: a merged change would hide a sale.
  local pending = { finish = finish }
  if sold > 0 and after(REPAIR_WAIT_SECONDS, function() if pendingRepair == pending then pendingRepair = nil; finish() end end) then
    pendingRepair = pending
  else
    finish()
  end
end

-- Mailbox --------------------------------------------------------------------------------------

local mailRun = 0 -- which collection a pending step belongs to; only ever counts up, so a step left over from a stopped run never matches a later one
local mail = nil -- { index, count, takes, letters, copper, skipped, items }
local awaiting = nil -- the money take waiting for its gold change: { run }

--- Letters the safe rule allows: an auction invoice (the game issues it only for a sold or won auction, so a
--- player's own letter never has one) with no cash on delivery. A letter whose invoice cannot be read is
--- skipped, never guessed at. Returns money, hasItem.
local function letterInfo(index)
  if not (GetInboxHeaderInfo and GetInboxInvoiceInfo) then return nil end
  -- packageIcon, stationeryIcon, sender (not read), subject, money, CODAmount, daysLeft, hasItem
  local ok, _, _, _, _, money, cod, _, hasItem = pcall(GetInboxHeaderInfo, index)
  if not ok then return nil end
  local okInvoice, invoiceType = pcall(GetInboxInvoiceInfo, index)
  local safe = okInvoice and (invoiceType == "seller" or invoiceType == "buyer") and cod == 0
  return type(money) == "number" and money or 0, (hasItem == true or (type(hasItem) == "number" and hasItem > 0)) and true or false, safe
end

--- A money take still waiting for its gold change is left waiting: its change or its timeout ends the wait.
local function mailFinish(reason)
  local m = mail
  mail = nil
  if C.button then C.button:SetText("Collect all") end
  if not m then return end
  local text = string.format("Everloot: mail collected %s from %d letter%s", E.Coins(m.copper), m.letters, m.letters == 1 and "" or "s")
  if m.items > 0 then text = text .. string.format(", %d take%s of items", m.items, m.items == 1 and "" or "s") end
  if m.skipped > 0 then text = text .. string.format("; %d skipped (cash on delivery or not an auction letter)", m.skipped) end
  if reason then text = text .. "; stopped: " .. reason end
  print(text .. ".")
end

local mailStep

local function mailNext(run)
  after(MAIL_THROTTLE_SECONDS, function() mailStep(run) end)
end

function mailStep(run)
  if run ~= mailRun or not mail then return end
  if not mailOn() then return mailFinish("switched off") end -- the option was turned off since the last take
  if mail.index < 1 then return mailFinish() end
  -- The server deletes a letter once it is empty and the ones after it slide down a position, so a position
  -- is trusted only while the inbox is the size it was. Losing one letter right after a take means that
  -- letter went; any other change is not guessed at.
  local okCount, count = pcall(GetInboxNumItems)
  if not okCount or type(count) ~= "number" then return mailFinish("cannot read the inbox") end
  if count ~= mail.count then
    if mail.takes < 1 or count ~= mail.count - 1 then return mailFinish("the inbox changed") end
    mail.index, mail.count, mail.takes, mail.moneyTaken = mail.index - 1, count, 0, nil
    return mailStep(run)
  end
  local money, hasItem, safe = letterInfo(mail.index)
  if money == nil then mail.index, mail.takes, mail.moneyTaken = mail.index - 1, 0, nil; return mailStep(run) end
  -- Judged again on every step, never remembered: what sits at this position is only what the game says now.
  if not safe then
    if mail.takes < 1 then mail.skipped = mail.skipped + 1 end
    mail.index, mail.takes, mail.moneyTaken = mail.index - 1, 0, nil
    return mailStep(run)
  end
  if mail.moneyTaken then money = 0 end -- taken once; money still showing is not retried
  if mail.takes >= MAX_TAKES_PER_LETTER or (money < 1 and not hasItem) then
    mail.index, mail.takes, mail.moneyTaken = mail.index - 1, 0, nil
    return mailStep(run)
  end
  mail.takes = mail.takes + 1
  if money > 0 then
    if not TakeInboxMoney then return mailFinish("this client has no TakeInboxMoney") end
    -- The take is hooked by the gold module, which reads the invoice and matches the gold change that
    -- follows. The next take waits for that change, so a second take cannot overwrite the first's invoice.
    if mail.takes == 1 then mail.letters = mail.letters + 1 end
    local mine = { run = run }
    awaiting = mine
    mail.copper, mail.moneyTaken = mail.copper + money, true
    TakeInboxMoney(mail.index)
    after(MAIL_MONEY_WAIT_SECONDS, function() if awaiting == mine then awaiting = nil; mailNext(run) end end)
    return
  end
  local free = freeSlots()
  if free == nil or free < 1 then return mailFinish(free == nil and "cannot count free bag slots" or "bags full") end
  if not AutoLootMailItem then return mailFinish("this client has no AutoLootMailItem") end
  if mail.takes == 1 then mail.letters = mail.letters + 1 end
  mail.items = mail.items + 1
  AutoLootMailItem(mail.index)
  mailNext(run)
end

local function mailStart()
  if mail or not mailOn() then return end
  -- A new take before the last one's gold change lands would overwrite the invoice the gold module matches it to.
  if awaiting then print("Everloot: the last take's gold has not arrived yet; click Collect all again in a moment.") return end
  if not (C_Timer and C_Timer.After and GetInboxNumItems) then print("Everloot: collecting mail needs timers and the inbox, which this client lacks.") return end
  local ok, count = pcall(GetInboxNumItems)
  if not ok or type(count) ~= "number" or count < 1 then print("Everloot: the inbox is empty.") return end
  mailRun = mailRun + 1
  -- Last letter first: a letter that empties and disappears moves only the ones after it.
  mail = { index = count, count = count, takes = 0, letters = 0, copper = 0, skipped = 0, items = 0 }
  if C.button then C.button:SetText("Stop") end
  mailStep(mailRun)
end

local function mailButton()
  if C.button then return C.button end
  local parent = InboxFrame or MailFrame
  if not (parent and CreateFrame) then return nil end
  local button = CreateFrame("Button", "EverlootCollectAll", parent, "UIPanelButtonTemplate")
  button:SetSize(90, 22)
  button:SetPoint("TOPRIGHT", parent, "TOPRIGHT", -60, -30)
  button:SetText("Collect all")
  button:SetScript("OnClick", function() if mail then mailFinish("stopped by you") else mailStart() end end)
  C.button = button
  return button
end

E:RegisterModule("conveniences", function()
  local f = E.frame
  for _, name in ipairs({ "MERCHANT_SHOW", "MERCHANT_CLOSED", "MAIL_SHOW", "MAIL_CLOSED", "PLAYER_MONEY" }) do
    pcall(function() f:RegisterEvent(name) end)
  end
  f:HookScript("OnEvent", function(_, event)
    if event == "MERCHANT_SHOW" then
      merchantOpen = true
      vendorRun = vendorRun + 1
      if vendorOn() then
        local run = vendorRun
        if not after(VENDOR_SETTLE_SECONDS, function() vendorVisit(run) end) then vendorVisit(run) end
      end
    elseif event == "MERCHANT_CLOSED" then
      merchantOpen = false
      vendorRun = vendorRun + 1
      pendingRepair = nil
    elseif event == "PLAYER_MONEY" then
      -- The gold module's own hook on this event runs first (it registered first), so the change is recorded
      -- before a repair or the next letter's take can add another.
      if pendingRepair then
        local pending = pendingRepair
        pendingRepair = nil
        after(0, pending.finish)
      end
      if awaiting then
        local run = awaiting.run
        awaiting = nil
        mailNext(run)
      end
    elseif event == "MAIL_SHOW" then
      local button = mailButton()
      if button then if mailOn() then button:Show() else button:Hide() end end
    elseif event == "MAIL_CLOSED" then
      if mail then mailFinish("the mailbox closed") end
    end
  end)
  return "ready (off until /everloot vendor on and /everloot mail on)"
end)
