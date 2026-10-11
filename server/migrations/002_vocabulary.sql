create table if not exists user_content_seeds (
  user_id uuid not null references users(id) on delete cascade,
  content_type text not null,
  version integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, content_type)
);

create table if not exists user_vocabulary_items (
  user_id uuid not null references users(id) on delete cascade,
  word_id text not null,
  payload jsonb not null,
  removed_from_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, word_id)
);

create table if not exists user_vocabulary_memberships (
  user_id uuid not null references users(id) on delete cascade,
  word_id text not null,
  book_id text not null,
  book_name text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, word_id, book_id),
  foreign key (user_id, word_id) references user_vocabulary_items(user_id, word_id) on delete cascade
);
create index if not exists user_vocabulary_cleanup_idx on user_vocabulary_items(user_id, removed_from_default);
