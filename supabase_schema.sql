-- ============================================================
-- SCHOOOL v1 — SUPABASE DATABASE SETUP
-- Run this whole file in the Supabase SQL Editor ONCE.
-- ============================================================

create extension if not exists citext;

-- ---------- Profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext not null unique,
  created_at timestamptz not null default now(),
  constraint profiles_username_format
    check (username::text ~ '^[a-z0-9_]{3,24}$')
);

create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text not null default 'system' check (theme in ('system','light','dark')),
  background text not null default 'soft' check (background in ('soft','plain','gradient','grid','midnight')),
  font_family text not null default 'system' check (font_family in ('system','rounded','serif','mono')),
  font_size int not null default 16 check (font_size between 13 and 22),
  font_color text not null default '#1f2937' check (font_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text not null default '#5b5ce2' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  updated_at timestamptz not null default now()
);

-- Creates profile + settings automatically from username metadata
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_username text;
begin
  new_username := lower(trim(new.raw_user_meta_data->>'username'));

  if new_username is null or new_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Invalid username';
  end if;

  insert into public.profiles(id, username)
  values(new.id, new_username);

  insert into public.user_settings(user_id)
  values(new.id);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- Global chat ----------
create table if not exists public.global_messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

-- ---------- Friend requests + friends ----------
create table if not exists public.friend_requests (
  id bigint generated always as identity primary key,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sender_id <> receiver_id)
);

create unique index if not exists friend_requests_pair_unique
on public.friend_requests (
  least(sender_id::text, receiver_id::text),
  greatest(sender_id::text, receiver_id::text)
);

create table if not exists public.friends (
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, friend_id),
  check (user_id <> friend_id)
);

create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.friends
    where user_id = a and friend_id = b
  );
$$;

create or replace function public.friend_request_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();

  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    insert into public.friends(user_id, friend_id)
    values(new.sender_id, new.receiver_id)
    on conflict do nothing;

    insert into public.friends(user_id, friend_id)
    values(new.receiver_id, new.sender_id)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists friend_request_update_trigger on public.friend_requests;
create trigger friend_request_update_trigger
before update on public.friend_requests
for each row execute function public.friend_request_changed();

-- ---------- Direct messages ----------
create table if not exists public.direct_messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  check (sender_id <> receiver_id)
);

-- ---------- Friend groups ----------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key(group_id, user_id)
);

create table if not exists public.group_invites (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(group_id, invitee_id),
  check (inviter_id <> invitee_id)
);

