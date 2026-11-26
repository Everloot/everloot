-- Disposable database with every migration applied (20261126110000_armory_honest_ranks.sql last). Invented identities only.
begin;

-- Characters on one region and ruleset: three tied on item level 61, one on 50, one with no item level, one on 90 in a
-- guild of its own, and a hidden one on 61. Reed Few has five members read (the hidden one is not read).
select public.armory_upsert_characters('eu', jsonb_build_array(
  jsonb_build_object('slug','tova-reed','character_id',31,'name','Tova','surname','Reed','level',60,'ruleset_id',1,'ruleset','PvP',
    'race_id',1,'race','Human','class_id',8,'class','Mage','faction','Alliance','guild_slug','reed-few','guild_name','Reed Few','item_level',61,'gear_score',70,'equipment','[]'::jsonb),
  jsonb_build_object('slug','ulma-reed','character_id',32,'name','Ulma','surname','Reed','level',60,'ruleset_id',1,'ruleset','PvP',
    'race_id',1,'race','Human','class_id',8,'class','Mage','faction','Alliance','guild_slug','reed-few','guild_name','Reed Few','item_level',61,'gear_score',60,'equipment','[]'::jsonb),
  jsonb_build_object('slug','vann-reed','character_id',33,'name','Vann','surname','Reed','level',60,'ruleset_id',1,'ruleset','PvP',
    'race_id',1,'race','Human','class_id',8,'class','Mage','faction','Alliance','guild_slug','reed-few','guild_name','Reed Few','item_level',61,'gear_score',50,'equipment','[]'::jsonb),
  jsonb_build_object('slug','wren-reed','character_id',34,'name','Wren','surname','Reed','level',60,'ruleset_id',1,'ruleset','PvP',
    'race_id',1,'race','Human','class_id',8,'class','Mage','faction','Alliance','guild_slug','reed-few','guild_name','Reed Few','item_level',50,'equipment','[]'::jsonb),
  jsonb_build_object('slug','xan-reed','character_id',35,'name','Xan','surname','Reed','level',60,'ruleset_id',1,'ruleset','PvP',
    'race_id',1,'race','Human','class_id',8,'class','Mage','faction','Alliance','guild_slug','reed-few','guild_name','Reed Few','item_level',61,'equipment','[]'::jsonb),
  jsonb_build_object('slug','zara-reed','character_id',37,'name','Zara','surname','Reed','level',60,'ruleset_id',1,'ruleset','PvP',
    'race_id',1,'race','Human','class_id',8,'class','Mage','faction','Alliance','guild_slug','reed-few','guild_name','Reed Few','equipment','[]'::jsonb),
  jsonb_build_object('slug','yoss-lone','character_id',36,'name','Yoss','surname','Lone','level',60,'ruleset_id',1,'ruleset','PvP',
    'race_id',1,'race','Human','class_id',8,'class','Mage','faction','Alliance','guild_slug','lone-one','guild_name','Lone One','item_level',90,'equipment','[]'::jsonb)
));
insert into public.armory_hides(region,slug) values ('eu','xan-reed');
select public.armory_upsert_guild('eu','{"slug":"reed-few","guild_id":31,"name":"Reed Few","faction":"Alliance","ruleset_id":1,"ruleset":"PvP","member_count":6}','[]');
select public.armory_upsert_guild('eu','{"slug":"lone-one","guild_id":32,"name":"Lone One","faction":"Alliance","ruleset_id":1,"ruleset":"PvP","member_count":1}','[]');

do $$
begin
  -- Tied characters share the rank of the first of them (Yoss's 90 is above), and say how many others stand on that value.
  if not exists(select 1 from public.armory_rank('eu','ulma-reed') where metric='item_level' and rank=2 and tied=2 and "of"=5) then
    raise exception 'tied item level rank: %', (select array_agg(r::text) from public.armory_rank('eu','ulma-reed') r); end if;
  if not exists(select 1 from public.armory_rank('eu','wren-reed') where metric='item_level' and rank=5 and tied=0 and "of"=5) then
    raise exception 'untied item level rank'; end if;
  -- Yoss (90) is first and alone; the hidden Xan is in no count.
  if not exists(select 1 from public.armory_rank('eu','yoss-lone') where metric='item_level' and rank=1 and tied=0 and "of"=5) then
    raise exception 'first rank'; end if;
  if not exists(select 1 from public.armory_rank('eu','ulma-reed') where metric='gear_score' and rank=2 and tied=0 and "of"=3) then
    raise exception 'gear score rank'; end if;
  -- A metric the character has no value for gives no row; a hidden character gives none at all.
  if exists(select 1 from public.armory_rank('eu','wren-reed') where metric='gear_score') then raise exception 'rank without a value'; end if;
  if exists(select 1 from public.armory_rank('eu','xan-reed')) then raise exception 'hidden rank'; end if;
end $$;

do $$
begin
  -- The guild directory's minimum of members read: Lone One (1 read, average 90) leaves the item-level sort at 5,
  -- and the total counts only the guilds kept.
  if exists(select 1 from public.armory_guild_directory(null,'eu',null,'item_level',10,0,5) where slug='lone-one') then raise exception 'one-member guild kept'; end if;
  if not exists(select 1 from public.armory_guild_directory(null,'eu',null,'item_level',10,0,5) where slug='reed-few' and members_read=5) then raise exception 'five-read guild missing'; end if;
  if exists(select 1 from public.armory_guild_directory(null,'eu',null,'item_level',10,0,5) where total<>(select count(*) from public.armory_guild_directory(null,'eu',null,'item_level',100,0,5))) then
    raise exception 'total counts guilds left out'; end if;
  -- No minimum, and the six-argument directory, list both as before.
  if (select count(*) from public.armory_guild_directory(null,'eu',null,'item_level',100,0,null) where slug in ('lone-one','reed-few'))<>2 then raise exception 'null minimum'; end if;
  if (select slug from public.armory_guild_directory(null,'eu',null,'item_level',1,0))<>'lone-one' then raise exception 'six-argument directory changed'; end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.armory_rank(text,text)','public.armory_guild_directory(text,text,smallint,text,integer,integer,integer)'] loop
    if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') then raise exception 'public access %', f; end if;
    if not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'missing server access %', f; end if;
    if not (select prosecdef and proconfig @> array['search_path=""','lock_timeout=3s'] from pg_proc where oid=f::regprocedure) then raise exception 'unsafe function %', f; end if;
  end loop;
end $$;
rollback;
