-- Disposable database with the armory discovery migration applied. Invented identities only.
begin;
select public.armory_hide('eu','hidden-one');
select public.armory_upsert_characters('eu','[
  {"slug":"ember-vale","character_id":9001,"name":"Ember","surname":"Vale","level":60,"ruleset_id":1,"ruleset":"PvP","race_id":8,"race":"Troll","class_id":9,"class":"Warlock","faction":"Horde","guild_slug":"copper-owls","guild_name":"Copper Owls","details":{"revision":1}},
  {"slug":"ash-wood","character_id":9002,"name":"Ash","surname":"Wood","level":20,"ruleset_id":1,"ruleset":"PvP","race_id":8,"race":"Troll","class_id":1,"class":"Warrior","faction":"Horde","guild_slug":"copper-owls","guild_name":"Copper Owls","details":{"revision":1}},
  {"slug":"reed-moss","character_id":9003,"name":"Reed","surname":"Moss","level":60,"ruleset_id":2,"ruleset":"Normal","race_id":1,"race":"Human","class_id":2,"class":"Paladin","faction":"Alliance","guild_slug":"iron-tide","guild_name":"Iron Tide","item_level":61.5,"details":{"revision":1}},
  {"slug":"old-oak","character_id":9004,"name":"Old","surname":"Oak","level":30,"ruleset_id":2,"ruleset":"Normal","race_id":1,"race":"Human","class_id":4,"class":"Rogue","faction":"Alliance","details":{"revision":1}}
]');

-- A roster read queues members it has not stored, never a hidden one.
do $$ declare n integer; begin
  n := public.armory_upsert_guild('eu',
    '{"slug":"iron-tide","guild_id":77,"name":"Iron Tide","faction":"Alliance","ruleset_id":2,"ruleset":"Normal","member_count":3}',
    '[{"character_slug":"reed-moss"},{"character_slug":"new-face"},{"character_slug":"hidden-one"}]');
  if n<>1 then raise exception 'roster queued % members, expected 1', n; end if;
  if not exists(select 1 from public.armory_queue where region='eu' and kind='character' and slug='new-face') then raise exception 'new member not queued'; end if;
  if exists(select 1 from public.armory_queue where slug='hidden-one') then raise exception 'hidden member queued'; end if;
end $$;

-- The spider queues each unread guild that stored characters name once, within its limit and region.
delete from public.armory_queue where kind='guild';
do $$ begin
  if public.armory_spider_guilds('eu',0)<>0 then raise exception 'spider ignored its limit'; end if;
  if public.armory_spider_guilds('eu',10)<>1 then raise exception 'spider did not queue exactly the unread guild'; end if;
  if public.armory_spider_guilds('eu',10)<>0 then raise exception 'spider queued a guild twice'; end if;
  if public.armory_spider_guilds('us',10)<>0 then raise exception 'spider crossed regions'; end if;
  if not exists(select 1 from public.armory_queue where region='eu' and kind='guild' and slug='copper-owls' and source='spider') then raise exception 'unread guild missing'; end if;
  if exists(select 1 from public.armory_queue where kind='guild' and slug='iron-tide') then raise exception 'read guild queued'; end if;
end $$;

-- Guilds: never-read before a stored guild, even one queued earlier.
update public.armory_guilds set checked_at=now()-interval '21 days' where slug='iron-tide';
insert into public.armory_queue(region,kind,slug,source,added_at) values('eu','guild','iron-tide','refresh',now()-interval '1 day');
do $$ begin
  if (select array_agg(slug) from public.armory_take('eu','guild',10)) <> array['copper-owls','iron-tide'] then
    raise exception 'guild take order %', (select array_agg(slug) from public.armory_take('eu','guild',10));
  end if;
end $$;

-- Characters: near-purge rows first, then the queue, then due refreshes. Active and top-ranked rows are due
-- after a day; ash-wood (no rank values, old login, old addon sighting) waits for 20 days.
update public.armory_characters set checked_at=now()-interval '26 days' where slug='old-oak';
update public.armory_characters set checked_at=now()-interval '3 days', last_login=now()-interval '1 day' where slug='ember-vale';
update public.armory_characters set checked_at=now()-interval '2 days', last_login=now()-interval '30 days' where slug='reed-moss';
update public.armory_characters set checked_at=now()-interval '2 days', last_login=now()-interval '30 days', addon_seen=current_date-10 where slug='ash-wood';
do $$ begin
  if (select array_agg(slug) from public.armory_take('eu','character',10)) <> array['old-oak','new-face','ember-vale','reed-moss'] then
    raise exception 'character take order %', (select array_agg(slug) from public.armory_take('eu','character',10));
  end if;
  update public.armory_characters set addon_seen=current_date-1 where slug='ash-wood';
  if not exists(select 1 from public.armory_take('eu','character',10) where slug='ash-wood') then raise exception 'addon-seen character not due daily'; end if;
  if exists(select 1 from public.armory_take('eu','character',10) where slug='hidden-one') then raise exception 'hidden character taken'; end if;
end $$;

-- Zero-call streaks count per region and reset on a run that called.
do $$ begin
  if public.armory_record_run('eu',0)<>1 or public.armory_record_run('eu',0)<>2 then raise exception 'streak did not count'; end if;
  if public.armory_record_run('us',0)<>1 then raise exception 'streak shared across regions'; end if;
  if public.armory_record_run('eu',12)<>0 then raise exception 'streak did not reset'; end if;
  if public.armory_record_run('eu',0)<>1 then raise exception 'streak did not restart'; end if;
  begin
    perform public.armory_record_run('xx',0);
    raise exception 'invalid region accepted';
  exception when raise_exception then
    if sqlerrm<>'Invalid armory run' then raise; end if;
  end;
end $$;

do $$ declare f text; begin
  foreach f in array array['public.armory_spider_guilds(text,integer)','public.armory_record_run(text,integer)','public.armory_take(text,text,integer)'] loop
    if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') then raise exception 'public access to %', f; end if;
    if not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'missing server access to %', f; end if;
  end loop;
  if has_table_privilege('anon','public.armory_runs','SELECT') or has_table_privilege('service_role','public.armory_runs','SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'armory_runs is open';
  end if;
end $$;
rollback;
