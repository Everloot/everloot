import { expect, test } from "vitest";
import wtf from "wtf_wikipedia";
import { countDamage, repairTemplates, REPAIRED_TEMPLATES } from "../src/importers/wiki-templates.js";

test("money templates render as gold, silver and copper", () => {
  expect(repairTemplates("purchased for {{cost|300}} at {{rep|honored}} standing")).toBe("purchased for 300g at Honored standing");
  expect(repairTemplates("{{cost|1|50|0}}")).toBe("1g 50s");
  expect(repairTemplates("{{cost|||25}}")).toBe("25c");
  expect(repairTemplates("{{money|2|5|9}}")).toBe("2g 5s 9c");
  expect(repairTemplates("5{{g}} 3{{s}} 7{{c}}")).toBe("5g 3s 7c");
});

test("NPC templates keep the name and drop the faction and icon", () => {
  expect(repairTemplates("{{NPC|Alliance|Hiren Loresong}} at [[Violet Rise]]")).toBe("Hiren Loresong at [[Violet Rise]]");
  expect(repairTemplates("{{NPC||Jaina Proudmoore|icon=Jaina2}}")).toBe("Jaina Proudmoore");
  expect(repairTemplates("{{npc|Horde|Vasarin Redmorn}}")).toBe("Vasarin Redmorn");
});

test("item, quest, spell, zone and ability links render as their display text or name", () => {
  expect(repairTemplates("{{item|Thunderfury}}")).toBe("Thunderfury");
  expect(repairTemplates("{{item|epic|Thunderfury}}")).toBe("Thunderfury");
  expect(repairTemplates("{{item|Thunderfury|the sword}}")).toBe("the sword");
  expect(repairTemplates("{{quest|Return to Sender}}")).toBe("Return to Sender");
  expect(repairTemplates("{{spell|Fireball}}, {{zone|Nazmir}}, {{ability|Charge}}")).toBe("Fireball, Nazmir, Charge");
  expect(repairTemplates("{{item|\n Thunderfury}}")).toBe("Thunderfury");
});

test("race, standing and patch templates render to words", () => {
  expect(repairTemplates("{{Race|High elf}}")).toBe("High elf");
  expect(repairTemplates("{{faction standing|Revered}}")).toBe("Revered");
  expect(repairTemplates("* {{Patch 5.2.0|note=Added.}}")).toBe("* Patch 5.2.0: Added.");
  expect(repairTemplates("* {{Patch 10.0.2|note=Now sold by {{NPC||Grex}}.}}")).toBe("* Patch 10.0.2: Now sold by Grex.");
});

test("icons, hatnotes and stubs vanish without leaving double spaces", () => {
  expect(repairTemplates("Sold by {{Horde icon small}} Grex")).toBe("Sold by Grex");
  expect(repairTemplates("{{Alliance icon}} Only")).toBe("Only");
  expect(repairTemplates("{{ss|Dread Wastes}}\n{{Stub/NPC}}\nText")).toBe("Text");
  expect(repairTemplates("{{for|the achievement|Kirin Tor Offensive (achievement)}}\n{{Removed|patch=4.0.1}}\nBody")).toBe("Body");
});

test("code tags keep their text, with templates rendered inside them", () => {
  expect(wtf("Use <code>/run foo</code> now.").text()).toBe("Use  now.");
  expect(wtf(repairTemplates("Use <code>/run foo</code> now.")).text()).toBe("Use /run foo now.");
  expect(wtf(repairTemplates("Sold for <code>{{cost|1|50}}</code> by <code>{{npc|Horde|Grex}}</code>.")).text()).toBe("Sold for 1g 50s by Grex.");
  expect(wtf(repairTemplates('A <CODE class="x"><nowiki>C_Map.GetBestMapForUnit</nowiki></CODE> b')).text()).toBe("A C_Map.GetBestMapForUnit b");
  expect(repairTemplates("<code>a\nb</code> c")).toBe("a\nb c");
});

