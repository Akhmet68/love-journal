-- Love Journal schema (PostgreSQL)
-- Run in pgAdmin Query Tool on your database.

create extension if not exists pgcrypto;

-- 1) Users (exactly 2 rows recommended)
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- 2) Sessions (cookie -> token, stored as hash)
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique, -- sha256 hex
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_expires_idx on public.sessions (expires_at);

-- 3) Calendar events
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id) on delete cascade,
  event_date date not null,
  title text not null,
  note text not null default '',
  kind text not null default 'memory', -- memory | birthday | other
  icon text not null default '❤'
);

create index if not exists events_date_idx on public.events (event_date desc);
create unique index if not exists events_unique_date_title on public.events (event_date, title);

-- 4) Diary entries
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id) on delete cascade,
  entry_date date not null default current_date,
  body text not null,
  tags text[] not null default '{}'
);
create index if not exists entries_date_idx on public.entries (entry_date desc, created_at desc);

-- 5) Photos (stored on disk, path in DB)
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id) on delete cascade,
  taken_date date not null default current_date,
  caption text not null default '',
  tags text[] not null default '{}',
  file_name text not null unique, -- stored under /uploads/
  mime_type text not null,
  bytes int not null
);
create index if not exists photos_taken_idx on public.photos (taken_date desc, created_at desc);
