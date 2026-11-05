-- Everloot drop sources in item tooltips: the public drop rates (three installs looted the source) the Desktop App
-- wrote into the EverlootPrices slot addon beside the prices (checksummed; they show after /reload).
-- Display only: nothing here talks to the network, and nothing is written to SavedVariables.

local E = Everloot

E.DROP_INSTALLS = 3        -- as the site: a rate is public once three installs looted its source
E.DROP_SOURCES_SHOWN = 3   -- tooltip lines per item; the rest are counted

-- The drops block: { status = "absent" | "verifying" | "ready" | "bad", data, asOf }.
local drops

function E:ResetDrops()
  drops = nil
end

--- The drops block of EverlootPricesDB: "itemId,kind,sourceId,drops,windows,installs;..." grouped by item, best
--- rate first, with an Adler-32 `sum`. Searched, not parsed, like the prices: a tooltip reads its item's run only.
local function dropFile()
  if drops == nil then
    local db = type(EverlootPricesDB) == "table" and EverlootPricesDB.drops
    if type(db) ~= "table" then
      drops = { status = "absent" }
    elseif type(db.data) ~= "string" or type(db.sum) ~= "number" then
      drops = { status = "bad" }
      print("Everloot: drop sources failed their checksum and are not shown.")
    else
      local entry = { status = "verifying", data = ";" .. db.data .. ";", asOf = db.dataAsOf }
      drops = entry
      E.VerifyChecksum(db.data, db.sum, function(ok)
        if drops ~= entry then return end -- reset while checking
        entry.status = ok and "ready" or "bad"
        if not ok then
          entry.data = nil
          print("Everloot: drop sources failed their checksum and are not shown.")
        end
      end)
    end
  end
  return drops
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
    local id, kind, source, dropped, windows, installs = text:match("^(%d+),([no]),(%d+),(%d+),(%d+),(%d+)$")
    if tonumber(id) ~= itemId then break end
    windows, installs = tonumber(windows), tonumber(installs)
    if windows > 0 and installs >= E.DROP_INSTALLS then
      out[#out + 1] = { kind = kind == "n" and "npc" or "object", id = tonumber(source), drops = tonumber(dropped),
        windows = windows, installs = installs }
    end
    at = at + #text + 1
  end
  return out
end

--- The drop lines for one item as { text, r, g, b }, and a note when there is nothing to show: no source with three
--- installs, no drops block in the file, or a failed checksum. Nil and nil while the block is still being checked.
--- A rate always carries its denominator (loot windows), its installs and the date of the uploads behind it.
function E:DropLines(itemId)
  local entry = dropFile()
  if entry.status == "absent" then return {}, "drop sources not in the price file yet" end
  if entry.status == "bad" then return {}, "drop sources failed their checksum" end
  local sources = E:DropSources(itemId)
  if not sources then return nil, nil end
  if #sources == 0 then return {}, "no drop source reported by " .. E.DROP_INSTALLS .. " installs" end
  local out = {}
  for i = 1, math.min(#sources, E.DROP_SOURCES_SHOWN) do
    local s = sources[i]
    out[#out + 1] = { r = 0.9, g = 0.8, b = 0.5, wrap = true, text = string.format("Everloot drop: %s %d · %.1f%% (%d of %d loot windows) · %d installs",
      s.kind == "npc" and "NPC" or "object", s.id, 100 * s.drops / s.windows, s.drops, s.windows, s.installs) }
  end
  local day = type(entry.asOf) == "string" and entry.asOf:match("^%d%d%d%d%-%d%d%-%d%d")
  local more = #sources - E.DROP_SOURCES_SHOWN
  local tail = more > 1 and string.format(" · %d more sources", more) or more == 1 and " · 1 more source" or ""
  out[#out + 1] = { r = 0.788, g = 0.765, b = 0.69, wrap = true,
    text = "  " .. (day and ("drop rates from uploads as of " .. day) or "drop rates: upload date unknown") .. tail }
  return out, nil
end
