-- Everloot /ask, the file bridge. A question waits in SavedVariables (written at logout or /reload);
-- the companion answers it into the EverlootAnswers addon, which this module reads on the next load.
-- Nothing here talks to the network or plays the character.

local E = Everloot
local MAX_QUESTION, MAX_PENDING = 500, 20

--- The realm the player is on, sent with the question so a price question needs no realm in its words. Only a
--- plain name goes: anything else is left out and the companion asks which realm.
local function currentRealm()
  local realm = GetRealmName and GetRealmName()
  if type(realm) ~= "string" then return nil end
  realm = realm:gsub("^%s+", ""):gsub("%s+$", "")
  if #realm < 2 or #realm > 40 or realm:find("[%c|]") then return nil end
  return realm
end

function E:Ask(text)
  local question = type(text) == "string" and (text:gsub("^%s+", ""):gsub("%s+$", "")) or ""
  if question == "" then
    print("Everloot: type a question after /ask.")
    return
  end
  if #question > MAX_QUESTION then
    print("Everloot: that question is too long (500 characters at most).")
    return
  end
  EverlootDB.asks = EverlootDB.asks or {}
  -- A waiting question is only removed by its answer, so a full queue turns the new question away: dropping
  -- the oldest would lose a question whose answer the companion may be about to write.
  if #EverlootDB.asks >= MAX_PENDING then
    print(string.format("Everloot: %d questions are already waiting for answers, so this one was not added. Keep the companion running and /reload to read the answers, then ask again.", MAX_PENDING))
    return
  end
  EverlootDB.askCounter = (EverlootDB.askCounter or 0) + 1
  table.insert(EverlootDB.asks, {
    id = "ask:" .. EverlootDB.installId .. ":" .. EverlootDB.askCounter,
    question = question,
    askedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    realm = currentRealm(),
  })
  print("Everloot: question saved. Keep the companion running, then /reload to read the answer.")
end

--- Show each verified answer once; an answered question leaves the queue, a failed checksum stays.
local function showAnswers()
  if type(EverlootAnswersDB) ~= "table" or type(EverlootDB.asks) ~= "table" then return end
  local waiting = {}
  for _, ask in ipairs(EverlootDB.asks) do
    local a = EverlootAnswersDB[ask.id]
    if type(a) == "table" and type(a.answer) == "string" and a.sum == E.Adler32(a.answer) then
      print("Everloot — " .. ask.question)
      local source = (type(a.source) == "string" and a.source ~= "none") and (" (Source: " .. a.source .. ")") or ""
      print("  " .. a.answer .. source)
    else
      if type(a) == "table" then
        print("Everloot: the answer to \"" .. ask.question .. "\" failed its checksum and was not shown.")
      end
      waiting[#waiting + 1] = ask
    end
  end
  EverlootDB.asks = waiting
end

SLASH_EVERLOOTASK1 = "/ask"
SlashCmdList["EVERLOOTASK"] = function(msg) E:Ask(msg) end

E:RegisterModule("ask", function()
  showAnswers()
  return "ready (/ask; answers show after /reload)"
end)