test("unknown templates are left for the converter", () => {
  expect(repairTemplates("{{Companions|Critter}} and {{npcbox|name=x}}")).toBe("{{Companions|Critter}} and {{npcbox|name=x}}");
});

test("the repaired list is exported for the coverage page", () => {
  expect(REPAIRED_TEMPLATES).toContain("cost");
  expect(REPAIRED_TEMPLATES).toContain("npc");
  expect(REPAIRED_TEMPLATES).toContain("rep");
});

test("countDamage counts the known breakage patterns", () => {
  expect(countDamage("purchased for at standing")).toBe(2);
  expect(countDamage("A clean sentence.")).toBe(0);
  expect(countDamage("two  spaces")).toBe(1);
  expect(countDamage("sold at  the shop")).toBe(2);
});

test("'for at least' and its kin are English, not a removed template", () => {
  for (const text of ["stays hidden for at least one update", "for at most two hours", "for at all", "for at once"]) expect(countDamage(text)).toBe(0);
  expect(countDamage("purchased for at Honored")).toBe(1);
});

test("repair keeps blank lines and leading spaces: paragraphs and preformatted text survive", () => {
  const src = "First paragraph.\n\nSecond {{rep|honored}} paragraph.\n\n== History ==\nThird.\n\n Pre line";
  expect(repairTemplates(src)).toBe("First paragraph.\n\nSecond Honored paragraph.\n\n== History ==\nThird.\n\n Pre line");
  expect(repairTemplates("{{ss|Zone}}\n\nBody.\n\nMore.")).toBe("Body.\n\nMore.");
});

test("a stray opening brace does not stop repair for the rest of the page", () => {
  expect(repairTemplates("{{ stray\nSold for {{cost|1}} at {{rep|honored}}.")).toBe("{{ stray\nSold for 1g at Honored.");
});

test("repair is linear: 20,000 templates in well under a second", () => {
  const big = "Sold for {{cost|1|2|3}} by {{NPC||Grex}}. ".repeat(10_000);
  const start = performance.now();
  const out = repairTemplates(big);
  expect(performance.now() - start).toBeLessThan(800);
  expect(out).not.toContain("{{");
  expect(out.startsWith("Sold for 1g 2s 3c by Grex.")).toBe(true);
});

test("zero money and empty standings leave no dangling words", () => {
  expect(repairTemplates("Bought for {{cost|0|0|0}}.")).toBe("Bought for 0c.");
  expect(countDamage(repairTemplates("Bought for {{cost|0|0|0}} at {{rep|honored}} standing."))).toBe(0);
});

test("deep nesting stays linear: past the depth cap, braces are kept as text", () => {
  const deep = "{{a".repeat(20_000) + "}}".repeat(20_000);
  const start = performance.now();
  expect(repairTemplates(`x ${deep} {{cost|1}}`)).toBe(`x ${deep} 1g`);
  expect(performance.now() - start).toBeLessThan(800);
});

test("a removed template mid-line keeps the line's own leading space", () => {
  expect(repairTemplates(" pre {{stub}}")).toBe(" pre");
  expect(repairTemplates("{{ss|Zone}} Text after")).toBe("Text after");
});

test("faction icons {{Alliance}}, {{Horde}} and {{Neutral}} vanish without a gap", () => {
  expect(repairTemplates("can be purchased from {{Alliance}} [[Dawn-Seeker Kasrek]] in [[Stormshield]] or {{Horde}} [[Dawn-Seeker Skariss]] in [[Warspear]]"))
    .toBe("can be purchased from [[Dawn-Seeker Kasrek]] in [[Stormshield]] or [[Dawn-Seeker Skariss]] in [[Warspear]]");
  expect(repairTemplates("*{{Neutral}} [[Amber Ledge]], at Borean Tundra.")).toBe("* [[Amber Ledge]], at Borean Tundra.");
  expect(repairTemplates("| capital = {{Horde|sort=}} [[Thunder Bluff]]")).toBe("| capital = [[Thunder Bluff]]");
  expect(repairTemplates("==={{Alliance}} Alliance===")).toBe("=== Alliance===");
});

