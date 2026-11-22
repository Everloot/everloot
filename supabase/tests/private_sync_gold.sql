-- Disposable local database only, after all migrations through 20261123100000_private_sync_gold.sql. Never run against
-- production. The private `gold` category: per-link consent, stored only for a linked character with consent, listed to
-- the owner, public only under show_gold. Everything is rolled back at the end.
begin;
insert into public.users (id, name, email) values
 ('00000000-0000-4000-8000-0000000000a7', 'Goldie', 'goldie@users.everloot.invalid'),
 ('00000000-0000-4000-8000-0000000000b7', 'Penny', 'penny@users.everloot.invalid');
insert into public.character_links (id,user_id,link_key,ruleset,realm_key,name_key,realm,name,race,class,faction,level,completion_ref) values
 ('30000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-0000000000a7',repeat('7',64),'forever','forever pioneer','coinvale','Forever Pioneer','Coinvale','Gnome','MAGE','Alliance',60,repeat('c',64));
insert into public.character_visibility (link_id, page_public) values ('30000000-0000-4000-8000-000000000071', true);
create function pg_temp.check_it(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %', label; end if; end $$;

-- Calls execute as the actual service role; its table grants remain revoked.
set local role service_role;
do $$ declare
 a constant uuid := '00000000-0000-4000-8000-0000000000a7';
 b constant uuid := '00000000-0000-4000-8000-0000000000b7';
 l constant uuid := '30000000-0000-4000-8000-000000000071';
 gold constant jsonb := '{"stats":{"328":1150905,"329":1077}}';
 facts constant jsonb := jsonb_build_array(jsonb_build_object('category','gold','captured_at','2026-11-22T10:00:00Z','data',gold));
 outcome_of text;
begin
 -- Without consent nothing is stored.
 select s.outcome into outcome_of from public.sync_character_facts(a,'forever','forever-pioneer','Coinvale','MAGE',repeat('5',64),facts) s;
 perform pg_temp.check_it(outcome_of is not distinct from 'no_consent','no consent, no gold');
 perform pg_temp.check_it((select o.data from public.own_character_facts(a,l) o where o.category='gold') is null,'nothing stored without consent');

 -- Consent is per link, for the owner only.
 perform pg_temp.check_it(public.set_sync_consent(b,l,'gold',true) is not distinct from 'not_found','other account cannot opt in');
 perform pg_temp.check_it(public.set_sync_consent(a,l,'gold',true) is null,'owner opts in to gold');

 -- Another account, or a character with no link, stores nothing.
 select s.outcome into outcome_of from public.sync_character_facts(b,'forever','forever-pioneer','Coinvale','MAGE',repeat('5',64),facts) s;
 perform pg_temp.check_it(outcome_of is not distinct from 'not_linked','other account cannot write');
 select s.outcome into outcome_of from public.sync_character_facts(a,'forever','forever-pioneer','Nobody','MAGE',repeat('5',64),facts) s;
 perform pg_temp.check_it(outcome_of is not distinct from 'not_linked','unlinked character cannot write');

 -- With consent the linked character's gold is stored.
 select s.outcome into outcome_of from public.sync_character_facts(a,'forever','forever-pioneer','Coinvale','MAGE',repeat('5',64),facts) s;
 perform pg_temp.check_it(outcome_of is not distinct from 'stored','gold stored');

 -- The owner sees gold.
 perform pg_temp.check_it((select o.consented from public.own_character_facts(a,l) o where o.category='gold') is not distinct from true,'owner sees gold consent');
 perform pg_temp.check_it((select o.data from public.own_character_facts(a,l) o where o.category='gold') is not distinct from gold,'owner reads gold');
 perform pg_temp.check_it(not exists (select from public.own_character_facts(b,l)),'other account reads nothing');

 -- Public only once show_gold is on.
 perform pg_temp.check_it(not exists (select from public.public_character_facts('forever','forever-pioneer','Coinvale') p where p.category='gold'),'gold private while show_gold is off');
 perform pg_temp.check_it(public.set_visibility(a,l,'{"show_gold":true}') is not distinct from true,'owner turns show_gold on');
 perform pg_temp.check_it((select p.data from public.public_character_facts('forever','forever-pioneer','Coinvale') p where p.category='gold') is not distinct from gold,'gold public under show_gold');
 perform pg_temp.check_it(public.set_visibility(a,l,'{"show_gold":false}') is not distinct from true,'owner turns show_gold off');
 perform pg_temp.check_it(not exists (select from public.public_character_facts('forever','forever-pioneer','Coinvale') p where p.category='gold'),'gold private again');

 -- A category the list does not hold is refused.
 begin
  perform public.set_sync_consent(a,l,'silver',true);
  raise exception 'silver consent accepted';
 exception when raise_exception then if sqlerrm is distinct from 'Invalid consent' then raise; end if; end;
 begin
  perform public.sync_character_facts(a,'forever','forever-pioneer','Coinvale','MAGE',repeat('5',64),
   jsonb_build_array(jsonb_build_object('category','silver','captured_at','2026-11-22T10:00:00Z','data',gold)));
  raise exception 'silver fact accepted';
 exception when raise_exception then if sqlerrm is distinct from 'Invalid facts' then raise; end if; end;

 -- Withdrawing gold consent deletes the stored gold.
 perform pg_temp.check_it(public.set_sync_consent(a,l,'gold',false) is null,'owner withdraws gold');
 perform pg_temp.check_it((select o.data from public.own_character_facts(a,l) o where o.category='gold') is null,'withdrawal deletes gold');
end $$;
reset role;

-- The table checks hold gold and refuse silver.
do $$ begin
 insert into public.character_sync_consent (link_id, category) values ('30000000-0000-4000-8000-000000000071','silver');
 raise exception 'silver consent row accepted';
exception when check_violation then null; end $$;
do $$ begin
 insert into public.character_facts (link_id, category, captured_at, data, data_hash, source_ref)
  values ('30000000-0000-4000-8000-000000000071','silver',now(),'{}',repeat('0',64),repeat('5',64));
 raise exception 'silver fact row accepted';
exception when check_violation then null; end $$;
select pg_temp.check_it(pg_get_constraintdef((select oid from pg_constraint where conname='character_facts_category_check')) like '%''gold''%','facts check holds gold');
select pg_temp.check_it(pg_get_constraintdef((select oid from pg_constraint where conname='character_sync_consent_category_check')) like '%''gold''%','consent check holds gold');
rollback;
