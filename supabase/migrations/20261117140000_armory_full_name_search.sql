-- Armory search by first name, surname or the full name (#1270).
--
-- Forever names are "First Surname", and armory_search only matched the start of the first name: "Morningstar" or
-- "Volvik Morningstar" could never find Volvik Morningstar. A search now matches when the text, trimmed, lower cased
-- and with any run of spaces read as one, starts the first name, the surname, or "first surname".
--
-- The players table is left as it is. Its rows are first-name sightings with no surname (upsert_players_armory sends
-- every full identity to the armory instead), so search_players has no surname to match, and it already has its
-- text_pattern_ops index on name_key.
--
-- Replaces one function and adds two indexes; no table or row changes. The hide rule, the 2-character minimum, the
-- refusal of LIKE wildcards, the order, the row cap and the service-role-only grant are unchanged. Safe to apply
-- twice. Apply after 20261109120000_armory.sql. The owner runs this: the site never applies a migration.
set lock_timeout = '3s';

-- The first name already has armory_characters_name (lower(name) text_pattern_ops).
create index if not exists armory_characters_surname on public.armory_characters(lower(surname) text_pattern_ops);
create index if not exists armory_characters_full_name on public.armory_characters(lower(name || ' ' || surname) text_pattern_ops);

-- Literal prefix of the first name, the surname or "first surname", at least two characters, in name and surname order.
-- PL/pgSQL so the pattern is a known value when the query is planned, which lets each LIKE use its prefix index.
create or replace function public.armory_search(p_prefix text, p_limit integer)
returns table (region text, slug text, name text, surname text, level smallint, class text, race text, ruleset text, guild_name text)
language plpgsql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_pattern text := lower(regexp_replace(btrim(coalesce(p_prefix, '')), '\s+', ' ', 'g'));
begin
  if char_length(v_pattern) < 2 or v_pattern !~ '^[^%_\\]+$' then return; end if;
  v_pattern := v_pattern || '%';
  return query
  select c.region,c.slug,c.name,c.surname,c.level,c.class,c.race,c.ruleset,c.guild_name
  from public.armory_characters c
  where (lower(c.name) like v_pattern or lower(c.surname) like v_pattern or lower(c.name || ' ' || c.surname) like v_pattern)
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug)
  order by c.name,c.surname,c.region,c.slug limit least(greatest(coalesce(p_limit,25),0),100);
end;
$$;
revoke all on function public.armory_search(text, integer) from public, anon, authenticated;
grant execute on function public.armory_search(text, integer) to service_role;

-- Rollback by hand: reapply armory_search from 20261109120000_armory.sql, then
-- drop index if exists public.armory_characters_full_name;
-- drop index if exists public.armory_characters_surname;
