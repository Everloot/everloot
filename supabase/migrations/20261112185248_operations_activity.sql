-- Private operations receipts. Raw identities, payloads and player names never enter these tables.
create table public.ops_install_days (
  day date not null,
  install_key text not null check (install_key ~ '^[a-f0-9]{64}$'),
  receipts bigint not null check (receipts > 0),
  records bigint not null check (records >= 0),
  last_received_at timestamptz not null,
  realms text[] not null default '{}',
  kinds text[] not null default '{}',
  primary key (day, install_key)
);
create table public.ops_state (key text primary key check (key = 'intake'), started_at timestamptz not null);
-- Identity-free totals survive the 90-day pseudonymous retention window. These include all installations.
create table public.ops_daily_totals (
  day date primary key, contributing_installs bigint not null, receipts bigint not null, records bigint not null
);
alter table public.ops_install_days enable row level security;
alter table public.ops_state enable row level security;
alter table public.ops_daily_totals enable row level security;
revoke all on public.ops_install_days, public.ops_state, public.ops_daily_totals from public, anon, authenticated, service_role;
grant select on public.ops_install_days, public.ops_state, public.ops_daily_totals to service_role;

create function public.record_ops_intake(p_reason text, p_install_key text, p_records integer,
  p_rejected_records integer, p_realms text[], p_kinds text[])
returns void language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare d date := (now() at time zone 'utc')::date;
begin
  if p_reason is null or p_reason not in ('accepted','limited','body_too_large','invalid_request','validation','storage_failure','internal_failure')
    or p_records is null or p_records < 0 or p_records > 100000
    or p_rejected_records is null or p_rejected_records < 0 or p_rejected_records > 100000
    or (p_install_key is not null and p_install_key !~ '^[a-f0-9]{64}$')
    or p_realms is null or cardinality(p_realms) > 16
    or exists(select 1 from unnest(p_realms) r where r is null or length(r) > 120)
    or p_kinds is null or cardinality(p_kinds) > 64
    or exists(select 1 from unnest(p_kinds) k where k is null or k !~ '^[a-z_]{1,64}$') then
    raise exception 'Invalid operations event';
  end if;
  insert into public.ops_state values ('intake', now()) on conflict do nothing;
  insert into public.usage_counters(day, metric, count) values (d, 'ops.outcome.' || p_reason, 1)
    on conflict(day, metric) do update set count = public.usage_counters.count + 1;
  if p_reason = 'accepted' then
    insert into public.usage_counters(day, metric, count) values (d, 'ops.records.accepted', p_records)
      on conflict(day, metric) do update set count = public.usage_counters.count + excluded.count;
    if p_install_key is null then
      insert into public.usage_counters(day, metric, count) values (d, 'ops.activity_missing', 1)
        on conflict(day, metric) do update set count = public.usage_counters.count + 1;
    else
      insert into public.ops_install_days as current(day, install_key, receipts, records, last_received_at, realms, kinds)
        values(d, p_install_key, 1, p_records, now(), p_realms, p_kinds)
        on conflict(day, install_key) do update set receipts = current.receipts + 1,
          records = current.records + excluded.records, last_received_at = now(),
          realms = array(select distinct r from unnest(current.realms || excluded.realms) r order by r limit 64),
          kinds = array(select distinct k from unnest(current.kinds || excluded.kinds) k order by k limit 64);
    end if;
  end if;
  if p_rejected_records > 0 then
    insert into public.usage_counters(day, metric, count) values (d, 'ops.records.rejected', p_rejected_records)
      on conflict(day, metric) do update set count = public.usage_counters.count + excluded.count;
  end if;
end;
$$;
revoke all on function public.record_ops_intake(text,text,integer,integer,text[],text[]) from public, anon, authenticated;
grant execute on function public.record_ops_intake(text,text,integer,integer,text[],text[]) to service_role;

create function public.prune_ops_activity() returns void
language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
begin
  -- DELETE RETURNING gives concurrent collectors one atomic claim on each expired row.
  with expired as (
    delete from public.ops_install_days where day < (now() at time zone 'utc')::date - 90
    returning day, receipts, records
  )
  insert into public.ops_daily_totals(day, contributing_installs, receipts, records)
    select day, count(*), sum(receipts), sum(records) from expired group by day
    on conflict(day) do update set contributing_installs = public.ops_daily_totals.contributing_installs + excluded.contributing_installs,
      receipts = public.ops_daily_totals.receipts + excluded.receipts, records = public.ops_daily_totals.records + excluded.records;
end;
$$;
revoke all on function public.prune_ops_activity() from public, anon, authenticated;
grant execute on function public.prune_ops_activity() to service_role;
notify pgrst, 'reload schema';
