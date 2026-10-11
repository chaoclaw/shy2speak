create extension if not exists citext;

create table if not exists users (
  id uuid primary key,
  email citext unique,
  phone text unique,
  password_hash text,
  email_verified boolean not null default false,
  phone_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_identity_required check (email is not null or phone is not null)
);

create table if not exists profiles (
  user_id uuid primary key references users(id) on delete cascade,
  nickname citext not null unique,
  signature text not null default '',
  avatar text not null default 'S',
  locale text not null default 'zh',
  updated_at timestamptz not null default now(),
  constraint nickname_length check (char_length(trim(nickname::text)) between 2 and 24),
  constraint signature_length check (char_length(signature) <= 160)
);

create table if not exists refresh_sessions (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists refresh_sessions_user_id_idx on refresh_sessions(user_id);
create index if not exists refresh_sessions_expiry_idx on refresh_sessions(expires_at);

create table if not exists one_time_codes (
  id uuid primary key,
  method text not null check (method in ('email', 'phone')),
  account citext not null,
  purpose text not null check (purpose in ('login', 'register', 'recovery')),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists one_time_codes_lookup_idx on one_time_codes(method, account, purpose, created_at desc);

create table if not exists learning_states (
  user_id uuid primary key references users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists practice_snapshots (
  user_id uuid not null references users(id) on delete cascade,
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