create table if not exists public.group_messages (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create or replace function public.is_group_member(g uuid, u uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.group_members
    where group_id = g and user_id = u
  );
$$;

create or replace function public.is_group_invited(g uuid, u uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.group_invites
    where group_id = g and invitee_id = u and status = 'pending'
  );
$$;

create or replace function public.group_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.group_members(group_id, user_id, role)
  values(new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists group_created_trigger on public.groups;
create trigger group_created_trigger
after insert on public.groups
for each row execute function public.group_created();

create or replace function public.group_invite_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();

  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    insert into public.group_members(group_id, user_id, role)
    values(new.group_id, new.invitee_id, 'member')
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists group_invite_update_trigger on public.group_invites;
create trigger group_invite_update_trigger
before update on public.group_invites
for each row execute function public.group_invite_changed();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.global_messages enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friends enable row level security;
alter table public.direct_messages enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;
alter table public.group_messages enable row level security;

-- profiles
drop policy if exists "profiles readable by signed in users" on public.profiles;
create policy "profiles readable by signed in users"
on public.profiles for select to authenticated
using (true);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- settings
drop policy if exists "users read own settings" on public.user_settings;
create policy "users read own settings"
on public.user_settings for select to authenticated
using (user_id = auth.uid());

drop policy if exists "users update own settings" on public.user_settings;
create policy "users update own settings"
on public.user_settings for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "users insert own settings" on public.user_settings;
create policy "users insert own settings"
on public.user_settings for insert to authenticated
with check (user_id = auth.uid());

-- global chat
drop policy if exists "global messages readable" on public.global_messages;
create policy "global messages readable"
on public.global_messages for select to authenticated
using (true);

drop policy if exists "send global message as self" on public.global_messages;
create policy "send global message as self"
on public.global_messages for insert to authenticated
with check (sender_id = auth.uid());

drop policy if exists "delete own global messages" on public.global_messages;
create policy "delete own global messages"
on public.global_messages for delete to authenticated
using (sender_id = auth.uid());

-- friend requests
drop policy if exists "view own friend requests" on public.friend_requests;
create policy "view own friend requests"
on public.friend_requests for select to authenticated
using (sender_id = auth.uid() or receiver_id = auth.uid());

drop policy if exists "send friend request as self" on public.friend_requests;
create policy "send friend request as self"
on public.friend_requests for insert to authenticated
with check (
  sender_id = auth.uid()
  and receiver_id <> auth.uid()
  and not public.are_friends(sender_id, receiver_id)
);

drop policy if exists "receiver responds to friend request" on public.friend_requests;
create policy "receiver responds to friend request"
on public.friend_requests for update to authenticated
using (receiver_id = auth.uid())
with check (receiver_id = auth.uid());

drop policy if exists "participants delete nonaccepted request" on public.friend_requests;
create policy "participants delete nonaccepted request"
on public.friend_requests for delete to authenticated
using (
  status <> 'accepted'
  and (sender_id = auth.uid() or receiver_id = auth.uid())
);

-- friends
drop policy if exists "users read own friends" on public.friends;
create policy "users read own friends"
on public.friends for select to authenticated
using (user_id = auth.uid());

-- direct messages
drop policy if exists "participants read dms" on public.direct_messages;
create policy "participants read dms"
on public.direct_messages for select to authenticated
using (
  (sender_id = auth.uid() or receiver_id = auth.uid())
  and public.are_friends(sender_id, receiver_id)
);

drop policy if exists "friends send dms" on public.direct_messages;
create policy "friends send dms"
on public.direct_messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and public.are_friends(sender_id, receiver_id)
);

drop policy if exists "sender deletes own dms" on public.direct_messages;
create policy "sender deletes own dms"
on public.direct_messages for delete to authenticated
using (sender_id = auth.uid());

-- groups
drop policy if exists "members or invitees view groups" on public.groups;
create policy "members or invitees view groups"
on public.groups for select to authenticated
using (
  public.is_group_member(id, auth.uid())
  or public.is_group_invited(id, auth.uid())
);

drop policy if exists "users create owned groups" on public.groups;
create policy "users create owned groups"
on public.groups for insert to authenticated
with check (owner_id = auth.uid());

drop policy if exists "owners update groups" on public.groups;
create policy "owners update groups"
on public.groups for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "owners delete groups" on public.groups;
create policy "owners delete groups"
on public.groups for delete to authenticated
using (owner_id = auth.uid());

-- group members
drop policy if exists "group members view members" on public.group_members;
create policy "group members view members"
on public.group_members for select to authenticated
using (public.is_group_member(group_id, auth.uid()));

-- group invites
drop policy if exists "relevant users view group invites" on public.group_invites;
create policy "relevant users view group invites"
on public.group_invites for select to authenticated
using (
  invitee_id = auth.uid()
  or inviter_id = auth.uid()
  or public.is_group_member(group_id, auth.uid())
);

drop policy if exists "group members create invites" on public.group_invites;
create policy "group members create invites"
on public.group_invites for insert to authenticated
with check (
  inviter_id = auth.uid()
  and invitee_id <> auth.uid()
  and public.is_group_member(group_id, auth.uid())
);

drop policy if exists "invitee responds to group invite" on public.group_invites;
create policy "invitee responds to group invite"
on public.group_invites for update to authenticated
using (invitee_id = auth.uid())
with check (invitee_id = auth.uid());

drop policy if exists "invite participants delete unresolved invite" on public.group_invites;
create policy "invite participants delete unresolved invite"
on public.group_invites for delete to authenticated
using (
  status <> 'accepted'
  and (invitee_id = auth.uid() or inviter_id = auth.uid())
);

-- group messages
drop policy if exists "members read group messages" on public.group_messages;
create policy "members read group messages"
on public.group_messages for select to authenticated
using (public.is_group_member(group_id, auth.uid()));

drop policy if exists "members send group messages" on public.group_messages;
create policy "members send group messages"
on public.group_messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and public.is_group_member(group_id, auth.uid())
);

drop policy if exists "sender deletes own group messages" on public.group_messages;
create policy "sender deletes own group messages"
on public.group_messages for delete to authenticated
using (sender_id = auth.uid());

-- ============================================================
-- REALTIME
-- Safely add tables to the Supabase Realtime publication.
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'global_messages',
    'friend_requests',
    'friends',
    'direct_messages',
    'group_members',
    'group_invites',
    'group_messages'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
