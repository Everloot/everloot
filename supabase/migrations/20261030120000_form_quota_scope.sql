-- Forms get their own scope: the waitlist, the player opt-out and the guild hide form count against an hourly
-- global bucket of 2,000 and 30 per IP, apart from the uploads' 10,000 and 200, so a burst of form posts cannot
-- turn away addon uploads. Additive: the request, install, mcp and api scopes keep their limits. Apply before
-- setting EVERLOOT_FORM_QUOTA_SCOPE=form; until then the site keeps the request scope for forms.
create or replace function public.consume_intake_quota(p_scope text, p_key text)
returns table (allowed boolean, retry_after integer)
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  keys text[];
  limits integer[];
  i integer;
  current_bucket public.intake_quota_buckets%rowtype;
  time_now timestamptz;
begin
  if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_scope is null or p_scope not in ('request', 'install', 'mcp', 'api', 'form') then
    raise exception 'Invalid quota scope or key';
  end if;
  if p_scope = 'request' then
    keys := array['global', 'ip:' || p_key];
    limits := array[10000, 200];
  elsif p_scope = 'mcp' then
    keys := array['mcp_global', 'mcp:' || p_key];
    limits := array[5000, 200];
  elsif p_scope = 'api' then
    keys := array['api_global', 'api:' || p_key];
    limits := array[3000, 30];
  elsif p_scope = 'form' then
    keys := array['form_global', 'form:' || p_key];
    limits := array[2000, 30];
  else
    keys := array['install:' || p_key];
    limits := array[20];
  end if;
  -- Always lock the global bucket before the IP one. Check it before creating an IP bucket so a
  -- full global quota cannot be used to create unlimited new rows with forged identities.
  for i in 1..array_length(keys, 1) loop
    time_now := clock_timestamp();
    insert into public.intake_quota_buckets values (keys[i], 0, time_now + interval '1 hour')
      on conflict (bucket) do update set bucket = excluded.bucket
      returning * into current_bucket;
    time_now := clock_timestamp();
    if current_bucket.reset_at <= time_now then
      update public.intake_quota_buckets set count = 0, reset_at = time_now + interval '1 hour' where bucket = keys[i];
      current_bucket.count := 0;
      current_bucket.reset_at := time_now + interval '1 hour';
    end if;
    if current_bucket.count >= limits[i] then
      allowed := false;
      retry_after := greatest(1, ceil(extract(epoch from current_bucket.reset_at - time_now))::integer);
      return next;
      return;
    end if;
  end loop;
  update public.intake_quota_buckets set count = count + 1 where bucket = any(keys);
  allowed := true;
  retry_after := 0;
  return next;
end;
$$;
revoke all on function public.consume_intake_quota(text, text) from public, anon, authenticated;
grant execute on function public.consume_intake_quota(text, text) to service_role;
