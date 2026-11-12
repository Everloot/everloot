-- Disposable PostgreSQL fixture for the operations migrations.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create table public.users(id uuid primary key);
create table public.uploads(id uuid primary key, install_id text not null);
create table public.character_links(
  id uuid primary key, user_id uuid references public.users(id) on delete cascade,
  name text, realm text, ruleset text, class text, level smallint,
  status text, completion_ref text
);
create table public.character_visibility(link_id uuid references public.character_links(id) on delete cascade, page_public boolean);
create table public.character_suppressions(name text, realm text);
create table public.usage_counters(day date, metric text, count bigint, primary key(day,metric));
-- Model the existing public_character boundary: current public flag, non-frozen and unsuppressed.
create function public.public_character(p_ruleset text, p_realm text, p_name text)
returns table(name text) language sql stable as $$
  select l.name from public.character_links l join public.character_visibility v on v.link_id=l.id
  where l.ruleset=p_ruleset and l.realm=p_realm and l.name=p_name and l.status='linked' and v.page_public
    and not exists(select 1 from public.character_suppressions s where s.name=l.name and s.realm=l.realm)
$$;
