-- Run this once in the Supabase SQL editor.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.attempts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.attempts enable row level security;
alter table public.sessions enable row level security;

create policy "Users manage their profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "Users manage their attempts" on public.attempts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage their sessions" on public.sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists attempts_user_created_idx on public.attempts(user_id, created_at);
create index if not exists sessions_user_created_idx on public.sessions(user_id, created_at);
