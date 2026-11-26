-- The guild page's roster shows each member's last login (#1272, site v2 guild page).
--
-- armory_roster gains one column, last_login, from the member's character row (null until the character is read). It
-- is the value the character page already shows ("Last login"), so nothing new is read or published. A function's
-- returned columns cannot change in place, so it is dropped and created again in one transaction, with its grants.
--
-- Safe to apply twice. Apply after 20261109120000_armory.sql. The owner applies this: the site never applies a
-- migration, and until it is applied the roster reads without the column and the page shows no last login.
set lock_timeout = '3s';

begin;

drop function if exists public.armory_roster(text, text);

-- Roster members plus available character scores and last login; hidden members are absent.
create function public.armory_roster(p_region text, p_slug text)
returns table (character_slug text, name text, surname text, level smallint, class_id smallint, race_id smallint, rank smallint, item_level numeric, gear_score numeric, stored boolean, last_login timestamptz)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
select m.character_slug,m.name,m.surname,m.level,m.class_id,m.race_id,m.rank,c.item_level,c.gear_score,c.slug is not null,c.last_login
from public.armory_members m left join public.armory_characters c on c.region=m.region and c.slug=m.character_slug
where m.region=p_region and m.guild_slug=p_slug
  and not exists(select 1 from public.armory_hides h where h.region=m.region and h.slug=m.character_slug)
order by m.rank,m.name,m.surname;
$$;
revoke all on function public.armory_roster(text, text) from public, anon, authenticated;
grant execute on function public.armory_roster(text, text) to service_role;

commit;

-- Rollback: drop this version and create 20261109120000_armory.sql's armory_roster again, with its grants.
