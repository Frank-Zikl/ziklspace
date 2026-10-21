-- Run once in the project's SQL editor or with `supabase db push`.
-- Privileged helpers stay outside the Data API's exposed public schema.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;
create table public.room_owners (
  user_id uuid primary key references auth.users(id),
  singleton boolean not null default true unique check (singleton)
);
alter table public.room_owners enable row level security;
create policy "Owner can inspect own membership" on public.room_owners
  for select to authenticated using (user_id = (select auth.uid()));

create function private.is_room_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.room_owners where user_id = (select auth.uid()));
$$;
revoke all on function private.is_room_owner() from public, anon, authenticated;
grant execute on function private.is_room_owner() to anon, authenticated;

create table public.room_entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('whiteboard', 'sticky', 'thought')),
  title text not null default '' check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 30000),
  source text not null default 'manual' check (source in ('manual', 'gpt', 'gemini', 'other')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  paper_state text not null default 'active' check (paper_state in ('active', 'crossed', 'torn')),
  ingest_key uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'sticky' or paper_state = 'active'),
  check (kind <> 'sticky' or char_length(body) between 1 and 600),
  check (kind <> 'whiteboard' or char_length(body) <= 3000)
);
create unique index room_one_whiteboard on public.room_entries(kind) where kind = 'whiteboard';
create index room_entries_public on public.room_entries(status, kind, created_at desc);

create table public.room_revisions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.room_entries(id),
  title text not null,
  body text not null,
  source text not null,
  status text not null,
  paper_state text not null,
  recorded_at timestamptz not null default now()
);
create index room_revisions_entry on public.room_revisions(entry_id, recorded_at desc);

create function private.preserve_room_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_room_owner() then
    raise exception 'Owner access required';
  end if;
  if old.paper_state = 'torn' then
    raise exception 'A torn note is archived and cannot be changed';
  end if;
  if old.kind <> new.kind then
    raise exception 'An object cannot change its kind';
  end if;
  insert into public.room_revisions(entry_id, title, body, source, status, paper_state)
    values (old.id, old.title, old.body, old.source, old.status, old.paper_state);
  new.updated_at = clock_timestamp();
  return new;
end;
$$;
revoke all on function private.preserve_room_revision() from public, anon, authenticated;
create trigger preserve_room_revision before update on public.room_entries
  for each row execute function private.preserve_room_revision();

alter table public.room_entries enable row level security;
alter table public.room_revisions enable row level security;
create policy "Read published entries or own drafts" on public.room_entries
  for select to anon, authenticated using (status = 'published' or (select private.is_room_owner()));
create policy "Only owner inserts entries" on public.room_entries
  for insert to authenticated with check ((select private.is_room_owner()));
create policy "Only owner updates entries" on public.room_entries
  for update to authenticated using ((select private.is_room_owner())) with check ((select private.is_room_owner()));
-- Deliberately no DELETE policy or DELETE grant: notes are crossed out or archived.
create policy "Read only published history or own revisions" on public.room_revisions
  for select to anon, authenticated using (
    (select private.is_room_owner()) or (
      status = 'published' and exists (
        select 1 from public.room_entries entry where entry.id = entry_id and entry.status = 'published'
      )
    )
  );

grant usage on schema public to anon, authenticated, service_role;
revoke all on public.room_owners, public.room_entries, public.room_revisions from anon, authenticated;
grant select on public.room_owners to authenticated;
grant select on public.room_entries, public.room_revisions to anon, authenticated;
grant insert (kind, title, body, source, status, paper_state) on public.room_entries to authenticated;
grant update (title, body, source, status, paper_state) on public.room_entries to authenticated;
grant all on public.room_owners, public.room_entries, public.room_revisions to service_role;

-- Tearing and replacing one sticky note is a single transaction.
create function public.rewrite_sticky(p_id uuid, p_body text, p_expected_updated_at timestamptz)
returns setof public.room_entries language plpgsql security invoker set search_path = '' as $$
declare previous public.room_entries;
begin
  if not private.is_room_owner() then raise exception 'Owner access required'; end if;
  select * into previous from public.room_entries where id = p_id for update;
  if not found or previous.kind <> 'sticky' or previous.paper_state = 'torn' then
    raise exception 'Sticky note is not available';
  end if;
  if previous.updated_at is distinct from p_expected_updated_at then
    raise exception 'Note changed in another session';
  end if;
  update public.room_entries set paper_state = 'torn' where id = p_id;
  return query insert into public.room_entries(kind, body, status)
    values ('sticky', p_body, previous.status) returning *;
end;
$$;
revoke all on function public.rewrite_sticky(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.rewrite_sticky(uuid, text, timestamptz) to authenticated;
