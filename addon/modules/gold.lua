-- Own character only. Records current gold, the peak this install has seen,
-- copper taken from a loot window, quest money rewards, sales at an open merchant,
-- flight costs paid at an open taxi map, auction sales taken from the mailbox (the
-- sale minus the house cut; the returned deposit is the player's own money), postage
-- for letters the server confirmed sent, and auction buyouts. Other purchases, bids,
-- deposits, repairs, other mail and gameplay stay unrecorded: their source cannot be
-- told apart, or the money can come back. No other player's name: invoices, letters
-- and listings name other players; those fields are never read into a record.

local E = Everloot

local peak = 0
local lastSnapshot = 0
local lastMoney = nil
local merchantOpen = false
local taxiOpen = false
local auctionMail = nil -- { letter = copper the letter pays, sale = the sale minus the cut }
local postage = nil -- price quoted for a letter the server has not confirmed yet
local buyout = nil -- copper a buyout is about to take
local buyoutGen = 0 -- which pending buyout an expiry timer belongs to
local quote = nil -- total the auction house last quoted for a commodity purchase

local function playerMoney()
  if not GetMoney then return nil end
  local ok, copper = pcall(GetMoney)
  if not ok or type(copper) ~= "number" or copper < 0 or copper ~= math.floor(copper) then return nil end
  return copper
end

local function identity()
  local name = UnitName and E.Readable(UnitName("player"))
  local realm = GetRealmName and E.Readable(GetRealmName())
  if type(name) ~= "string" or name == "" then return nil end
  if type(realm) ~= "string" or #realm < 2 then return nil end
  return name, realm
end

local function rememberPeak(copper)
  if copper > peak then peak = copper end
  EverlootDB.goldPeak = peak
end

local function writeSnapshot(force)
  local now = time()
  if not force and now - lastSnapshot < 60 then return end
  local copper = playerMoney()
  local name, realm = identity()
  if not copper or not name then return end
  rememberPeak(copper)
  lastSnapshot = now
  E:Store("gold_snapshot", {
    installId = EverlootDB.installId,
    capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    character = name,
    realm = realm,
    currentCopper = copper,
    peakCopper = peak,
  })
end

local function storeMoney(category, copper)
  local name, realm = identity()
  if not name or type(copper) ~= "number" or copper < 1 or copper ~= math.floor(copper) then return end
  E:Store("money_event", {
    installId = EverlootDB.installId,
    capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    character = name,
    realm = realm,
    category = category,
    copper = copper,
  })
end

local function whole(copper)
  return type(copper) == "number" and copper >= 1 and copper == math.floor(copper)
end

--- Only a source that names itself attributes a change: an auction-sale letter or a buyout
--- whose money moves in full, a merchant sale or a paid flight.
local function moneyChanged(copper)
  if lastMoney then
    local delta = copper - lastMoney
    if auctionMail and delta == auctionMail.letter then storeMoney("auction", auctionMail.sale)
    elseif buyout and delta == -buyout then storeMoney("auction_spend", buyout)
    elseif merchantOpen and delta > 0 then storeMoney("vendor", delta)
    elseif taxiOpen and delta < 0 then storeMoney("flight", -delta) end
  end
  auctionMail = nil
  buyout = nil
  lastMoney = copper
end

--- Called after the player takes a letter's money. The invoice type, not the localized subject, marks a sale.
local function mailTaken(index)
  auctionMail = nil
  if not GetInboxInvoiceInfo or not GetInboxHeaderInfo then return end
  -- invoiceType, itemName, playerName (not read), bid, buyout, deposit, consignment
  local okInvoice, invoiceType, _, _, bid, _, _, cut = pcall(GetInboxInvoiceInfo, index)
  if not okInvoice or invoiceType ~= "seller" or not whole(bid) or type(cut) ~= "number" then return end
  -- packageIcon, stationeryIcon, sender, subject, money
  local okHeader, _, _, _, _, copper = pcall(GetInboxHeaderInfo, index)
  if okHeader and whole(copper) and whole(bid - cut) then auctionMail = { letter = copper, sale = bid - cut } end
end

--- A pending buyout lasts a few seconds: a bid the house rejects never moves money, and a later change
--- of the same amount (a repair) must not be called a purchase.
local BUYOUT_SECONDS = 5
local function setBuyout(copper)
  buyout = copper
  buyoutGen = buyoutGen + 1
  if copper and C_Timer and C_Timer.After then
    local mine = buyoutGen
    pcall(C_Timer.After, BUYOUT_SECONDS, function() if buyoutGen == mine then buyout = nil end end)
  end
end

--- Called after a bid on a listing. Only a bid at the buyout price is a purchase; a lower bid can be refunded.
local function bidPlaced(listType, index, bid)
  buyout = nil
  if not GetAuctionItemInfo or not whole(bid) then return end
  -- name, texture, count, quality, canUse, level, levelColHeader, minBid, minIncrement, buyoutPrice
  local ok, _, _, _, _, _, _, _, _, _, price = pcall(GetAuctionItemInfo, listType, index)
  if ok and whole(price) and bid == price then setBuyout(bid) end
end

--- Forever: called after C_AuctionHouse.PlaceBid(auctionID, bidAmount). Only a bid at the listing's
--- buyout is a purchase. The listing is read back with GetAuctionInfoByID; no owner or bidder is read.
local function itemBidPlaced(auctionID, bid)
  buyout = nil
  if not whole(bid) or not (C_AuctionHouse and C_AuctionHouse.GetAuctionInfoByID) then return end
  local ok, info = pcall(C_AuctionHouse.GetAuctionInfoByID, auctionID)
  if ok and type(info) == "table" and whole(info.buyoutAmount) and bid == info.buyoutAmount then setBuyout(bid) end
end

--- Forever: a commodity purchase pays the total the house last quoted (COMMODITY_PRICE_UPDATED).
--- Called after ConfirmCommoditiesPurchase. If the money that leaves differs, nothing is attributed.
local function commodityConfirmed()
  setBuyout(quote)
  quote = nil
end

--- Called after SendMail: the send window's quoted price, before the fields clear. Recipient and text are not read.
local function mailSent()
  postage = nil
  if not GetSendMailPrice then return end
  local ok, copper = pcall(GetSendMailPrice)
  if ok and type(copper) == "number" then postage = copper end
end

local function lootMoney()
  if not GetNumLootItems or not GetLootSlotType or not GetLootSlotInfo then return end
  if not identity() then return end
  local okCount, count = pcall(GetNumLootItems)
  if not okCount or type(count) ~= "number" then return end
  for i = 1, math.min(count, 50) do
    local okType, slotType = pcall(GetLootSlotType, i)
    -- 2 is the money slot. An item slot is not income.
    if okType and slotType == 2 then
      local okInfo, _, _, copper = pcall(GetLootSlotInfo, i)
      if okInfo and type(copper) == "number" and copper >= 1 and copper == math.floor(copper) then
        storeMoney("loot", copper)
        writeSnapshot(true)
      end
    end
  end
end

E:RegisterModule("gold", function()
  if type(EverlootDB.goldPeak) == "number" and EverlootDB.goldPeak >= 0 then peak = EverlootDB.goldPeak end
  local f = E.frame
  f:RegisterEvent("PLAYER_ENTERING_WORLD")
  f:RegisterEvent("LOOT_OPENED")
  for _, name in ipairs({ "PLAYER_MONEY", "MERCHANT_SHOW", "MERCHANT_CLOSED", "TAXIMAP_OPENED", "TAXIMAP_CLOSED", "QUEST_TURNED_IN", "MAIL_CLOSED",
    "MAIL_SEND_SUCCESS", "MAIL_FAILED", "AUCTION_HOUSE_CLOSED", "COMMODITY_PRICE_UPDATED", "COMMODITY_PRICE_UNAVAILABLE", "COMMODITY_PURCHASE_FAILED", "AUCTION_HOUSE_SHOW_ERROR" }) do
    pcall(function() f:RegisterEvent(name) end)
  end
  if hooksecurefunc then
    for _, name in ipairs({ "TakeInboxMoney", "AutoLootMailItem" }) do
      if _G[name] then pcall(hooksecurefunc, name, mailTaken) end
    end
    if SendMail then pcall(hooksecurefunc, "SendMail", mailSent) end
    if PlaceAuctionBid then pcall(hooksecurefunc, "PlaceAuctionBid", bidPlaced) end
    -- Watched after the player's own click, never called: a hook runs once the game's function has run.
    if type(C_AuctionHouse) == "table" then
      if C_AuctionHouse.PlaceBid then pcall(hooksecurefunc, C_AuctionHouse, "PlaceBid", itemBidPlaced) end
      if C_AuctionHouse.StartCommoditiesPurchase then pcall(hooksecurefunc, C_AuctionHouse, "StartCommoditiesPurchase", function() quote = nil end) end
      if C_AuctionHouse.ConfirmCommoditiesPurchase then pcall(hooksecurefunc, C_AuctionHouse, "ConfirmCommoditiesPurchase", commodityConfirmed) end
    end
  end
  f:HookScript("OnEvent", function(_, event, ...)
    if event == "PLAYER_ENTERING_WORLD" then
      lastMoney = playerMoney()
      writeSnapshot(true)
    elseif event == "PLAYER_MONEY" then
      local copper = playerMoney()
      if copper then rememberPeak(copper); moneyChanged(copper) end
      writeSnapshot(false)
    elseif event == "MERCHANT_SHOW" then merchantOpen = true
    elseif event == "MERCHANT_CLOSED" then merchantOpen = false
    elseif event == "TAXIMAP_OPENED" then taxiOpen = true
    elseif event == "TAXIMAP_CLOSED" then taxiOpen = false
    elseif event == "MAIL_CLOSED" then auctionMail = nil
    elseif event == "MAIL_SEND_SUCCESS" then storeMoney("postage", postage); postage = nil
    elseif event == "MAIL_FAILED" then postage = nil
    elseif event == "AUCTION_HOUSE_CLOSED" then buyout = nil; quote = nil
    elseif event == "COMMODITY_PRICE_UPDATED" then
      -- updatedUnitPrice, updatedTotalPrice
      local _, total = ...
      quote = whole(total) and total or nil
    elseif event == "COMMODITY_PURCHASE_FAILED" or event == "COMMODITY_PRICE_UNAVAILABLE" or event == "AUCTION_HOUSE_SHOW_ERROR" then
      -- The house refused or cannot price it: no purchase is pending.
      buyout = nil; quote = nil
    elseif event == "QUEST_TURNED_IN" then
      -- questID, xpReward, moneyReward. The reward names itself; the PLAYER_MONEY that follows is not attributed.
      local _, _, reward = ...
      storeMoney("quest", reward)
    elseif event == "LOOT_OPENED" then lootMoney() end
  end)
  return "ready (peak, current, loot copper, quest rewards, vendor sales, flights, mailed auction sales, postage, buyouts)"
end)
