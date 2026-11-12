begin;
do $$
declare n integer; ok boolean; own_user uuid := '10000000-0000-4000-8000-000000000001';
  other_user uuid := '10000000-0000-4000-8000-000000000002';
  own_link uuid := '20000000-0000-4000-8000-000000000001';
  receipt uuid := '30000000-0000-4000-8000-000000000001';
  other_receipt uuid := '30000000-0000-4000-8000-000000000002';
begin
  if has_table_privilege('anon','public.ops_install_days','select')
    or has_table_privilege('authenticated','public.ops_upload_attributions','select')
    or has_function_privilege('anon','public.record_ops_intake(text,text,integer,integer,text[],text[])','execute')
    or has_function_privilege('authenticated','public.attribute_ops_uploads(uuid,uuid,uuid[],text,text,text[])','execute')
    or has_function_privilege('anon','public.ops_contributor_identity(text)','execute')
    or has_function_privilege('authenticated','public.revoke_ops_attribution(uuid)','execute') then
    raise exception 'Public access to private operations data';
  end if;
  if not has_function_privilege('service_role','public.record_ops_intake(text,text,integer,integer,text[],text[])','execute') then
    raise exception 'Server cannot record telemetry';
  end if;
  perform public.record_ops_intake('accepted',repeat('a',64),3,1,array['Synthetic Realm PvP'],array['loot']);
  perform public.record_ops_intake('accepted',repeat('a',64),0,0,array[]::text[],array[]::text[]);
  select receipts into n from public.ops_install_days where install_key=repeat('a',64);
  if n <> 2 then raise exception 'Successful no-new-record receipt not counted'; end if;
  perform public.record_ops_intake('validation',null,0,2,array[]::text[],array[]::text[]);
  select count(*) into n from public.ops_install_days;
  if n <> 1 then raise exception 'Rejected upload created contributor'; end if;
  insert into public.ops_install_days values(current_date-91,repeat('b',64),2,7,now(),array[]::text[],array[]::text[]);
  perform public.prune_ops_activity();
  if exists(select 1 from public.ops_install_days where day=current_date-91)
    or not exists(select 1 from public.ops_daily_totals where day=current_date-91 and receipts=2 and records=7) then
    raise exception 'Retention failed';
  end if;
  insert into public.users values(own_user),(other_user);
  insert into public.uploads values(receipt,'synthetic-install'),(other_receipt,'another-install');
  insert into public.character_links values(own_link,own_user,'Synthetic','Synthetic Realm PvP','forever','MAGE',10,'linked',repeat('c',64));
  insert into public.character_visibility values(own_link,true);
  ok := public.attribute_ops_uploads(other_user,own_link,array[receipt],'synthetic-install',repeat('a',64),array[repeat('c',64)]);
  if ok then raise exception 'Foreign account attributed a character'; end if;
  ok := public.attribute_ops_uploads(own_user,own_link,array[receipt,other_receipt],'synthetic-install',repeat('a',64),array[repeat('c',64)]);
  if ok or exists(select 1 from public.ops_upload_attributions) then raise exception 'Mixed install claim was not atomic'; end if;
  ok := public.attribute_ops_uploads(own_user,own_link,array[receipt],'synthetic-install',repeat('a',64),array[repeat('d',64)]);
  if ok then raise exception 'Wrong character proof accepted'; end if;
  ok := public.attribute_ops_uploads(own_user,own_link,array[receipt],'synthetic-install',repeat('a',64),array[repeat('c',64)]);
  if not ok then raise exception 'Valid explicit attribution refused'; end if;
  select count(*) into n from public.ops_contributor_identity(repeat('a',64));
  if n <> 1 then raise exception 'Attributed character unavailable'; end if;
  update public.character_visibility set page_public=false where link_id=own_link;
  if exists(select 1 from public.ops_contributor_identity(repeat('a',64))) then raise exception 'Privacy toggle leaked attribution'; end if;
  update public.character_visibility set page_public=true where link_id=own_link;
  update public.character_links set status='frozen' where id=own_link;
  if exists(select 1 from public.ops_contributor_identity(repeat('a',64))) then raise exception 'Frozen link leaked attribution'; end if;
  update public.character_links set status='linked' where id=own_link;
  insert into public.character_suppressions values('Synthetic','Synthetic Realm PvP');
  if exists(select 1 from public.ops_contributor_identity(repeat('a',64))) then raise exception 'Suppressed character leaked attribution'; end if;
  delete from public.character_suppressions;
  perform public.revoke_ops_attribution(other_user);
  if not exists(select 1 from public.ops_upload_attributions) then raise exception 'Foreign revocation removed attribution'; end if;
  perform public.revoke_ops_attribution(own_user);
  if exists(select 1 from public.ops_upload_attributions) then raise exception 'Owner revocation failed'; end if;
  perform public.attribute_ops_uploads(own_user,own_link,array[receipt],'synthetic-install',repeat('a',64),array[repeat('c',64)]);
  delete from public.character_links where id=own_link;
  if exists(select 1 from public.ops_upload_attributions) then raise exception 'Unlink did not cascade'; end if;
end $$;
-- Exercise real public-role refusal, rather than only inspecting metadata.
set local role anon;
do $$ begin
  begin perform public.ops_contributor_identity(repeat('a',64)); raise exception 'Anonymous function call succeeded';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