test("Wikipedia and alternate-universe links show their label or the article name", () => {
  expect(repairTemplates("holds similarities to the {{wp|Beringia}} \"ice bridge\" theory."))
    .toBe("holds similarities to the Beringia \"ice bridge\" theory.");
  expect(repairTemplates("the {{wp|Thunderbird (mythology)|Thunderbird}} appears")).toBe("the Thunderbird appears");
  expect(repairTemplates("The word \"tauren\" is an {{wplink|anagram}} of \"nature\"")).toBe("The word \"tauren\" is an anagram of \"nature\"");
  expect(repairTemplates("While leveling on {{Au|Draenor}} during")).toBe("While leveling on Draenor during");
  expect(repairTemplates("{{Au|Draenor|alternate Draenor}}")).toBe("alternate Draenor");
});

test("{{coppercost}} splits one copper amount into gold, silver and copper", () => {
  expect(repairTemplates("You will receive: {{coppercost|86000}} (or {{coppercost|104600}} at max level)"))
    .toBe("You will receive: 8g 60s (or 10g 46s at max level)");
  expect(repairTemplates("You will receive: {{coppercost|13}} (or {{coppercost|30}} at max level)"))
    .toBe("You will receive: 13c (or 30c at max level)");
  expect(repairTemplates("{{coppercost|1300}}")).toBe("13s");
  expect(repairTemplates("{{coppercost|0}}")).toBe("0c");
});

test("{{loot}} shows the item name or its label, dropping the quality", () => {
  expect(repairTemplates("A '''Blue Ribboned Holiday Gift''' is a {{loot|common|Wrapped Gift Package}} container item"))
    .toBe("A '''Blue Ribboned Holiday Gift''' is a Wrapped Gift Package container item");
  expect(repairTemplates("{{loot|common|Love Token|Love Tokens}}")).toBe("Love Tokens");
  expect(repairTemplates("{{loot|epic|Emblem of Valor|Valor}}")).toBe("Valor");
});

test("{{cv-AH}} shows both faction variants joined by \"or\"", () => {
  expect(repairTemplates("This item is created with {{cv-AH|[[Battle for Azeroth proficiency|Kul Tiran]]|[[Battle for Azeroth|Zandalari]]}} [[Tailoring]]"))
    .toBe("This item is created with [[Battle for Azeroth proficiency|Kul Tiran]] or [[Battle for Azeroth|Zandalari]] [[Tailoring]]");
  expect(repairTemplates("is sold by {{cv-AH|{{NPC||Trader Narasu}}|{{NPC||Provisioner Nasela}}}} in {{cv-AH|[[Telaar]]|[[Garadar]]}} in [[Nagrand]]"))
    .toBe("is sold by Trader Narasu or Provisioner Nasela in [[Telaar]] or [[Garadar]] in [[Nagrand]]");
  expect(repairTemplates("when {{cv-AH|Kul Tiran|Zandalari|}} tailoring is taught.")).toBe("when Kul Tiran or Zandalari tailoring is taught.");
});

test("a sentence that broke on these templates converts without damage", () => {
  const src = "can be purchased from {{Alliance}} [[Dawn-Seeker Kasrek]] in [[Stormshield]] or {{Horde}} [[Dawn-Seeker Skariss]] in [[Warspear]] for {{Cost|10,000}}.";
  expect(countDamage(wtf(src).text())).toBeGreaterThan(0);
  expect(countDamage(wtf(repairTemplates(src)).text())).toBe(0);
});

