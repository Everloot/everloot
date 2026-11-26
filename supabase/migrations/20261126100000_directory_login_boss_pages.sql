-- Two small changes for the site (site v5): /players shows last login and links a guild's own page; boss pages take
-- comments and screenshots.
--
-- 1. armory_directory (20261119120000_armory_directory.sql) gains two columns: last_login, the character row's value
--    the character page already shows, and guild_slug, the guild's own armory page, given only when the armory has
--    read that guild, it is not hidden through /guilds/hide in that region (the rule armory_guild_directory uses) and
--    Blizzard does not call it disbanded. Otherwise guild_slug is null and the guild name stays as before. Hidden
--    characters stay out. Nothing new is read or published. A function's returned columns cannot change in place, so
--    it is dropped and created again in one transaction, with its grants.
-- 2. 'boss' joins the six page types of comments (20261125130000_entity_comments.sql) and screenshots
--    (20261125140000_entity_screenshots.sql): the tables' checks and the two functions that take a page type
--    (post_entity_comment, submit_entity_screenshot). Either may not be applied yet: each part runs only where its
--    table and function exist and does nothing otherwise. Apply this again after applying either of those two
--    migrations later; their activation runbooks say so. The functions are redefined from their own stored text with
--    only the type list changed, so their grants, owner and settings stay.
--
-- Safe to apply twice. Apply after 20261119120000_armory_directory.sql and 20261025120000_guilds.sql. The owner applies
-- this: the site never applies a migration. Until it is applied /players reads without the two columns and shows what
-- it shows today, and a boss page's comment or screenshot is refused (the sections stay behind their switches).
set lock_timeout = '3s';

begin;

do $$
begin
  if to_regprocedure('public.armory_directory(text,text,text,text,text,smallint,integer,integer,text,text,integer,integer)') is null
    or to_regclass('public.guild_suppressions') is null then
    raise exception 'Apply 20261119120000_armory_directory.sql and 20261025120000_guilds.sql first';
  end if;
end $$;

drop function if exists public.armory_directory(text,text,text,text,text,smallint,integer,integer,text,text,integer,integer);

-- Prefix matches first name, surname or full name, literally; null lists every visible character.
-- Sort descending with missing gear last; name sorts ascending. Identity breaks every tie for stable paging.
-- total repeats the filtered count on every row, before limit/offset (as armory_guild_directory).
create function public.armory_directory(
  p_prefix text, p_class text, p_race text, p_faction text, p_region text, p_ruleset_id smallint,
  p_min_level integer, p_max_level integer, p_guild_prefix text, p_sort text, p_limit integer, p_offset integer)
returns table (region text, slug text, name text, surname text, level smallint, class text, race text,
  faction text, ruleset_id smallint, ruleset text, guild_name text, gear_score numeric, item_level numeric,
  fetched_at timestamptz, total integer, last_login timestamptz, guild_slug text)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
select c.region,c.slug,c.name,c.surname,c.level,c.class,c.race,c.faction,c.ruleset_id,c.ruleset,c.guild_name,
  c.gear_score,c.item_level,c.fetched_at,(count(*) over())::integer,c.last_login,g.slug
from public.armory_characters c
left join public.armory_guilds g on g.region=c.region and g.slug=c.guild_slug and g.name<>'DELETED'
  and not exists(select 1 from public.guild_suppressions s
    where s.guild_key=lower(g.name) and s.realm_key ~ ('(^| )' || g.region || '[0-9]*( |$)'))
where not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug)
  and (p_prefix is null or (p_prefix ~ '^[[:alpha:]]{1,24}( [[:alpha:]]{1,24})?$' and
    (lower(c.name) like lower(p_prefix)||'%' or lower(c.surname) like lower(p_prefix)||'%'
      or lower(c.name||' '||c.surname) like lower(p_prefix)||'%')))
  and (p_class is null or lower(c.class)=lower(p_class))
  and (p_race is null or lower(c.race)=lower(p_race))
  and (p_faction is null or lower(c.faction)=lower(p_faction))
  and (p_region is null or c.region=p_region)
  and (p_ruleset_id is null or c.ruleset_id=p_ruleset_id)
  and (p_min_level is null or c.level>=p_min_level)
  and (p_max_level is null or c.level<=p_max_level)
  and (p_guild_prefix is null or (char_length(p_guild_prefix) between 1 and 80
    and p_guild_prefix ~ '^[^%_\\]+$' and lower(c.guild_name) like lower(p_guild_prefix)||'%'))
