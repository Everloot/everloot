-- Disposable database with the armory and guilds migrations and the guild directory applied. Invented identities only.
begin;

select public.armory_upsert_characters('us', jsonb_build_array(
  jsonb_build_object('slug','arla-quill','character_id',11,'name','Arla','surname','Quill','level',60,'ruleset_id',1,'ruleset','PvP',
    'race_id',1,'race','Human','class_id',8,'class','Mage','faction','Alliance','guild_slug','quill-watch','guild_name','Quill Watch','item_level',70,'equipment','[]'::jsonb),
  jsonb_build_object('slug','brin-quill','character_id',12,'name','Brin','surname','Quill','level',42,'ruleset_id',1,'ruleset','PvP',
    'race_id',1,'race','Human','class_id',1,'class','Warrior','faction','Alliance','guild_slug','quill-watch','guild_name','Quill Watch','item_level',50,'equipment','[]'::jsonb),
  jsonb_build_object('slug','cass-quill','character_id',13,'name','Cass','surname','Quill','level',60,'ruleset_id',1,'ruleset','PvP',
    'race_id',1,'race','Human','class_id',5,'class','Priest','faction','Alliance','guild_slug','quill-watch','guild_name','Quill Watch','item_level',90,'equipment','[]'::jsonb),
  jsonb_build_object('slug','dorn-mire','character_id',14,'name','Dorn','surname','Mire','level',60,'ruleset_id',1,'ruleset','PvP',
    'race_id',2,'race','Orc','class_id',3,'class','Hunter','faction','Horde','guild_slug','mire-band','guild_name','Mire Band','item_level',85,'equipment','[]'::jsonb),
  jsonb_build_object('slug','erra-mire','character_id',15,'name','Erra','surname','Mire','level',60,'ruleset_id',1,'ruleset','PvP',
    'race_id',2,'race','Orc','class_id',3,'class','Hunter','faction','Horde','guild_slug','mire-band','guild_name','Mire Band','item_level',85,'equipment','[]'::jsonb)
));
select public.armory_upsert_characters('eu', jsonb_build_array(
  jsonb_build_object('slug','fenn-quay','character_id',21,'name','Fenn','surname','Quay','level',30,'ruleset_id',2,'ruleset','Normal',
    'race_id',1,'race','Human','class_id',2,'class','Paladin','faction','Alliance','guild_slug','quay-hall','guild_name','Quay Hall','equipment','[]'::jsonb)
));
select public.armory_upsert_guild('us','{"slug":"quill-watch","guild_id":1,"name":"Quill Watch","faction":"Alliance","ruleset_id":1,"ruleset":"PvP","member_count":40}','[]');
select public.armory_upsert_guild('us','{"slug":"mire-band","guild_id":2,"name":"Mire Band","faction":"Horde","ruleset_id":1,"ruleset":"PvP","member_count":9}','[]');
select public.armory_upsert_guild('eu','{"slug":"quay-hall","guild_id":3,"name":"Quay Hall","faction":"Alliance","ruleset_id":2,"ruleset":"Normal","member_count":5}','[]');
select public.armory_upsert_guild('eu','{"slug":"quiet-few","guild_id":4,"name":"Quiet Few","faction":"Horde","ruleset_id":2,"ruleset":"Normal","member_count":2}','[]');

