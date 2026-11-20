-- Everloot drop sources in item tooltips: tiered drop rates from one install upward, which the Desktop App
-- wrote into the EverlootPrices slot addon beside the prices (checksummed; they show after /reload).
-- Display only: nothing here talks to the network, and nothing is written to SavedVariables.

local E = Everloot

E.DROP_INSTALLS = 1        -- as the site: reported at one, verified at two, confirmed at three installs
E.DROP_SOURCES_SHOWN = 3   -- tooltip lines per item; the rest are counted

-- The drops block and the sources block (public vendors and reagent-of counts, beside the drops), each
-- { status = "absent" | "verifying" | "ready" | "bad", data, asOf, names }.
local drops, sources

function E:ResetDrops()
  drops, sources = nil, nil
end

--- The block's `names`, one "n116=Defias Bandit" or "o1731=Copper Vein" line each, as { n116 = name }: the names
--- the site knows for the sources, written by the Desktop App. Outside the checksum, so a name is display text only:
--- its pipes are doubled, so the game prints them instead of reading a colour or a link.
local function sourceNames(text)
  local names = {}
  if type(text) ~= "string" then return names end
  for key, name in text:gmatch("([no]%d+)=([^\n]+)") do names[key] = name:sub(1, 100):gsub("|", "||") end
  return names
end

--- One checksummed block of EverlootPricesDB (`key`), read once: absent when the file has no such table, verifying
--- while its Adler-32 `sum` is checked a slice per frame, then ready or bad. `what` names it in the chat warning.
--- `set` stores the entry in the module before the check starts (a small block passes within the call) and `current`
--- reads it back, so a reset while checking is seen.
local function loadBlock(key, what, set, current)
  local db = type(EverlootPricesDB) == "table" and EverlootPricesDB[key]
  if type(db) ~= "table" then
    set({ status = "absent" })
  elseif type(db.data) ~= "string" or type(db.sum) ~= "number" then
    set({ status = "bad" })
    print("Everloot: " .. what .. " failed their checksum and are not shown.")
  else
    local entry = { status = "verifying", data = ";" .. db.data .. ";", asOf = db.dataAsOf, names = sourceNames(db.names) }
    set(entry)
    E.VerifyChecksum(db.data, db.sum, function(ok)
      if current() ~= entry then return end -- reset while checking
      entry.status = ok and "ready" or "bad"
      if not ok then
        entry.data = nil
        print("Everloot: " .. what .. " failed their checksum and are not shown.")
      end
    end)
  end
  return current()
end

--- The drops block of EverlootPricesDB: "itemId,kind,sourceId,drops,windows,installs,tier;..." (older files omit tier) grouped by item, best
--- rate first, with an Adler-32 `sum`. Searched, not parsed, like the prices: a tooltip reads its item's run only.
local function dropFile()
  if drops == nil then loadBlock("drops", "drop sources", function(entry) drops = entry end, function() return drops end) end
  return drops
end

--- The sources block: "itemId,npcId/npcId,reagentOf;..." one row per item, items ascending, with an Adler-32 `sum`.
--- The vendors are the NPCs the site has public rows selling the item, the count is how many recipes it is a basic
--- reagent of, by the site's own three-installs rule. A file from an app that does not write the block is "absent".
local function sourceFile()
  if sources == nil then loadBlock("sources", "item sources", function(entry) sources = entry end, function() return sources end) end
  return sources
end

