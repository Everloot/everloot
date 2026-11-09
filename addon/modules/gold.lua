-- Own character only. Records current gold, the peak this install has seen,
-- copper taken from a loot window, quest money rewards, sales at an open merchant,
-- flight costs paid at an open taxi map, auction sales taken from the mailbox (the
-- sale minus the house cut; the returned deposit is the player's own money), postage
-- for letters the server confirmed sent, and auction buyouts. Bids, deposits, COD
-- payments and gameplay stay unrecorded: their source cannot be told apart, or the money
-- can come back. No other player's name: invoices, letters and listings name other
-- players; those fields are never read into a record.
-- Ledger only (the uploaded money_event keeps the schema's nine categories): repairs and
-- purchases at an open merchant, trades the purse confirms, money sent with a letter
-- and money in a letter from one of the player's own characters. Each is marked ownAlt
-- when the other side is one of the player's own characters: the trade partner,
-- recipient or sender is compared with the roster's names on the player's realm and
-- then dropped, never kept.
-- Each event also goes to the local ledger (ledger.lua) under the character key, with
-- an auction sale kept by item (name, count, deposit, cut) there only; the uploaded
-- money_event keeps its shape. The sold notice (a system line naming only the item)
-- adds a pending sale there; the letter's sale fills it in. The day's closing gold is
-- written there as it changes.

local E = Everloot

local peak = 0
local lastMoney = nil
local merchantOpen = false
local taxiOpen = false
local auctionMail = nil -- { letter = copper the letter pays, sale = the sale minus the cut, item = the invoice's item facts }
local postage = nil -- price quoted for a letter the server has not confirmed yet
local buyout = nil -- copper a buyout is about to take
local buyoutGen = 0 -- which pending buyout an expiry timer belongs to
local quote = nil -- total the auction house last quoted for a commodity purchase
local repairPending = false -- a repair was asked for at the merchant; the next drop there is a repair
local repairGen = 0 -- which repair an expiry timer belongs to
local sendMoney = nil -- { copper, ownAlt }: money a letter carries, until the server confirms it sent
local plainMail = nil -- { letter = copper, ownAlt }: a plain letter's money, until the purse matches it
local trade = nil -- { out, inn, ownAlt, closed }: the trade window's money, until the purse confirms it
local tradeGen = 0 -- which closed trade an expiry timer belongs to
local TRADE_SECONDS = 3 -- a closed trade's money arrives within this, or the trade was cancelled

-- The money_event schema's categories (packages/protocol/schema/records/money_event.json). Others are local.
local UPLOADED = { loot = true, quest = true, vendor = true, auction = true, flight = true, postage = true,
  barber = true, respec = true, auction_spend = true }

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

-- One row a minute. The last row's time and balance are kept per character in SavedVariables, so a /reload inside
-- the minute writes nothing. A forced write (login, loot) still waits out the minute unless the balance changed.
local function writeSnapshot(force)
  local now = time()
  local copper = playerMoney()
  local name, realm = identity()
  if not copper or not name then return end
  local key = name .. "-" .. realm
  if type(EverlootDB.goldSnapshotAt) ~= "table" then EverlootDB.goldSnapshotAt = {} end
  local last = EverlootDB.goldSnapshotAt[key]
  if type(last) ~= "table" then last = { at = 0 } end
  if now - (tonumber(last.at) or 0) < 60 and (not force or copper == last.copper) then return end
  rememberPeak(copper)
  EverlootDB.goldSnapshotAt[key] = { at = now, copper = copper }
  E:Store("gold_snapshot", {
    installId = EverlootDB.installId,
    capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    character = name,
    realm = realm,
    currentCopper = copper,
    peakCopper = peak,
  })
end

--- This character's ledger key, or nil when the ledger is not loaded or the key cannot be read.
local function ledgerKey()
  if not (E.Ledger and E.CharacterKey) then return nil end
  local ok, key = pcall(E.CharacterKey)
  return ok and key or nil
end

local function storeMoney(category, copper, extra)
  local name, realm = identity()
  if not name or type(copper) ~= "number" or copper < 1 or copper ~= math.floor(copper) then return end
  if UPLOADED[category] then
    E:Store("money_event", {
      installId = EverlootDB.installId,
      capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
      character = name,
      realm = realm,
      category = category,
      copper = copper,
    })
  end
  local key = ledgerKey()
  if key then E.Ledger.Record(key, category, copper, extra) end
end

--- The day's closing gold in the ledger; the day's last change wins.
local function closeDay(copper)
  local key = ledgerKey()
  if key and copper then E.Ledger.Close(key, copper) end
end

--- A confirmed auction sale: the money_event, then the sale by item in the ledger.
local function storeSale(mail)
  local item = mail.item
  storeMoney("auction", mail.sale, { itemName = item.itemName, count = item.count })
  local key = ledgerKey()
  if key then
    E.Ledger.RecordSale(key, { itemName = item.itemName, count = item.count, total = mail.sale, deposit = item.deposit, cut = item.cut })
  end
end

--- The sold notice's Lua pattern, from the client's own format string ("A buyer has been found for your auction of %s."),
--- built once at init; nil when the client has no such string.
local soldPattern = nil
local function soldNoticePattern()
  local format = E.Readable(_G.ERR_AUCTION_SOLD_S)
  if type(format) ~= "string" or not format:find("%s", 1, true) then return nil end
  return "^" .. format:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0"):gsub("%%%%s", "(.+)") .. "$"
end

--- A sold notice names the item and nothing else; the gold comes with the letter. The line may carry an item link,
--- of which only the bracketed name is kept. A secret or non-string line records nothing.
local function soldNotice(text)
  text = E.Readable(text)
  if not soldPattern or type(text) ~= "string" then return end
  local ok, item = pcall(string.match, text, soldPattern)
  if not ok or not item then return end
  item = item:match("%[(.-)%]") or item
  local key = ledgerKey()
  if key then E.Ledger.RecordPending(key, item) end
end

local function whole(copper)
  return type(copper) == "number" and copper >= 1 and copper == math.floor(copper)
end

--- True when a name read from the client is one of the player's own characters on the player's realm. The name is
--- only compared, case-insensitively, and never kept.
local function ownAlt(other)
  other = E.Readable(other)
  local _, realm = identity()
  if type(other) ~= "string" or other == "" or not realm or not (E.Roster and E.Roster.Rows) then return false end
  local ok, rows = pcall(E.Roster.Rows)
  if not ok or type(rows) ~= "table" then return false end
  other = other:lower()
  for _, r in ipairs(rows) do
    if r.realm == realm and type(r.name) == "string" and r.name:lower() == other then return true end
  end
  return false
end

--- A trade the purse matched: what came in and what went out, each only when there was some.
local function storeTrade(t)
  if t.inn > 0 then storeMoney("trade_in", t.inn, { ownAlt = t.ownAlt }) end
  if t.out > 0 then storeMoney("trade_out", t.out, { ownAlt = t.ownAlt }) end
end

--- Only a source that names itself attributes a change: an auction-sale or plain letter, a buyout or
--- an accepted trade whose money moves in full, a merchant sale, repair or purchase, or a paid flight.
local function moneyChanged(copper)
  local settled = false
  if lastMoney then
    local delta = copper - lastMoney
    if auctionMail and delta == auctionMail.letter then storeSale(auctionMail)
    elseif plainMail and delta == plainMail.letter then storeMoney("mail_in", delta, { ownAlt = plainMail.ownAlt })
    elseif buyout and delta == -buyout then storeMoney("auction_spend", buyout)
    elseif trade and delta == trade.inn - trade.out then storeTrade(trade); settled = true
    elseif merchantOpen and delta > 0 then storeMoney("vendor", delta)
    elseif merchantOpen and delta < 0 then
      storeMoney(repairPending and "repair" or "vendor_spend", -delta)
      repairPending = false
    elseif taxiOpen and delta < 0 then storeMoney("flight", -delta) end
  end
  -- A trade waits for its money while the window is open; after it closes, the next change settles it either way.
  if settled or (trade and trade.closed) then trade = nil end
  auctionMail = nil
  plainMail = nil
  buyout = nil
  lastMoney = copper
end

--- Called after the player takes a letter's money. The invoice type, not the localized subject, marks a sale.
local function mailTaken(index)
  auctionMail = nil
  plainMail = nil
  if not GetInboxInvoiceInfo or not GetInboxHeaderInfo then return end
  -- invoiceType, itemName, playerName (bound to _, never read), bid, buyout, deposit, consignmentFee, moneyDelay,
  -- etaDay, etaHour, count, commerceAuction
  local okInvoice, invoiceType, itemName, _, bid, buyoutPrice, deposit, cut, _, _, _, count, commerce = pcall(GetInboxInvoiceInfo, index)
  if not okInvoice then return end
  invoiceType, bid, cut = E.Readable(invoiceType), E.Readable(bid), E.Readable(cut)
  if invoiceType ~= "seller" and invoiceType ~= "buyer" then
    -- A plain letter counts only when one of the player's own characters on this realm sent it (the sender is
    -- compared, never kept). Any other money letter (an outbid refund, a system letter, another player's gold)
    -- stays unrecorded: it is not income the player earned, and its source cannot be told apart.
    -- A letter in transit between two alts has left the account's purse but not arrived, so the account's
    -- unrecorded line reads negative until it is taken.
    -- packageIcon, stationeryIcon, sender, subject, money
    local okHeader, _, _, sender, _, money = pcall(GetInboxHeaderInfo, index)
    money = okHeader and E.Readable(money)
    if whole(money) and ownAlt(sender) then plainMail = { letter = money, ownAlt = true } end
    return
  end
  if invoiceType ~= "seller" or not whole(bid) or type(cut) ~= "number" then return end
  count = E.Readable(count)
  local item = {
    itemName = E.Readable(itemName), count = whole(count) and count or 1, bid = bid, buyout = E.Readable(buyoutPrice),
    deposit = E.Readable(deposit), cut = cut, commerce = E.Readable(commerce),
  }
  -- packageIcon, stationeryIcon, sender, subject, money
  local okHeader, _, _, _, _, copper = pcall(GetInboxHeaderInfo, index)
  copper = okHeader and E.Readable(copper)
  if whole(copper) and whole(bid - cut) then auctionMail = { letter = copper, sale = bid - cut, item = item } end
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

--- Called after SendMail: the send window's quoted price and the money the letter carries, before the fields clear.
--- The recipient field is only compared with the roster's names; it and the text are never kept.
local function mailSent()
  postage = nil
  sendMoney = nil
  if GetSendMailPrice then
    local ok, copper = pcall(GetSendMailPrice)
    copper = ok and E.Readable(copper)
    if type(copper) == "number" then postage = copper end
  end
  if GetSendMailMoney then
    local ok, copper = pcall(GetSendMailMoney)
    copper = ok and E.Readable(copper)
    if whole(copper) then
      local box = _G.SendMailNameEditBox
      local okName, recipient = false, nil
      if type(box) == "table" and box.GetText then okName, recipient = pcall(box.GetText, box) end
      sendMoney = { copper = copper, ownAlt = okName and ownAlt(recipient) }
    end
  end
end

--- A repair asked for at the merchant lasts a few seconds, like a buyout: the next drop there is its cost.
--- A guild-bank repair (RepairAllItems(true)) takes none of the player's own gold, so it is not pending.
local function repairAsked(guildBank)
  if guildBank == true then return end
  repairPending = true
  repairGen = repairGen + 1
  if C_Timer and C_Timer.After then
    local mine = repairGen
    pcall(C_Timer.After, BUYOUT_SECONDS, function() if repairGen == mine then repairPending = false end end)
  end
end

--- The trade's money as it stands: what each side puts up, and whether the partner is one of the player's
--- characters (the name is compared, not kept). Taken whenever the money or items change and whenever the
--- partner has accepted, since the update with both sides accepted may never come when the player accepts
--- second. The purse moving by exactly in minus out is what confirms the trade happened.
local function tradeSnapshot()
  trade = nil
  if not (GetPlayerTradeMoney and GetTargetTradeMoney) then return end
  local okOut, out = pcall(GetPlayerTradeMoney)
  local okIn, inn = pcall(GetTargetTradeMoney)
  out, inn = okOut and E.Readable(out), okIn and E.Readable(inn)
  out = type(out) == "number" and out >= 0 and out == math.floor(out) and out or nil
  inn = type(inn) == "number" and inn >= 0 and inn == math.floor(inn) and inn or nil
  if not out or not inn or (out == 0 and inn == 0) then return end
  -- name, realm: a realm means the partner is from another realm
  local okName, partner, partnerRealm = false, nil, nil
  if UnitName then okName, partner, partnerRealm = pcall(UnitName, "NPC") end
  partnerRealm = okName and E.Readable(partnerRealm)
  local alt = okName and (partnerRealm == nil or partnerRealm == "") and ownAlt(partner) or false
  trade = { out = out, inn = inn, ownAlt = alt }
end

--- TRADE_ACCEPT_UPDATE(player, target): a snapshot once the partner has accepted.
local function tradeAccepted(_, target)
  if target == 1 then tradeSnapshot() end
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
      -- The money slot names its amount in its text ("1 Gold, 20 Silver"); the numeric field is the fallback.
      local okInfo, _, text, quantity = pcall(GetLootSlotInfo, i)
      local copper = okInfo and E.CoinText(text)
      if not copper and okInfo then
        quantity = E.Readable(quantity)
        copper = type(quantity) == "number" and quantity or nil
      end
      if copper and copper >= 1 and copper == math.floor(copper) then
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
  soldPattern = soldNoticePattern()
  if soldPattern then pcall(function() f:RegisterEvent("CHAT_MSG_SYSTEM") end) end
  for _, name in ipairs({ "PLAYER_MONEY", "MERCHANT_SHOW", "MERCHANT_CLOSED", "TAXIMAP_OPENED", "TAXIMAP_CLOSED", "QUEST_TURNED_IN", "MAIL_CLOSED",
    "MAIL_SEND_SUCCESS", "MAIL_FAILED", "AUCTION_HOUSE_CLOSED", "COMMODITY_PRICE_UPDATED", "COMMODITY_PRICE_UNAVAILABLE", "COMMODITY_PURCHASE_FAILED", "AUCTION_HOUSE_SHOW_ERROR",
    "TRADE_SHOW", "TRADE_CLOSED", "TRADE_ACCEPT_UPDATE", "TRADE_MONEY_CHANGED", "TRADE_PLAYER_ITEM_CHANGED" }) do
    pcall(function() f:RegisterEvent(name) end)
  end
  if hooksecurefunc then
    for _, name in ipairs({ "TakeInboxMoney", "AutoLootMailItem" }) do
      if _G[name] then pcall(hooksecurefunc, name, mailTaken) end
    end
    if SendMail then pcall(hooksecurefunc, "SendMail", mailSent) end
    -- The player's own repair click, or the conveniences auto-repair: watched, never called here.
    for _, name in ipairs({ "RepairAllItems", "RepairItem" }) do
      if _G[name] then pcall(hooksecurefunc, name, repairAsked) end
    end
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
      closeDay(lastMoney)
    elseif event == "PLAYER_MONEY" then
      local copper = playerMoney()
      if copper then rememberPeak(copper); closeDay(copper); moneyChanged(copper) end
      writeSnapshot(false)
    elseif event == "MERCHANT_SHOW" then merchantOpen = true
    elseif event == "MERCHANT_CLOSED" then merchantOpen = false; repairPending = false
    elseif event == "TAXIMAP_OPENED" then taxiOpen = true
    elseif event == "TAXIMAP_CLOSED" then taxiOpen = false
    elseif event == "MAIL_CLOSED" then auctionMail = nil; plainMail = nil
    elseif event == "MAIL_SEND_SUCCESS" then
      storeMoney("postage", postage)
      if sendMoney then storeMoney("mail_out", sendMoney.copper, { ownAlt = sendMoney.ownAlt }) end
      postage = nil; sendMoney = nil
    elseif event == "MAIL_FAILED" then postage = nil; sendMoney = nil
    elseif event == "TRADE_SHOW" then trade = nil
    elseif event == "TRADE_ACCEPT_UPDATE" then tradeAccepted(...)
    elseif event == "TRADE_MONEY_CHANGED" or event == "TRADE_PLAYER_ITEM_CHANGED" then tradeSnapshot()
    elseif event == "TRADE_CLOSED" then
      -- The money can arrive after the window closes; a cancelled trade's snapshot expires after a few seconds,
      -- so later loot of the same amount is not called a trade.
      if trade then
        trade.closed = true
        tradeGen = tradeGen + 1
        local mine, armed = tradeGen, trade
        if C_Timer and C_Timer.After then
          pcall(C_Timer.After, TRADE_SECONDS, function() if tradeGen == mine and trade == armed then trade = nil end end)
        end
      end
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
    elseif event == "CHAT_MSG_SYSTEM" then soldNotice((...))
    elseif event == "LOOT_OPENED" then lootMoney() end
  end)
  return "ready (peak, current, loot copper, quest rewards, vendor sales, flights, mailed auction sales by item, postage, buyouts; local ledger and daily close, repairs, vendor purchases, trades, mail money)"
    .. (soldPattern and "" or "; sold notice: no ERR_AUCTION_SOLD_S")
end)
