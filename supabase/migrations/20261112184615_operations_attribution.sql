-- Explicit per-upload request attribution. No historical install/account inference.
-- Private service-role functions only; deletion/unlink cascades remove associations.
create table if not exists public.ops_upload_attributions (
  upload_id uuid primary key references public.uploads(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  link_id uuid not null references public.character_links(id) on delete cascade,
  install_key text not null check (install_key ~ '^[a-f0-9]{64}$'),
  opted_at timestamptz not null default now()
);
create index if not exists ops_attribution_install_idx on public.ops_upload_attributions(install_key, opted_at desc);
create index if not exists ops_attribution_user_idx on public.ops_upload_attributions(user_id);
alter table public.ops_upload_attributions enable row level security;
revoke all on public.ops_upload_attributions from public, anon, authenticated, service_role;

create or replace function public.attribute_ops_uploads(
  p_user_id uuid, p_link_id uuid, p_upload_ids uuid[], p_install_id text, p_install_key text, p_completion_refs text[]
) returns boolean language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$
declare
  chosen public.character_links%rowtype;
  receipt_count integer;
begin
  if cardinality(p_upload_ids) is null or cardinality(p_upload_ids) not between 1 and 100
    or cardinality(p_completion_refs) is null or cardinality(p_completion_refs) not between 1 and 50
    or p_install_id is null or char_length(p_install_id) not between 1 and 128
    or p_install_key is null or p_install_key !~ '^[a-f0-9]{64}$'
    or (select count(distinct id) from unnest(p_upload_ids) id) <> cardinality(p_upload_ids)
    or exists (select 1 from unnest(p_completion_refs) ref where ref is null or ref !~ '^[a-f0-9]{64}$')
    then return false; end if;
  select * into chosen from public.character_links l where l.id = p_link_id and l.user_id = p_user_id for share;
  if not found or chosen.status <> 'linked' or not coalesce(chosen.completion_ref = any(p_completion_refs), false) then return false; end if;
  if not exists (select 1 from public.public_character(chosen.ruleset, chosen.realm, chosen.name)) then return false; end if;
  -- Serialize claims to the same receipt and verify every supplied receipt belongs to this install.
  perform u.id from public.uploads u where u.id = any(p_upload_ids) order by u.id for update;
  select count(*) into receipt_count from public.uploads u where u.id = any(p_upload_ids) and u.install_id = p_install_id;
  if receipt_count <> cardinality(p_upload_ids) then return false; end if;
  if exists (select 1 from public.ops_upload_attributions a where a.upload_id = any(p_upload_ids) and a.user_id <> p_user_id) then return false; end if;
  insert into public.ops_upload_attributions(upload_id, user_id, link_id, install_key)
    select id, p_user_id, p_link_id, p_install_key from unnest(p_upload_ids) id
    on conflict (upload_id) do update set link_id = excluded.link_id, install_key = excluded.install_key, opted_at = now();
  return true;
end;
$$;
revoke all on function public.attribute_ops_uploads(uuid, uuid, uuid[], text, text, text[]) from public, anon, authenticated;
grant execute on function public.attribute_ops_uploads(uuid, uuid, uuid[], text, text, text[]) to service_role;

-- Eligibility is checked on every detail request, never copied into the aggregate snapshot.
-- The latest eligible opted-in request is a character context, not authorship of an install's other records.
create or replace function public.ops_contributor_identity(p_install_key text)
returns table(name text, realm text, class text, level smallint, ruleset text, opted_at timestamptz)
language sql stable security definer set search_path = '' set lock_timeout = '3s' as $$
  select l.name, l.realm, l.class, l.level, l.ruleset, a.opted_at
  from public.ops_upload_attributions a
  join public.character_links l on l.id = a.link_id and l.user_id = a.user_id
  join public.users u on u.id = a.user_id
  join public.uploads r on r.id = a.upload_id
  where a.install_key = p_install_key and l.status = 'linked'
    and exists (select 1 from public.public_character(l.ruleset, l.realm, l.name))
  order by a.opted_at desc, a.upload_id desc limit 1;
$$;
revoke all on function public.ops_contributor_identity(text) from public, anon, authenticated;
grant execute on function public.ops_contributor_identity(text) to service_role;

create or replace function public.revoke_ops_attribution(p_user_id uuid)
returns void language sql security definer set search_path = '' set lock_timeout = '3s' as $$
  delete from public.ops_upload_attributions where user_id = p_user_id;
$$;
revoke all on function public.revoke_ops_attribution(uuid) from public, anon, authenticated;
grant execute on function public.revoke_ops_attribution(uuid) to service_role;