--- One item's public sources from the file: { vendors = { npcId, ... }, reagentOf = n, names = { n116 = name } }.
--- Nil while the block is missing, being checked or failed, and when the file has no row for the item.
function E:PublicSources(itemId)
  local entry = sourceFile()
  if entry.status ~= "ready" then return nil end
  local at = entry.data:find(";" .. itemId .. ",", 1, true)
  if not at then return nil end
  local text = entry.data:match("^;([^;]+)", at)
  local id, vendors, reagentOf = text:match("^(%d+),([%d/]*),(%d+)$")
  if tonumber(id) ~= itemId then return nil end
  local ids = {}
  for npcId in vendors:gmatch("%d+") do ids[#ids + 1] = tonumber(npcId) end
  return { vendors = ids, reagentOf = tonumber(reagentOf), names = entry.names }
end

local function dropTier(installs)
  return installs >= 3 and "confirmed" or installs == 2 and "verified" or "reported"
end

-- Read both the tiered file and an older six-field row. Counts always determine the displayed tier.
local function dropRow(text)
  local item, kind, source, dropped, windows, installs = text:match("^(%d+),([no]),(%d+),(%d+),(%d+),(%d+),%a+$")
  if not item then item, kind, source, dropped, windows, installs = text:match("^(%d+),([no]),(%d+),(%d+),(%d+),(%d+)$") end
  return item, kind, source, dropped, tonumber(windows), tonumber(installs)
end

--- One item's public sources, best rate first: { { kind = "npc" | "object", id, drops, windows, installs } }.
--- Nil while the block is missing, being checked or failed; an empty list when the file has none for the item.
function E:DropSources(itemId)
  local entry = dropFile()
  if entry.status ~= "ready" then return nil end
  local out = {}
  local at = entry.data:find(";" .. itemId .. ",", 1, true)
  while at do
    local text = entry.data:match("^;([^;]+)", at)
    if not text then break end
    local id, kind, source, dropped, windows, installs = dropRow(text)
    if tonumber(id) ~= itemId then break end
    windows, installs = tonumber(windows), tonumber(installs)
    if windows > 0 and installs >= E.DROP_INSTALLS then
      out[#out + 1] = { kind = kind == "n" and "npc" or "object", id = tonumber(source), drops = tonumber(dropped),
        windows = windows, installs = installs, tier = dropTier(installs) }
    end
    at = at + #text + 1
  end
  return out
end

--- The items one source drops at confirmed rates, for the collection tree, best rate first:
--- { { itemId, drops, windows, installs } }. `kind` is "npc" or "object". Nil and the block's status ("absent",
--- "verifying" or "bad") while the block cannot be read. The block is indexed by source once, the first time it is asked.
function E:DropsFrom(kind, id)
  local entry = dropFile()
  if entry.status ~= "ready" then return nil, entry.status end
  if not entry.bySource then
    local index = {}
    for text in entry.data:gmatch("[^;]+") do
      local item, k, source, dropped, windows, installs = dropRow(text)
      if item and windows > 0 and installs >= 3 then
        local list = index[k .. source] or {}
        list[#list + 1] = { itemId = tonumber(item), drops = tonumber(dropped), windows = windows, installs = installs, tier = dropTier(installs) }
        index[k .. source] = list
      end
    end
    for _, list in pairs(index) do
      table.sort(list, function(a, b)
        local ra, rb = a.drops / a.windows, b.drops / b.windows
        if ra ~= rb then return ra > rb end
        return a.itemId < b.itemId
      end)
    end
    entry.bySource = index
  end
  return entry.bySource[(kind == "npc" and "n" or "o") .. id] or {}, "ready"
end

--- The NPCs the drops block names `name`, case aside, as a list of ids: the block's names are the site's. Empty while
--- the block cannot be read or names no such NPC.
function E:NpcsNamed(name)
  local entry = dropFile()
  if entry.status ~= "ready" or type(name) ~= "string" then return {} end
  if not entry.byName then
    entry.byName = {}
    for key, n in pairs(entry.names) do
      local id = key:match("^n(%d+)$")
      if id then
        local list = entry.byName[n:lower()] or {}
        list[#list + 1] = tonumber(id)
        entry.byName[n:lower()] = list
      end
    end
    for _, list in pairs(entry.byName) do table.sort(list) end
  end
  return entry.byName[name:lower()] or {}
end

--- The drop lines for one item as { text, r, g, b }, and a note when there is nothing to show: no source with a reporter, no drops block in the file, or a failed checksum. Nil and nil while the block is still being checked.
--- A rate carries its windows; only old uploads need a date beneath the sources.
function E:DropLines(itemId)
  local entry = dropFile()
  if entry.status == "absent" then return {}, "drop sources not in the price file yet" end
  if entry.status == "bad" then return {}, "drop sources failed their checksum" end
  local sources = E:DropSources(itemId)
  if not sources then return nil, nil end
  if #sources == 0 then return {}, "no drop source reported yet" end
  local out = {}
  for i = 1, math.min(#sources, E.DROP_SOURCES_SHOWN) do
    local s = sources[i]
    local source = string.format("%s %d", s.kind == "npc" and "NPC" or "object", s.id)
    local percent = 100 * s.drops / s.windows
    local rate = string.format(percent < 1 and "%.1f%%" or "%.0f%%", percent)
    local value = rate .. " · " .. s.windows .. " windows · " .. s.tier
    -- A source is named as this install's client showed it (its own rows, modules/openworld.lua), else by the name
    -- the site knows (the slot file's names). Chat keeps the id beside the name, the tooltip shows the name alone.
    local name = (E.SourceName and E:SourceName(s.kind, s.id)) or entry.names[(s.kind == "npc" and "n" or "o") .. s.id]
    local label = name or (s.kind == "npc" and "an unnamed NPC" or "an unnamed object")
    local said = label .. " (" .. source .. ")"
    -- `text` is the plain sentence for chat and a tooltip without two columns. The game's tooltip shows `left` and
    -- `right` as a row, the rate and windows in the value column like a price.
    out[#out + 1] = { r = 0.9, g = 0.8, b = 0.5, wrap = true,
      text = "Everloot drop: " .. said .. " · " .. value,
      left = "Drops from " .. label, right = value }
  end
  local day = E.StaleDay(entry.asOf)
  if day then
    out[#out + 1] = { r = 0.788, g = 0.765, b = 0.69, wrap = true, text = "  drops as of " .. day }
  end
  local more = #sources - E.DROP_SOURCES_SHOWN
  if more > 0 then
    out[#out + 1] = { r = 0.788, g = 0.765, b = 0.69, wrap = true,
      text = string.format("  %d more %s", more, more == 1 and "source" or "sources") }
  end
  return out, nil
end