do $$
declare r record;
begin
  -- Default sort: characters read, then name. A guild with none read is still listed, with zeros and no average.
  if (select array_agg(slug order by ordinality) from (select slug, row_number() over() as ordinality
      from public.armory_guild_directory(null,null,null,'members',10,0)) x) <> array['quill-watch','mire-band','quay-hall','quiet-few'] then
    raise exception 'members order';
  end if;
  select * into r from public.armory_guild_directory(null,'us',null,'members',10,0) where slug='quill-watch';
  if r.members_read<>3 or r.level_60<>2 or r.average_item_level<>70.0 or r.member_count<>40 or r.total<>2 or r.fetched_at is null then
    raise exception 'quill counts %', r;
  end if;
  select * into r from public.armory_guild_directory(null,'eu',null,'members',10,0) where slug='quiet-few';
  if r.members_read<>0 or r.level_60<>0 or r.average_item_level is not null then raise exception 'empty guild %', r; end if;
  -- Item level: highest average first; a guild with no item level read sorts last.
  if (select slug from public.armory_guild_directory(null,null,null,'item_level',1,0))<>'mire-band' then raise exception 'item level sort'; end if;
  if (select slug from public.armory_guild_directory(null,null,null,'item_level',1,3)) not in ('quay-hall','quiet-few') then raise exception 'item level nulls last'; end if;
  -- Level 60 count, with characters read breaking the tie (2 and 2: Quill Watch has 3 read).
  if (select slug from public.armory_guild_directory(null,null,null,'level_60',1,0))<>'quill-watch' then raise exception 'level 60 sort'; end if;
  -- Filters and paging.
  if (select count(*) from public.armory_guild_directory(null,null,2::smallint,'members',10,0))<>2 then raise exception 'ruleset filter'; end if;
  if (select count(*) from public.armory_guild_directory('Qu',null,null,'members',10,0))<>3 then raise exception 'prefix'; end if;
  if (select count(*) from public.armory_guild_directory('qUi',null,null,'members',10,0))<>2 then raise exception 'prefix case'; end if;
  if exists(select 1 from public.armory_guild_directory('Q',null,null,'members',10,0)) then raise exception 'one-letter prefix'; end if;
  if exists(select 1 from public.armory_guild_directory('Q%',null,null,'members',10,0)) then raise exception 'wildcard prefix'; end if;
  if (select array_agg(slug) from public.armory_guild_directory(null,null,null,'members',2,2)) <> array['quay-hall','quiet-few'] then raise exception 'page 2'; end if;
  if (select min(total) from public.armory_guild_directory(null,null,null,'members',2,2))<>4 then raise exception 'total on a later page'; end if;
  if (select count(*) from public.armory_guild_directory(null,null,null,'members',500,0))<>4 then raise exception 'limit cap'; end if;
end $$;

-- A hidden character leaves every count at once.
select public.armory_hide('us','cass-quill');
do $$
declare r record;
begin
  select * into r from public.armory_guild_directory(null,'us',null,'members',10,0) where slug='quill-watch';
  if r.members_read<>2 or r.level_60<>1 or r.average_item_level<>60.0 then raise exception 'hidden member counted %', r; end if;
end $$;

-- A guild hide on a US realm hides the US guild of that name, not an EU one.
insert into public.guild_suppressions(realm_key,guild_key) values('camwow us1 realm 4 pvp','mire band');
insert into public.guild_suppressions(realm_key,guild_key) values('camwow us1 realm 2 normal','quay hall');
do $$
begin
  if exists(select 1 from public.armory_guild_directory(null,null,null,'members',10,0) where slug='mire-band') then raise exception 'hidden guild listed'; end if;
  if not exists(select 1 from public.armory_guild_directory(null,null,null,'members',10,0) where slug='quay-hall') then raise exception 'hide crossed regions'; end if;
  if (select min(total) from public.armory_guild_directory(null,null,null,'members',10,0))<>3 then raise exception 'total with a hidden guild'; end if;
end $$;

do $$
declare f text := 'public.armory_guild_directory(text,text,smallint,text,integer,integer)';
begin
  if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') then raise exception 'public directory access'; end if;
  if not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'missing server directory access'; end if;
  if not (select prosecdef and proconfig @> array['search_path=""','lock_timeout=3s'] from pg_proc where oid=f::regprocedure) then raise exception 'unsafe function'; end if;
  if to_regclass('public.armory_characters_guild_directory') is null then raise exception 'missing index'; end if;
end $$;
rollback;