test("{{co}} and {{coords}} show the map coordinates in brackets", () => {
  expect(repairTemplates("f Hearthglen are at {{co|48|21|Western Plaguelands}}.")).toBe("f Hearthglen are at [48, 21].");
  expect(repairTemplates("| location = [[Booty Bay]], [[Cape of Stranglethorn]]{{coords|43.1|73.0|Cape of Stranglethorn}}"))
    .toBe("| location = [[Booty Bay]], [[Cape of Stranglethorn]][43.1, 73.0]");
  expect(repairTemplates("{{co|47|78|Arathi Highlands||1}}")).toBe("[47, 78]");
  expect(repairTemplates("{{coords}}")).toBe("[0, 0]");
});

test("{{reputation}} and {{quality}} show the label, else the standing or quality as written", () => {
  expect(repairTemplates("to go from {{reputation|revered}} to {{reputation|exalted}}, 880 kills total"))
    .toBe("to go from revered to exalted, 880 kills total");
  expect(repairTemplates("*[[Mantles of the Dawn]] ({{reputation|Revered}})")).toBe("*[[Mantles of the Dawn]] (Revered)");
  expect(repairTemplates("especially {{quality|epic}} ones")).toBe("especially epic ones");
  expect(repairTemplates("Teaches only {{Quality|poor|Apprentice}} level.")).toBe("Teaches only Apprentice level.");
  expect(repairTemplates("{{quality|rare|Thunderfury|Thunderfury, Blessed Blade|nobold=1}}")).toBe("Thunderfury, Blessed Blade");
});

test("{{costitem}} shows the count and the item name", () => {
  expect(repairTemplates("| [[Plans: Vicious Pyrium Breastplate]] || {{Costitem|5|Pyrium Bar}}"))
    .toBe("| [[Plans: Vicious Pyrium Breastplate]] || 5 Pyrium Bar");
  expect(repairTemplates("{{costitem|1500|Gold Ore}}")).toBe("1,500 Gold Ore");
  expect(repairTemplates("{{costitem||Pyrium Bar}}")).toBe("1 Pyrium Bar");
  expect(repairTemplates("{{costitem|5}}")).toBe("5");
});

test("{{cost}} shows its named currencies after the coins, in the template's order", () => {
  expect(repairTemplates("for {{cost|eo=500}} and")).toBe("for 500 Elemental Overflow and");
  expect(repairTemplates("{{cost|sts=10}}")).toBe("10 Storm Sigil");
  expect(repairTemplates("{{cost|5|hon=1500|ach=10}}")).toBe("5g 10 Achievement point 1500 Honor");
  expect(repairTemplates("{{cost|g=2|s=50}}")).toBe("2g 50s");
  expect(repairTemplates("{{cost|es=30}}")).toBe("30 Eye of the Storm Mark of Honor");
  expect(repairTemplates("{{cost|cost=3|name=Mark of Sargeras|icon=inv_misc_token.png}}")).toBe("3 Mark of Sargeras");
});

test("sentences that broke on {{reputation}}, {{costitem}} and {{cost}} currencies convert without damage", () => {
  const vendor = "is sold by [[Mythressa]] for {{cost|eo=500}} and [[Rethelshi]] in [[Valdrakken]] for {{cost|sts=10}} {{costitem|1|Helm of Raging Tempests}}.";
  expect(wtf(repairTemplates(vendor)).text()).toBe(
    "is sold by Mythressa for 500 Elemental Overflow and Rethelshi in Valdrakken for 10 Storm Sigil 1 Helm of Raging Tempests.",
  );
  for (const src of [
    "He was {{reputation|friendly}} towards the [[Horde]] and the [[Alliance]], although once the escort quest was started he became {{reputation|neutral}} to the Alliance.",
    "The '''{{quality|Rare|Toxic Revenger}}''' is a one-handed dagger",
    "Rare blue items are between {{quality|uncommon|uncommon|green}} and {{quality|epic|epic|purple}} in [[quality]].",
  ]) {
    expect(countDamage(wtf(src).text())).toBeGreaterThan(0);
    expect(countDamage(wtf(repairTemplates(src)).text())).toBe(0);
  }
  expect(wtf(repairTemplates("purchase it for {{costitem|1|Apexis Crystal (item)}} {{costitem|50|Apexis Shard}} from")).text())
    .toBe("purchase it for 1 Apexis Crystal (item) 50 Apexis Shard from");
});

