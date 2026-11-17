-- The armory crawler also stores completed achievements, reputations and completed quest ids in
-- armory_characters.details. Like the other optional sections, each one is removed when its own read is
-- more than 30 days old, even if the base profile was refreshed since.
set lock_timeout = '3s';

create or replace function public.armory_purge()
returns integer
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare n integer := 0; removed integer;
begin
  update public.armory_characters set addon_seen=null where addon_seen<current_date-30;
  update public.armory_queue set addon_seen=null where addon_seen<current_date-30;
  -- Optional sections have independent capture dates; refreshing the base profile must not extend them.
  with expired as (
    select c.region,c.slug,array_agg(section.key) as keys
    from public.armory_characters c cross join lateral jsonb_each(c.details) section
    where section.key in ('statistics','talents','professions','avatar','achievements','reputations','quests')
      and section.value->>'asOf'<to_char(now() at time zone 'UTC'-interval '30 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    group by c.region,c.slug
  )
  update public.armory_characters c set details=c.details-e.keys from expired e where c.region=e.region and c.slug=e.slug;
  delete from public.armory_members where fetched_at<now()-interval '30 days';
  delete from public.armory_characters where fetched_at<now()-interval '30 days';
  get diagnostics removed = row_count; n:=n+removed;
  delete from public.armory_guilds where fetched_at<now()-interval '30 days';
  get diagnostics removed = row_count; n:=n+removed;
  delete from public.armory_queue where tries>=3 and added_at<now()-interval '90 days';
  get diagnostics removed = row_count;
  return n+removed;
end;
$$;
revoke all on function public.armory_purge() from public, anon, authenticated;
grant execute on function public.armory_purge() to service_role;

-- Rollback: re-run the armory_purge definition in 20261112190000_armory_profiles.sql.
