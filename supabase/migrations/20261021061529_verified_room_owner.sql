-- The approved mailbox is configured separately by the database administrator.
-- Never derive ownership from user-editable metadata or an unverified signup.
create table private.room_owner_setup (
  singleton boolean primary key default true check (singleton),
  email text not null unique check (email = lower(trim(email)))
);
alter table private.room_owner_setup enable row level security;
revoke all on private.room_owner_setup from public, anon, authenticated;

create function private.register_verified_room_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null and exists (
    select 1 from private.room_owner_setup setup where setup.email = lower(new.email)
  ) then
    insert into public.room_owners(user_id) values (new.id)
      on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.register_verified_room_owner() from public, anon, authenticated;
create trigger register_verified_room_owner
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function private.register_verified_room_owner();