test("{{api}} shows the label or the name, and keeps a function's argument list", () => {
  expect(repairTemplates("the return of {{api|GetSubZoneText}}() or {{api|GetZoneText}}()")).toBe("the return of GetSubZoneText() or GetZoneText()");
  expect(repairTemplates("{{api|CreateFrame()}} and {{api|t=w|ScriptRegion:EnableMouse|EnableMouse}}")).toBe("CreateFrame() and EnableMouse");
  expect(repairTemplates("via {{api|t=wh|OnEvent}} handlers")).toBe("via OnEvent handlers");
});

test("icon-only templates (race, class, socket, quest marker, expansion logo) vanish", () => {
  expect(repairTemplates("{{RaceIcon|Human|Male}} Human")).toBe("Human");
  expect(repairTemplates("{{ClassIcon|Mage|small}} Mage and {{socket icon|Red}} gem")).toBe("Mage and gem");
  expect(repairTemplates("Accept {{QuestStart}} the quest {{Wotlk-inline|}} patch")).toBe("Accept the quest patch");
});

test("{{mob}}, {{fu}}, {{expac}}, {{achievement}}, {{school}}, {{gossip}}, {{keypress}} and the wiki links render their name or label", () => {
  expect(repairTemplates("kill {{Mob|C'Thun (tactics)||C'Thun}} and {{mob|Blackhand Elite}}")).toBe("kill C'Thun and Blackhand Elite");
  expect(repairTemplates("{{Fu|Durotan}} of the {{fu|Frostwolf clan|Frostwolves}}")).toBe("Durotan of the Frostwolves");
  expect(repairTemplates("added in {{expac|Dragonflight}}")).toBe("added in Dragonflight");
  expect(repairTemplates("earn {{achievement|icon=|Kul Tiran Curator}} or {{achievement|The Fishing Diplomat|the fish}}")).toBe("earn Kul Tiran Curator or the fish");
  expect(repairTemplates("{{School|Fire}} damage, {{Gossip|Um, what?}}, press {{keypress|Shift|1}}")).toBe("Fire damage, Um, what?, press Shift+1");
  expect(repairTemplates("{{Sc|Ares (game)|Project Ares}} {{dash}} {{StarCraft|Nova}}")).toBe("Project Ares – Nova");
});

test("{{title}} shows its text in angle brackets", () => {
  expect(repairTemplates("Cheese Vendor {{title|Cheese Vendor}}")).toBe("Cheese Vendor <Cheese Vendor>");
});

test("sentences that broke on {{RaceIcon}} and {{mob}} convert without damage", () => {
  for (const src of [
    "Fought {{RaceIcon|Human|Male}} Varian at {{RaceIcon|Orc|Male}} Garrosh",
    "She kills {{Mob|Lady Vashj (tactics)||Lady Vashj}} at {{mob|Sunblade Imp}} too",
  ]) {
    expect(countDamage(wtf(src).text())).toBeGreaterThan(0);
    expect(countDamage(wtf(repairTemplates(src)).text())).toBe(0);
  }
});

test("{{-}} renders as the em dash the wiki shows", () => {
  // Into the Basin's criteria: the dash was dropped, "The Wolvar after completing Just Following Orders".
  expect(repairTemplates("*2. ''The Wolvar'' {{-}} after completing [[Just Following Orders]].")).toBe("*2. ''The Wolvar'' — after completing [[Just Following Orders]].");
  expect(repairTemplates("A {{–}} B")).toBe("A — B");
});

