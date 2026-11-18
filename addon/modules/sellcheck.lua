-- Everloot's check in the auction house's Sell tab: when the price the player typed would bring in less than a
-- vendor pays, or so little more that the deposit lost on an unsold auction would cancel the gain, a line under
-- Blizzard's Post button says so. It also says when this house's market value after the cut is below the vendor price,
-- and when disenchanting looks better. It reads what the sell window already shows (item, quantity, total price,
-- deposit) after Blizzard updates it, through hooksecurefunc. Display only: it never changes a price and never posts,
-- cancels or blocks Post. Everything Everloot is unsure of (no vendor price, a stale or thin market, an incomplete
-- disenchant estimate) stays unsaid.
-- S.BagCandidates applies the same comparison to the bags, at this house's market values, for the Everloot auction
-- house tab's Vendor these page (modules/auctiontab.lua).
-- Two helpers need no setup and are on in a new install, each with its own switch:
-- * Suggested price: when the house lists none of the item, Blizzard fills the price with a multiple of the vendor price.
--   Everloot puts this house's current market value there instead, only when that beats a vendor by more than the
--   deposit. A matched listing and anything the player typed are left alone. The player still presses Post.
-- * At a merchant, a button under the window sells, one press at a time, up to 12 stacks a vendor pays more for than
--   this house (what the buyback tab can undo). Greys are Blizzard's own Sell All Junk button's. Items on a shopping
--   list are kept.

local E = Everloot
local S = {}
E.SellCheck = S

-- The house's cut of a sale, from the client's AuctionHouse table (docs/design/specs/2026-10-16-forever-market-design.md):
-- 5% at the faction houses, 15% at the neutral goblin ones. kb/src/disenchant.ts auctionCut uses the same numbers.
S.CUT = { Alliance = 0.05, Horde = 0.05, Neutral = 0.15 }
local DEFAULT_CUT = 0.05
local RED, AMBER, BODY, MUTED = { 1, 0.4, 0.4 }, { 1, 0.67, 0.2 }, { 0.9, 0.9, 0.9 }, { 0.788, 0.765, 0.69 }
local SELL_FRAMES = { "ItemSellFrame", "CommoditiesSellFrame" }
-- Our note and hook state per sell frame, kept here so nothing is written into Blizzard's frames.
S.notes, S.hooked = {}, {}

local function whole(n) return type(n) == "number" and n >= 0 and n == math.floor(n) and n <= 9007199254740991 end

--- The cut for a house ("Alliance", "Horde", "Neutral"); 5% when the house is unknown.
function S.Cut(house) return S.CUT[house] or DEFAULT_CUT end

local function money(copper)
  return E.PriceCoinIcons and E.PriceCoinIcons(copper) or E.Coins(copper)
end

local function percent(cut) return string.format("%d%%", math.floor(cut * 100 + 0.5)) end