order by
  case when p_sort='item_level' then c.item_level when p_sort='level' then c.level
    when p_sort in ('name','fetched_at') then null else c.gear_score end desc nulls last,
  case when p_sort='fetched_at' then c.fetched_at end desc nulls last,
  c.name,c.surname,c.region,c.slug
limit least(greatest(coalesce(p_limit,25),0),100) offset greatest(coalesce(p_offset,0),0);
$$;
revoke all on function public.armory_directory(text,text,text,text,text,smallint,integer,integer,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.armory_directory(text,text,text,text,text,smallint,integer,integer,text,text,integer,integer) to service_role;

-- Boss pages: the type list in each table's check and function, where they exist.
do $$
declare
  part record;
  def text;
begin
  for part in select * from (values
    ('public.entity_comments', 'entity_comments_entity_type_check', 'public.post_entity_comment(uuid,text,integer,text)'),
    ('public.entity_screenshots', 'entity_screenshots_entity_type_check', 'public.submit_entity_screenshot(uuid,text,integer,integer,integer,integer)')
  ) as p(tbl, chk, fn) loop
    if to_regclass(part.tbl) is null or to_regprocedure(part.fn) is null then
      raise notice '% is not applied yet: apply this migration again after it', part.tbl;
      continue;
    end if;
    execute format('alter table %s drop constraint if exists %I', part.tbl, part.chk);
    execute format('alter table %s add constraint %I check (entity_type in (%L, %L, %L, %L, %L, %L, %L))',
      part.tbl, part.chk, 'item', 'quest', 'npc', 'spell', 'zone', 'instance', 'boss');
    def := replace(pg_get_functiondef(to_regprocedure(part.fn)),
      $t$'zone', 'instance')$t$, $t$'zone', 'instance', 'boss')$t$);
    if position($t$'zone', 'instance', 'boss')$t$ in def) = 0 then
      raise exception '% does not hold the expected type list; nothing was changed', part.fn;
    end if;
    execute def;
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;

reset lock_timeout;

-- Readback (every row t):
-- select check_name, ok from (values
--   ('armory_directory returns last_login and guild_slug',
--     (select count(*) = 2 from pg_proc p, unnest(p.proargnames) a where p.oid = 'public.armory_directory(text,text,text,text,text,smallint,integer,integer,text,text,integer,integer)'::regprocedure
--       and a in ('last_login', 'guild_slug'))),
--   ('only service_role may call armory_directory',
--     has_function_privilege('service_role', 'public.armory_directory(text,text,text,text,text,smallint,integer,integer,text,text,integer,integer)', 'execute')
--     and not has_function_privilege('anon', 'public.armory_directory(text,text,text,text,text,smallint,integer,integer,text,text,integer,integer)', 'execute')
--     and not has_function_privilege('authenticated', 'public.armory_directory(text,text,text,text,text,smallint,integer,integer,text,text,integer,integer)', 'execute')),
--   ('comments take boss pages, or are not applied yet',
--     to_regclass('public.entity_comments') is null or (
--       pg_get_constraintdef((select oid from pg_constraint where conrelid = to_regclass('public.entity_comments') and conname = 'entity_comments_entity_type_check')) like '%''boss''%'
--       and pg_get_functiondef(to_regprocedure('public.post_entity_comment(uuid,text,integer,text)')) like '%''instance'', ''boss'')%')),
--   ('screenshots take boss pages, or are not applied yet',
--     to_regclass('public.entity_screenshots') is null or (
--       pg_get_constraintdef((select oid from pg_constraint where conrelid = to_regclass('public.entity_screenshots') and conname = 'entity_screenshots_entity_type_check')) like '%''boss''%'
--       and pg_get_functiondef(to_regprocedure('public.submit_entity_screenshot(uuid,text,integer,integer,integer,integer)')) like '%''instance'', ''boss'')%'))
-- ) as checks(check_name, ok);
-- select region, slug, last_login, guild_name, guild_slug from public.armory_directory(null,null,null,null,null,null,null,null,null,'fetched_at',5,0);
--
-- Rollback: delete any 'boss' comments, reports and screenshots first (the old checks refuse them), then run
-- 20261119120000_armory_directory.sql's function part again after `drop function public.armory_directory(text,text,text,
-- text,text,smallint,integer,integer,text,text,integer,integer);`, and the two tables' checks and functions from
-- 20261125130000 and 20261125140000 (their create or replace statements and the six-type checks).