test("doubled spaces the wiki source has are collapsed, as the wiki shows them", () => {
  for (const [src, before, after] of [
    ["*2. ''The Wolvar'' {{-}} after  completing [[Just Following Orders]].", "The Wolvar after  completing Just Following Orders.", "The Wolvar — after completing Just Following Orders."],
    ["'''Garn Cloudsong ''' is a [[tauren]] [[shaman trainer]].", "Garn Cloudsong  is a tauren shaman trainer.", "Garn Cloudsong is a tauren shaman trainer."],
    ["* In ''[[World of Warcraft: Classic| Classic]]'', mechanical mobs are immune.", "In  Classic, mechanical mobs are immune.", "In Classic, mechanical mobs are immune."],
  ]) {
    expect(wtf(src).text().trim().replace(/^\* (\d\. )?/, "")).toBe(before);
    expect(wtf(repairTemplates(src)).text().trim().replace(/^\* (\d\. )?/, "")).toBe(after);
    expect(countDamage(before)).toBeGreaterThan(0);
    expect(countDamage(after)).toBe(0);
  }
  // A line that starts with a space is preformatted on the wiki, which shows its spaces.
  expect(repairTemplates(" for i=1,2 do  print(i) end")).toBe(" for i=1,2 do  print(i) end");
});

test("footnotes in a row leave no gap", () => {
  const src = "'''Helhounds'''<ref>[[Feral Helhound]]</ref><ref>[[Helhound Hair Bracers]]</ref><ref>[[Frothing Helhound's Fury]]</ref> are gigantic, three-headed [[hound]]s.";
  expect(wtf(src).text()).toBe("Helhounds  are gigantic, three-headed hounds.");
  expect(repairTemplates(src)).toBe("'''Helhounds''' are gigantic, three-headed [[hound]]s.");
  expect(repairTemplates("the Third War,<ref name=\"encyclopedia508\"/> the night elf")).toBe("the Third War, the night elf");
  expect(repairTemplates("See below.\n<references/>")).toBe("See below.\n<references/>");
});

test("{{Race}} shows its label, or only an icon with notext, and icons in a row leave one space", () => {
  // The Horde page's list of allies read "Gilgoblin  Unshackled - A faction of former naga slaves."
  expect(repairTemplates("{{Race|Gilgoblin|notext}}{{RaceIcon|Skrog}}{{RaceIcon|Makrura}} [[Unshackled]] - A faction of former [[naga]] slaves."))
    .toBe("[[Unshackled]] - A faction of former [[naga]] slaves.");
  expect(repairTemplates("Fought by {{Race|Orc|orcs}} and {{Race|High elf}}.")).toBe("Fought by orcs and High elf.");
  expect(repairTemplates("Led by Genn Greymane and {{RaceIcon|Worgen|Male}}{{RaceIcon|Human|Male}} [[Darius Crowley]].")).toBe("Led by Genn Greymane and [[Darius Crowley]].");
});

test("spaces inside code, pre, nowiki, poem and syntaxhighlight are kept as written", () => {
  expect(wtf(repairTemplates('<code>ignored  pad; local key = "a  b"</code>')).text()).toContain('local key = "a  b"');
  for (const src of [
    "<pre>\nlocal  x = 1\nlocal  y\n</pre>",
    "a <nowiki>x  y</nowiki> b",
    "<poem>\nRoses  are\nred</poem>",
    '<syntaxhighlight lang="lua">\nlocal  s = "a  b"\n</syntaxhighlight>',
    "<SOURCE>a  b</SOURCE> and <!-- a  b -->",
  ]) expect(repairTemplates(src)).toBe(src);
  // Outside them the run still collapses.
  expect(repairTemplates("a  <nowiki>x  y</nowiki>  b")).toBe("a <nowiki>x  y</nowiki> b");
});