--- What the check says about one listing, from plain numbers: { level = "vendor" | "thin" | "market" | "disenchant" | nil, lines }.
--- `c`: quantity, total (copper the buyer pays for all of them), deposit, house, vendorUnit (the game's sell price, nil
--- or 0 when a vendor will not buy it), marketUnit and marketSource (this house's value, only when current) and
--- disenchantUnit (gross material value of one disenchant, only when complete and current). Each line is
--- { text, color }. No lines means nothing worth saying.
function S.Verdict(c)
  local out = { lines = {} }
  local function say(text, color) out.lines[#out.lines + 1] = { text = text, color = color or BODY } end
  local quantity, total = c.quantity, c.total
  if not (whole(quantity) and quantity >= 1 and whole(total) and total >= 1) then return out end
  local cut = S.Cut(c.house)
  local net = math.floor(total * (1 - cut))
  local deposit = whole(c.deposit) and c.deposit or 0
  local vendor = whole(c.vendorUnit) and c.vendorUnit > 0 and c.vendorUnit * quantity or nil
  local forAll = quantity > 1 and " for all " .. quantity or ""

  if vendor and net <= vendor then
    out.level = "vendor"
    say("Everloot: a vendor pays more", RED)
    say(string.format("This sale brings in %s%s after the house's %s cut. A vendor pays %s now.",
      money(net), forAll, percent(cut), money(vendor)))
    if deposit > 0 then say("If it does not sell, you also lose the " .. money(deposit) .. " deposit.") end
  elseif vendor and net - vendor <= deposit then
    out.level = "thin"
    say("Everloot: barely beats a vendor", AMBER)
    say(string.format("After the %s cut this is %s more than a vendor pays%s. If it does not sell, the %s deposit is gone.",
      percent(cut), money(net - vendor), forAll, money(deposit)))
  elseif vendor and whole(c.marketUnit) and math.floor(c.marketUnit * quantity * (1 - cut)) <= vendor then
    out.level = "market"
    say("Everloot: this house pays less than a vendor", AMBER)
    say(string.format("This house's market value is %s each (%s). After the cut that is under the vendor's %s each, so it may not sell at your price.",
      money(c.marketUnit), c.marketSource or "market value", money(c.vendorUnit)))
  end

  if whole(c.disenchantUnit) and c.disenchantUnit > 0 then
    local materials = math.floor(c.disenchantUnit * quantity * (1 - cut))
    if materials > net and (not vendor or materials > vendor) then
      if not out.level then
        out.level = "disenchant"
        say("Everloot: disenchanting looks better", AMBER)
      end
      say("Disenchanted, its materials bring about " .. money(materials) .. " after the cut at this house's prices. "
        .. "An estimate from observed disenchants; it needs an enchanter.")
    end
  end
  return out
end

local function vendorUnit(itemId)
  local info = (type(C_Item) == "table" and C_Item.GetItemInfo) or GetItemInfo
  if type(info) ~= "function" then return nil end
  local result = { pcall(info, itemId) }
  local sell = result[1] and E.Readable(result[12])
  return whole(sell) and sell > 0 and sell or nil
end

local function realmName()
  local realm = E.Readable(GetRealmName and GetRealmName())
  return type(realm) == "string" and #realm >= 2 and realm or nil
end

--- This house's current market value for one unit and where it comes from, or nil when it is stale, thin or unknown.
local function marketUnit(realm, itemId)
  local D = E.Disenchant
  if not (realm and D and D.Price) then return nil end
  local value, current, source = D.Price(realm, itemId)
  if current and whole(value) and value > 0 then return value, source end
  return nil
end

--- The gross material value of one disenchant, only when every material is priced and current.
local function disenchantUnit(realm, itemId)
  local D = E.Disenchant
  if not (realm and D and D.Band and D.Yields and D.Value) then return nil end
  local band = D.Band(itemId)
  local rows = band and D.Yields(band)
  if not rows or #rows == 0 then return nil end
  local mats = {}
  for _, r in ipairs(rows) do mats[r.id] = r.mean end
  local value, missing, fresh = D.Value(realm, mats)
  if missing or not fresh then return nil end
  return value
end

local function call(frame, method)
  local fn = frame and frame[method]
  if type(fn) ~= "function" then return nil end
  local ok, value = pcall(fn, frame)
  return ok and E.Readable(value) or nil
end

--- What one of Blizzard's sell frames holds now: { itemId, quantity, total, deposit }, or nil without an item.
function S.Read(frame)
  local location = call(frame, "GetItem")
  if type(location) ~= "table" or not (C_Item and C_Item.GetItemID) then return nil end
  local okId, itemId = pcall(C_Item.GetItemID, location)
  itemId = okId and E.Readable(itemId)
  if not whole(itemId) or itemId < 1 then return nil end
  -- The deposit as Blizzard's own Deposit line shows it (already rounded the way the house charges it).
  local deposit = frame.Deposit and call(frame.Deposit, "GetAmount")
  if not whole(deposit) then deposit = call(frame, "GetDepositAmount") end
  return { itemId = itemId, quantity = call(frame, "GetQuantity"), total = call(frame, "GetTotalPrice"), deposit = deposit }
end

--- The check is on unless the player turned it off (Esc > Options > AddOns > Everloot > Auction House).
function S.On()
  return not (type(EverlootDB) == "table" and EverlootDB.sellCheck == false)
end

--- The suggested price and the merchant button: each on unless turned off.
function S.PriceOn() return not (type(EverlootDB) == "table" and EverlootDB.sellPrice == false) end
function S.MerchantOn() return not (type(EverlootDB) == "table" and EverlootDB.merchantSell == false) end

local function bagSlots(bag)
  local ok, n = pcall(C_Container.GetContainerNumSlots, bag)
  n = ok and E.Readable(n)
  return whole(n) and n or 0
end

--- One bag slot's ItemLocation, or nil on a client without the mixin.
local function slotLocation(bag, slot)
  if not (ItemLocation and ItemLocation.CreateFromBagAndSlot) then return nil end
  local ok, location = pcall(ItemLocation.CreateFromBagAndSlot, ItemLocation, bag, slot)
  return ok and location or nil
end

--- What the shortest auction of this stack would cost to post, or nil when the house cannot say.
local function stackDeposit(location, count)
  if not (location and C_AuctionHouse and C_AuctionHouse.CalculateItemDeposit) then return nil end
  local ok, deposit = pcall(C_AuctionHouse.CalculateItemDeposit, location, 1, count)
  deposit = ok and E.Readable(deposit)
  return whole(deposit) and deposit or nil
end

--- The bag items this house pays less for than a vendor: the stacks of each item whose current market value here,
--- after the cut, is at or below the vendor price ("vendor"), or beats it by no more than the deposit of its shortest
--- auction ("deposit"). Greys, items a vendor will not buy, items the house will not take (soulbound, quest) and items
--- without a current, not-thin price at this house are left out; `unpriced` counts the last. Returns
--- { rows = { { itemId, count, vendor, auction, deposit, reason } }, vendor, auction, unpriced }, the rows sorted by what
--- vendoring gains over posting, and the totals of both. Reads only; sells and posts nothing.
function S.BagCandidates()
  local out = { rows = {}, vendor = 0, auction = 0, unpriced = 0 }
  if not (C_Container and C_Container.GetContainerItemInfo and C_Container.GetContainerNumSlots) then return out end
  local realm = realmName()
  local cut = S.Cut(E:MarketHouse())
  local canCheck = E.auctionHouseOpen and C_AuctionHouse and C_AuctionHouse.IsSellItemValid
  local byItem, unpriced = {}, {}
  for bag = 0, type(NUM_BAG_SLOTS) == "number" and NUM_BAG_SLOTS or 4 do
    for slot = 1, bagSlots(bag) do
      local ok, info = pcall(C_Container.GetContainerItemInfo, bag, slot)
      local id = ok and type(info) == "table" and E.Readable(info.itemID)
      local count = id and E.Readable(info.stackCount)
      local quality = id and E.Readable(info.quality)
      if whole(id) and whole(count) and count >= 1 and quality ~= 0 and not E.Readable(info.hasNoValue)
        and not E.Readable(info.isBound) then
        local location = slotLocation(bag, slot)
        local postable = true
        if canCheck and location then
          local okValid, valid = pcall(C_AuctionHouse.IsSellItemValid, location, false)
          postable = not okValid or E.Readable(valid) ~= false
        end
        local sell = postable and vendorUnit(id)
        if sell then
          local market = marketUnit(realm, id)
          if market then
            local row = byItem[id] or { itemId = id, count = 0, vendor = 0, auction = 0, deposit = 0, market = market, slots = {} }
            byItem[id] = row
            row.count = row.count + count
            row.slots[#row.slots + 1] = { bag = bag, slot = slot, count = count }
            row.vendor = row.vendor + sell * count
            row.auction = row.auction + math.floor(market * count * (1 - cut))
            local deposit = stackDeposit(location, count)
            if deposit then row.deposit = row.deposit + deposit else row.depositUnknown = true end
          else
            unpriced[id] = true
          end
        end
      end
    end
  end
  for _, row in pairs(byItem) do
    if row.auction <= row.vendor then row.reason = "vendor"
    elseif not row.depositUnknown and row.auction - row.vendor <= row.deposit then row.reason = "deposit" end
    if row.reason then
      out.rows[#out.rows + 1] = row
      out.vendor, out.auction = out.vendor + row.vendor, out.auction + row.auction
    end
  end
  for _ in pairs(unpriced) do out.unpriced = out.unpriced + 1 end
  table.sort(out.rows, function(a, b)
    local ga, gb = a.vendor - a.auction, b.vendor - b.auction
    if ga ~= gb then return ga > gb end
    return a.itemId < b.itemId
  end)
  return out
end

-- One text block per sell frame, in the empty space Blizzard leaves under its Post button.
local function noteFor(frame)
  if S.notes[frame] then return S.notes[frame] end
  local note = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  note:SetJustifyH("LEFT")
  note:SetJustifyV("TOP")
  note:SetWordWrap(true)
  note:SetPoint("TOPLEFT", frame.PostButton or frame, "BOTTOMLEFT", -60, -10)
  note:SetPoint("RIGHT", frame, "RIGHT", -14, 0)
  note:Hide()
  S.notes[frame] = note
  return note
end

local function hex(color)
  return string.format("|cff%02x%02x%02x", color[1] * 255, color[2] * 255, color[3] * 255)
end

-- The price Everloot put in each sell frame: { itemId, unit, source }, until the item changes.
S.priced = {}

--- After Blizzard's search for the item answers: when nothing was matched and the price box still holds Blizzard's
--- default, puts this house's current market value there, if posting at it beats a vendor by more than the deposit.
--- Returns the unit price it set, or nil.
function S.Suggest(frame)
  if not (S.PriceOn() and frame and frame.PriceInput) then return nil end
  if call(frame, "GetSearchResultPrice") ~= nil then return nil end
  local price, default = call(frame.PriceInput, "GetAmount"), call(frame, "GetDefaultPrice")
  if not (whole(price) and price == default) then return nil end
  local listing = S.Read(frame)
  if not listing or not whole(listing.quantity) or listing.quantity < 1 then return nil end
  local market, source = marketUnit(realmName(), listing.itemId)
  if not market then return nil end
  local unit = market
  local copper = type(C_AuctionHouse) == "table" and C_AuctionHouse.SupportsCopperValues or nil
  local okCopper, supports = false, nil
  if copper then okCopper, supports = pcall(copper) end
  -- A house without copper prices takes whole silver: round down, so the suggestion is never above the market.
  if not (okCopper and supports == true) then unit = math.max(100, math.floor(unit / 100) * 100) end
  local verdict = S.Verdict({ quantity = listing.quantity, total = unit * listing.quantity, deposit = listing.deposit,
    house = E:MarketHouse(), vendorUnit = vendorUnit(listing.itemId) })
  if verdict.level == "vendor" or verdict.level == "thin" then return nil end
  if not pcall(frame.PriceInput.SetAmount, frame.PriceInput, unit) then return nil end
  S.priced[frame] = { itemId = listing.itemId, unit = unit, source = source }
  if type(frame.UpdatePostState) == "function" then pcall(frame.UpdatePostState, frame) end
  return unit
end

--- Reads the sell frame and shows or hides its note. Called after each of Blizzard's own updates.
function S.Update(frame)
  local note = frame and S.notes[frame]
  if not note then return end
  local verdict
  if S.On() then
    local listing = S.Read(frame)
    if listing then
      local realm = realmName()
      listing.house = E:MarketHouse()
      listing.vendorUnit = vendorUnit(listing.itemId)
      listing.marketUnit, listing.marketSource = marketUnit(realm, listing.itemId)
      listing.disenchantUnit = disenchantUnit(realm, listing.itemId)
      verdict = S.Verdict(listing)
      -- Say where a price Everloot set came from, while it is still the price in the box.
      local priced = S.priced[frame]
      local unit = frame.PriceInput and call(frame.PriceInput, "GetAmount")
      if priced and priced.itemId == listing.itemId and unit == priced.unit then
        verdict.lines[#verdict.lines + 1] = { text = "Everloot set this price from this house's market value ("
          .. (priced.source or "market value") .. "). Nothing here is listed now.", color = MUTED }
      elseif priced and priced.itemId ~= listing.itemId then
        S.priced[frame] = nil
      end
    end
  end
  if not verdict or #verdict.lines == 0 then
    note:SetText("")
    note:Hide()
    S.last = nil
    return
  end
  local text = {}
  for _, line in ipairs(verdict.lines) do text[#text + 1] = hex(line.color) .. line.text .. "|r" end
  note:SetText(table.concat(text, "\n"))
  note:Show()
  S.last = verdict
end

--- Hooks the item and commodity sell frames once each. True when at least one is hooked.
function S.Attach()
  local house = AuctionHouseFrame
  if type(house) ~= "table" or not hooksecurefunc then return false end
  local any = false
  for _, key in ipairs(SELL_FRAMES) do
    local frame = house[key]
    if type(frame) == "table" and type(frame.UpdatePostState) == "function" then
      if not S.hooked[frame] then
        S.hooked[frame] = pcall(function()
          noteFor(frame)
          hooksecurefunc(frame, "UpdatePostState", function(self) pcall(S.Update, self) end)
          if type(frame.UpdatePriceSelection) == "function" then
            hooksecurefunc(frame, "UpdatePriceSelection", function(self) pcall(S.Suggest, self) end)
          end
          frame:HookScript("OnHide", function(self) if S.notes[self] then S.notes[self]:Hide() end end)
        end)
      end
      any = any or S.hooked[frame]
    end
  end
  return any
end

-- Merchant ------------------------------------------------------------------------------------------

S.SELL_PER_PRESS = 12 -- the merchant's buyback tab holds the last 12 sales

--- True when a shopping list wants the item: it is kept, whatever it sells for.
local function wanted(itemId)
  local shop = E.Shopping
  local ok, db = pcall(function() return shop and shop.DB() end)
  if not ok or type(db) ~= "table" or type(db.lists) ~= "table" then return false end
  for _, list in ipairs(db.lists) do
    for _, item in ipairs(list.items or {}) do if item.itemId == itemId then return true end end
  end
  return false
end

--- What the merchant button would sell now: the bag items a vendor pays more for than this house, after its cut,
--- minus those on a shopping list. { rows, stacks, vendor }.
function S.MerchantList()
  local found = S.BagCandidates()
  local out = { rows = {}, stacks = 0, vendor = 0 }
  for _, row in ipairs(found.rows) do
    if row.reason == "vendor" and not wanted(row.itemId) then
      out.rows[#out.rows + 1] = row
      out.stacks = out.stacks + #row.slots
      out.vendor = out.vendor + row.vendor
    end
  end
  return out
end

local function merchantOpen()
  return type(MerchantFrame) == "table" and MerchantFrame.IsShown and MerchantFrame:IsShown() and true or false
end

--- Sells up to S.SELL_PER_PRESS stacks from S.MerchantList, each only if its slot still holds that item. Returns the
--- stacks sold and the copper a vendor pays for them.
function S.SellToMerchant()
  if not (S.MerchantOn() and merchantOpen()) then return 0, 0 end
  local use = C_Container and C_Container.UseContainerItem
  if not use then return 0, 0 end
  local list = S.MerchantList()
  local sold, earned = 0, 0
  for _, row in ipairs(list.rows) do
    local each = math.floor(row.vendor / row.count)
    for _, at in ipairs(row.slots) do
      if sold >= S.SELL_PER_PRESS then return sold, earned end
      local ok, info = pcall(C_Container.GetContainerItemInfo, at.bag, at.slot)
      local id = ok and type(info) == "table" and E.Readable(info.itemID)
      local count = id and E.Readable(info.stackCount)
      if id == row.itemId and whole(count) and pcall(use, at.bag, at.slot) then
        sold = sold + 1
        earned = earned + each * count
      end
    end
  end
  return sold, earned
end

local function merchantTooltip(button)
  if not GameTooltip then return end
  local list = S.MerchantList()
  GameTooltip:SetOwner(button, "ANCHOR_RIGHT")
  GameTooltip:AddLine("Everloot: a vendor pays more for these")
  for i, row in ipairs(list.rows) do
    if i > 10 then GameTooltip:AddLine(string.format("and %d more", #list.rows - 10), 0.788, 0.765, 0.69); break end
    GameTooltip:AddDoubleLine(S.ItemLabel(row.itemId) .. " x" .. row.count, E.Coins(row.vendor), 1, 1, 1, 1, 1, 1)
  end
  GameTooltip:AddLine("This house pays less after its cut. Each press sells up to 12 stacks; the buyback tab undoes them. "
    .. "Items on a shopping list are kept.", 0.788, 0.765, 0.69, true)
  GameTooltip:Show()
end

--- The item as the game names it, or its id while the client has not loaded it.
function S.ItemLabel(itemId)
  local info = (type(C_Item) == "table" and C_Item.GetItemInfo) or GetItemInfo
  if type(info) == "function" then
    local ok, name = pcall(info, itemId)
    name = ok and E.Readable(name)
    if type(name) == "string" and name ~= "" then return name end
  end
  return "Item " .. itemId
end

--- Shows the button with the count and value it would sell, or hides it when there is nothing or it is off.
function S.RefreshMerchant()
  local button = S.merchantButton
  if not button then return end
  local list = (S.MerchantOn() and merchantOpen()) and S.MerchantList() or { stacks = 0, vendor = 0 }
  if list.stacks == 0 then button:Hide(); return end
  local n = math.min(list.stacks, S.SELL_PER_PRESS)
  button:SetText(string.format("Everloot: sell %d low-value stack%s", n, n == 1 and "" or "s"))
  button:Show()
end

local function merchantButton()
  if S.merchantButton then return S.merchantButton end
  if type(MerchantFrame) ~= "table" then return nil end
  local ok, button = pcall(CreateFrame, "Button", "EverlootMerchantSell", MerchantFrame, "UIPanelButtonTemplate")
  if not ok or not button then return nil end
  button:SetSize(240, 22)
  -- Below the window, away from Blizzard's own buttons, pages and buyback slot.
  button:SetPoint("TOPLEFT", MerchantFrame, "BOTTOMLEFT", 4, -2)
  button:SetScript("OnClick", function(self)
    local sold, earned = S.SellToMerchant()
    if sold > 0 then
      print(string.format("Everloot: sold %d stack%s a vendor pays more for, for %s. The buyback tab undoes them.",
        sold, sold == 1 and "" or "s", E.Coins(earned)))
    end
    if GameTooltip and GameTooltip.Hide then GameTooltip:Hide() end
  end)
  button:SetScript("OnEnter", merchantTooltip)
  button:SetScript("OnLeave", function() if GameTooltip and GameTooltip.Hide then GameTooltip:Hide() end end)
  button:Hide()
  S.merchantButton = button
  return button
end

-- Blizzard's auction house UI loads on demand: attach when it loads or when the house opens, whichever comes first.
-- The merchant button follows the merchant window and the bags while it is open.
local listener = CreateFrame("Frame")
S.frame = listener
for _, event in ipairs({ "ADDON_LOADED", "AUCTION_HOUSE_SHOW", "MERCHANT_SHOW", "MERCHANT_CLOSED", "BAG_UPDATE_DELAYED" }) do
  pcall(listener.RegisterEvent, listener, event)
end
listener:SetScript("OnEvent", function(_, event, name)
  if event == "AUCTION_HOUSE_SHOW" or name == "Blizzard_AuctionHouseUI" then pcall(S.Attach)
  elseif event == "MERCHANT_SHOW" then
    if S.MerchantOn() then pcall(merchantButton) end
    pcall(S.RefreshMerchant)
  elseif event == "MERCHANT_CLOSED" then
    if S.merchantButton then S.merchantButton:Hide() end
  elseif event == "BAG_UPDATE_DELAYED" and S.merchantButton and merchantOpen() then
    pcall(S.RefreshMerchant)
  end
end)
