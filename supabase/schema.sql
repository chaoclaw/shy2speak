-- Shy2Speak Supabase schema
-- Run once in the Supabase SQL editor. It uses only the authenticated user's
-- identity; the browser must receive a publishable/anon key, never service_role.

create extension if not exists citext;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname citext not null unique,
  signature text not null default '',
  avatar text not null default 'S',
  locale text not null default 'zh',
  updated_at timestamptz not null default now(),
  constraint nickname_length check (char_length(trim(nickname::text)) between 2 and 24),
  constraint signature_length check (char_length(signature) <= 160)
);

create table if not exists public.learning_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.practice_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope_type text not null check (scope_type in ('topic', 'chapter', 'sentence')),
  scope_id text not null,
  practice_seconds integer not null default 0 check (practice_seconds >= 0),
  practice_count integer not null default 0 check (practice_count >= 0),
  recording_count integer not null default 0 check (recording_count >= 0),
  scores jsonb not null default '[]'::jsonb,
  last_practiced_at timestamptz,
  client_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, scope_type, scope_id)
);

alter table public.profiles enable row level security;
alter table public.learning_states enable row level security;
alter table public.practice_snapshots enable row level security;

drop policy if exists "profiles own row" on public.profiles;
create policy "profiles own row" on public.profiles for all to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
drop policy if exists "learning states own row" on public.learning_states;
create policy "learning states own row" on public.learning_states for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "practice snapshots own rows" on public.practice_snapshots;
create policy "practice snapshots own rows" on public.practice_snapshots for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists learning_states_touch_updated_at on public.learning_states;
create trigger learning_states_touch_updated_at before update on public.learning_states for each row execute function public.touch_updated_at();
drop trigger if exists practice_snapshots_touch_updated_at on public.practice_snapshots;
create trigger practice_snapshots_touch_updated_at before update on public.practice_snapshots for each row execute function public.touch_updated_at();

create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare requested text;
begin
  requested := nullif(trim(coalesce(new.raw_user_meta_data ->> 'nickname', '')), '');
  if requested is null or char_length(requested) < 2 or exists(select 1 from public.profiles where nickname = requested::citext) then
    requested := 'learner_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  insert into public.profiles(id, nickname) values (new.id, requested) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_profile_for_new_user();

create or replace function public.is_nickname_available(p_nickname text)
returns boolean language sql stable security definer set search_path = '' as $$
  select char_length(trim(p_nickname)) between 2 and 24
    and not exists(select 1 from public.profiles where nickname = trim(p_nickname)::citext and id <> (select auth.uid()));
$$;

create or replace function public.save_my_profile(p_nickname text, p_signature text, p_avatar text, p_locale text)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare result public.profiles;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if char_length(trim(p_nickname)) not between 2 and 24 then raise exception 'Nickname must be 2-24 characters'; end if;
  insert into public.profiles(id, nickname, signature, avatar, locale)
  values ((select auth.uid()), trim(p_nickname), left(coalesce(p_signature, ''), 160), coalesce(nullif(p_avatar, ''), 'S'), coalesce(nullif(p_locale, ''), 'zh'))
  on conflict (id) do update set nickname = excluded.nickname, signature = excluded.signature, avatar = excluded.avatar, locale = excluded.locale
  returning * into result;
  return result;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'Nickname already exists';
end;
$$;

grant execute on function public.is_nickname_available(text) to authenticated;
grant execute on function public.save_my_profile(text, text, text, text) to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.learning_states to authenticated;
grant select, insert, update, delete on public.practice_snapshots to authenticated;