test("a <ref> inside a comment or a quoted attribute does not swallow prose", () => {
  expect(wtf(repairTemplates("Intro <!-- <ref> --> KEEP <ref>source</ref> tail.")).text()).toBe("Intro KEEP tail.");
  expect(wtf(repairTemplates('A<ref name="a>b" />KEEP<ref>citation</ref>C')).text()).toBe("AKEEPC");
  expect(repairTemplates("Name<ref name=Kael'thas/> is here")).toBe("Name is here");
  // A quote that never closes before the next tag ends at the first ">", as on the wiki (Hakkar the Soulflayer).
  expect(repairTemplates("into the world.<ref name=\"Chronicle SunkenTemple>''[[World of Warcraft: Chronicle Volume 3]]'', pg. 122</ref> The Atal'ai's spiritual leader, [[Jammal'an]], had a prophecy.\"")).toBe("into the world. The Atal'ai's spiritual leader, [[Jammal'an]], had a prophecy.\"");
  expect(repairTemplates("t<ref>a</references>b</ref>c")).toBe("tc");
  expect(repairTemplates("x<ref>a</ref> y\n<references/>")).toBe("x y\n<references/>");
  // A ref that never closes is left for the converter, as before.
  expect(repairTemplates("x<ref>never closed")).toBe("x<ref>never closed");
  // A malformed tag ends at the first ">", as on the wiki (Nightbane pack).
  expect(repairTemplates('when captured,<ref name="Bane" /<ref name="Yorgen" /> as well as [[Manor Mistmantle]].')).toBe("when captured, as well as [[Manor Mistmantle]].");
  // A comment inside a ref does not end it.
  expect(wtf(repairTemplates("A<ref><!-- </ref> -->citation</ref>KEEP")).text()).toBe("AKEEP");
});

test("letters that grow when lower-cased do not shift where tags are found", () => {
  // "İ".toLowerCase() is two characters; reading tags from a fully lower-cased copy cut text in the wrong place.
  expect(wtf(repairTemplates("A<ref>İİİİİİİİ</ref>KEEP <b>tail</b>")).text()).toBe("AKEEP tail");
  expect(wtf(repairTemplates("<code>İ</code>KEEP")).text()).toBe("İKEEP");
});

test("verbatim tags stay as written even when unclosed, long, or holding a close tag in <nowiki>", () => {
  // An unclosed <pre> runs to the end of the page.
  expect(repairTemplates('<pre>local key = "a  b"; <ref>LITERAL</ref>')).toBe('<pre>local key = "a  b"; <ref>LITERAL</ref>');
  // A </code> inside <nowiki> does not close the <code>, and the ref after it is code, not a footnote.
  expect(repairTemplates("<code><nowiki></code>KEEP  <ref>LITERAL</ref></nowiki></code>")).toBe("</code>KEEP  <ref>LITERAL</ref>");
  // An opening tag of any length is read.
  expect(repairTemplates("<code " + " ".repeat(2000) + '>local key = "a  b"</code>')).toBe('local key = "a  b"');
  // The characters that mark held text are themselves held when the page has them.
  expect(repairTemplates("a\u0002 0\u0003  b")).toBe("a\u0002 0\u0003 b");
});

test("long space runs, unclosed tags and near-miss close tags convert in linear time", () => {
  const n = 8_000;
  for (const src of [
    "a" + " ".repeat(40_000) + "b", "<ref>".repeat(40_000), "<ref ".repeat(40_000), "<pre>".repeat(40_000), "<!--".repeat(40_000),
    "<ref>".repeat(n) + "</references>".repeat(n), "<ref>".repeat(n) + "<!-- </ref> -->".repeat(n), "<code>".repeat(n) + "<!-- </code> -->".repeat(n),
    '<ref a="'.repeat(20_000), '<ref a="x\n'.repeat(20_000), "<nowiki>".repeat(20_000) + "<code>".repeat(20_000),
  ]) {
    repairTemplates(src.slice(0, 1000)); // warm up
    const start = performance.now();
    repairTemplates(src);
    expect(performance.now() - start).toBeLessThan(100);
  }
});
