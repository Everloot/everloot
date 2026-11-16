begin;

do $$
declare f regprocedure := 'public.blizzard_auctions_stamps(text)'::regprocedure; r text;
begin
  foreach r in array array['anon','authenticated','backup_exporter'] loop
    if has_function_privilege(r, f, 'EXECUTE') then raise exception 'function access: % %', r, f; end if;
  end loop;
  if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'job cannot execute %', f; end if;
  if not (select prosecdef and provolatile = 's' and proconfig @> array['search_path=""','lock_timeout=3s'] from pg_proc where oid = f)
    then raise exception 'unsafe reader %', f; end if;
end $$;

insert into public.blizzard_auction_houses(region,house_id,name,items_at,commodities_at) values
  ('us',110,'Alliance Auction House',now() - interval '3 hours',now() - interval '2 hours'),
  ('us',113,'Horde Auction House',now() - interval '31 days',now() - interval '1 hour'),
  ('eu',110,'Alliance Auction House',now() - interval '1 hour',null);

set local role service_role;
do $$
begin
  if (select count(*) from public.blizzard_auctions_stamps('us')) <> 2 then raise exception 'region rows'; end if;
  if (select items_at from public.blizzard_auctions_stamps('us') where house_id = 110) is distinct from now() - interval '3 hours'
    then raise exception 'exact time lost'; end if;
  if (select items_at from public.blizzard_auctions_stamps('us') where house_id = 113) is not null then raise exception 'expired time read back'; end if;
  if (select commodities_at from public.blizzard_auctions_stamps('us') where house_id = 113) is null then raise exception 'current time dropped'; end if;
  if (select commodities_at from public.blizzard_auctions_stamps('eu') where house_id = 110) is not null then raise exception 'missing document'; end if;
  if exists (select 1 from public.blizzard_auctions_stamps('kr')) then raise exception 'unknown region'; end if;
end $$;
reset role;
rollback;
