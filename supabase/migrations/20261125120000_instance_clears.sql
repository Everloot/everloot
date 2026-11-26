-- Recent clears on an instance's page: the public linked histories that hold a kill in one instance.
-- Choose up to 500 candidates by their newest kill there, then read them through public_boss_kills, which
-- enforces every identity, link, hide and suppression check. Only the site's server can call it; it returns
-- no account ids, link ids or source hashes. Safe to apply twice.
create or replace function public.public_instance_clears(p_map integer)
returns table(region text,slug text,name text,surname text,kills jsonb)
language sql stable security definer set search_path = '' set lock_timeout = '3s' as $$
  with candidates as materialized (
    -- sync_boss_kills stores only kills whose times parse as timestamps.
    select a.region,a.slug,max((k->>'lastKillAt')::timestamptz) as newest
    from public.character_links l
    join public.character_boss_kills b on b.link_id=l.id
    join public.armory_links a on a.link_id=l.id
    cross join lateral jsonb_array_elements(case when jsonb_typeof(b.kills)='array' then b.kills else '[]'::jsonb end) k
    where l.status='linked' and b.captured_at is not null and k->>'instanceMapId'=p_map::text
    group by a.region,a.slug
    order by newest desc,a.region,a.slug limit 500
  )
  select h.region,h.slug,c.name,c.surname,
    coalesce((select jsonb_agg(k) from jsonb_array_elements(h.kills) k where k->>'instanceMapId'=p_map::text),'[]'::jsonb)
  from public.public_boss_kills(
    coalesce((select jsonb_agg(jsonb_build_object('region',p.region,'slug',p.slug)) from candidates p),'[]'::jsonb)
  ) h
  join candidates p on p.region=h.region and p.slug=h.slug
  join public.armory_characters c on c.region=h.region and c.slug=h.slug
  order by p.newest desc,h.region,h.slug;
$$;
revoke all on function public.public_instance_clears(integer) from public,anon,authenticated;
grant execute on function public.public_instance_clears(integer) to service_role;
notify pgrst, 'reload schema';
