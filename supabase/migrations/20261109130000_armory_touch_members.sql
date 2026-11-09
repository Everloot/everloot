-- A 304 on the roster is a refresh for the members too: retain their rows through purge.
-- Apply after 20261109120000_armory.sql. Safe to apply twice.
create or replace function public.armory_touch(p_region text, p_kind text, p_slugs text[])
returns integer
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare written integer;
begin
  if p_kind='character' then
    update public.armory_characters set fetched_at=now(),checked_at=now() where region=p_region and slug=any(p_slugs);
  elsif p_kind='guild' then
    update public.armory_guilds set fetched_at=now(),checked_at=now() where region=p_region and slug=any(p_slugs);
  else raise exception 'Invalid armory kind'; end if;
  get diagnostics written = row_count;
  if p_kind='guild' then
    update public.armory_members set fetched_at=now() where region=p_region and guild_slug=any(p_slugs);
  end if;
  delete from public.armory_queue where region=p_region and kind=p_kind and slug=any(p_slugs);
  return written;
end;
$$;
revoke all on function public.armory_touch(text, text, text[]) from public, anon, authenticated;
grant execute on function public.armory_touch(text, text, text[]) to service_role;
