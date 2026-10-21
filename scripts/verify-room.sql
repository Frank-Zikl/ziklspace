-- Initial empty-project verification through the Supabase SQL tool.
-- Every fixture, including the temporary approved mailbox, is rolled back.
begin;
select set_config('room.check_owner', gen_random_uuid()::text, true);
select set_config('room.check_visitor', gen_random_uuid()::text, true);
insert into private.room_owner_setup(email) values ('room-owner-check@example.invalid')
  on conflict (singleton) do update set email=excluded.email;
insert into auth.users(id,email) values
  (current_setting('room.check_owner')::uuid,'room-owner-check@example.invalid'),
  (current_setting('room.check_visitor')::uuid,'room-visitor-check@example.invalid');
update auth.users set email_confirmed_at=now() where id=current_setting('room.check_visitor')::uuid;
do $$
begin
  if exists (select 1 from public.room_owners) then
    raise exception 'Unverified owner or verified visitor was enrolled';
  end if;
end;
$$;
update auth.users set email_confirmed_at=now() where id=current_setting('room.check_owner')::uuid;
do $$
begin
  if not exists (select 1 from public.room_owners where user_id=current_setting('room.check_owner')::uuid) then
    raise exception 'Verified approved mailbox was not enrolled';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('room.check_owner'), true);
do $$
declare sticky public.room_entries; replacement public.room_entries;
begin
  insert into public.room_entries(kind,body,status)
    values ('thought','private verification draft','draft');
  insert into public.room_entries(kind,body,status)
    values ('sticky','original verification note','published') returning * into sticky;
  select * into replacement from public.rewrite_sticky(sticky.id,'replacement verification note',sticky.updated_at);
  if replacement.id = sticky.id or replacement.body <> 'replacement verification note' then
    raise exception 'Replacement failed';
  end if;
  if not exists (select 1 from public.room_entries where id=sticky.id and paper_state='torn') then
    raise exception 'Original note was not archived';
  end if;
  if not exists (select 1 from public.room_revisions where entry_id=sticky.id and body='original verification note') then
    raise exception 'Revision was not retained';
  end if;
  begin
    perform public.rewrite_sticky(replacement.id,repeat('x',601),replacement.updated_at);
    raise exception 'Invalid replacement succeeded';
  exception when check_violation then null;
  end;
  if not exists (select 1 from public.room_entries where id=replacement.id and paper_state='active') then
    raise exception 'Failed replacement was not rolled back';
  end if;
end;
$$;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  if exists (select 1 from public.room_entries where status='draft') then
    raise exception 'Anonymous visitor can read private drafts';
  end if;
  if (select count(*) from public.room_entries) <> 2 then
    raise exception 'Published notes are not readable';
  end if;
  begin
    insert into public.room_entries(kind,body) values ('thought','unauthorized');
    raise exception 'Anonymous insert succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('room.check_visitor'), true);
do $$
declare affected integer;
begin
  if exists (select 1 from public.room_entries where status='draft') then
    raise exception 'Signed-in visitor can read private drafts';
  end if;
  begin
    insert into public.room_entries(kind,body) values ('thought','unauthorized');
    raise exception 'Visitor insert succeeded';
  exception when insufficient_privilege then null;
  end;
  update public.room_entries set body='unauthorized';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Visitor update succeeded'; end if;
  begin
    delete from public.room_entries;
    raise exception 'Visitor delete succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
rollback;
select 'passed: verified mailbox enrollment, owner writes, private drafts, visitor read-only, revisions, atomic rewrite; fixtures rolled back' as verification;
