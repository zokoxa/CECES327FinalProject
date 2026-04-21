-- ════════════════════════════════════════════════
--  Chess Clone — Supabase Schema
--  Run this in your Supabase SQL Editor
-- ════════════════════════════════════════════════

-- ── Profiles ──────────────────────────────────────────────────────────────
-- Extended user data. Linked 1-to-1 with auth.users via id.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique,
  rating      int  not null default 1200,
  games_won   int  not null default 0,
  games_lost  int  not null default 0,
  games_drawn int  not null default 0,
  created_at  timestamptz not null default now()
);

-- RLS: users can read all profiles, but only update their own
alter table public.profiles enable row level security;

create policy "Profiles are publicly readable"
  on public.profiles for select using (true);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- ── Games ──────────────────────────────────────────────────────────────────
create table if not exists public.games (
  id         uuid primary key,
  white_id   uuid references public.profiles(id),
  black_id   uuid references public.profiles(id),
  status     text not null default 'active',  -- 'active' | 'finished' | 'abandoned'
  result     text,                            -- 'white' | 'black' | 'draw' | 'abandoned'
  reason     text,                            -- 'checkmate' | 'resignation' | 'timeout' | etc.
  pgn        text,                            -- full PGN string (optional, set at end)
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);

alter table public.games enable row level security;

-- Players can read their own games; service role bypasses RLS for writes
create policy "Players can read their own games"
  on public.games for select
  using (auth.uid() = white_id or auth.uid() = black_id);

-- ── Moves ──────────────────────────────────────────────────────────────────
create table if not exists public.moves (
  id              bigserial primary key,
  game_id         uuid not null references public.games(id) on delete cascade,
  player_id       uuid not null references public.profiles(id),
  move_number     int  not null,
  move_notation   text not null,  -- SAN or UCI
  created_at      timestamptz not null default now()
);

alter table public.moves enable row level security;

create policy "Moves are readable by game participants"
  on public.moves for select
  using (
    exists (
      select 1 from public.games g
      where g.id = game_id
        and (g.white_id = auth.uid() or g.black_id = auth.uid())
    )
  );

-- ── Indexes ────────────────────────────────────────────────────────────────
create index if not exists idx_games_white_id on public.games(white_id);
create index if not exists idx_games_black_id on public.games(black_id);
create index if not exists idx_moves_game_id  on public.moves(game_id);

-- ── Auto-create profile on signup ──────────────────────────────────────────
-- Note: if you register via the /api/auth/register endpoint, the profile is
-- created there. This trigger is a safety net for direct Supabase auth signups.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
