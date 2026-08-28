-- Postgres. Everything here is small, edited by hand, and owned by Ruby.
-- Anything unbounded lives in ClickHouse instead. See clickhouse/schema.sql

create extension if not exists "pgcrypto";

create table if not exists families (
  id            uuid primary key default gen_random_uuid(),
  elder_name    text not null,
  speaker_name  text not null,
  elder_city    text,
  elder_tz      text not null default 'Asia/Kolkata',
  speaker_tz    text not null default 'America/Los_Angeles',
  created_at    timestamptz default now()
);

-- Who exists in her world. The avatar only knows these people.
create table if not exists relations (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid references families(id) on delete cascade,
  name        text not null,
  aliases     text[] default '{}',
  relation    text,
  context     text,
  birthday    date,
  deceased    boolean default false,
  created_at  timestamptz default now(),
  unique (family_id, name)
);

-- A handful of vivid memories, not a life history.
create table if not exists memories (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid references families(id) on delete cascade,
  title       text not null,
  body        text not null,
  tags        text[] default '{}',
  created_at  timestamptz default now()
);

-- Fresh news about Ruby. Without a recent row here the avatar falls back
-- to warm generalities rather than inventing specifics.
create table if not exists updates (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid references families(id) on delete cascade,
  body        text not null,
  created_at  timestamptz default now()
);

create table if not exists medicines (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid references families(id) on delete cascade,
  name          text not null,
  dose          text,
  schedule_time time not null,
  active        boolean default true
);

-- One row per medicine per day, created when the reminder is spoken.
create table if not exists medicine_log (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid references families(id) on delete cascade,
  medicine_id   uuid references medicines(id) on delete cascade,
  on_date       date not null,
  scheduled_at  timestamptz,
  confirmed     boolean,
  confirmed_at  timestamptz,
  unique (family_id, medicine_id, on_date)
);

create table if not exists reminders (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid references families(id) on delete cascade,
  kind          text not null default 'reminder',
  text          text not null,
  schedule_time time,
  on_date       date,
  state         text not null default 'pending',
  spoken_at     timestamptz,
  acknowledged_at timestamptz,
  created_at    timestamptz default now()
);

-- The six-day loop. Anything the avatar did not know, batched into a
-- daily digest instead of pinging Ruby every time.
create table if not exists gaps (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid references families(id) on delete cascade,
  name        text not null,
  kind        text not null default 'person',
  priority    text not null default 'routine',
  status      text not null default 'open',
  answer      text,
  first_heard timestamptz default now(),
  answered_at timestamptz,
  unique (family_id, name)
);

-- Latest still from her screen. Last write wins, never appended.
create table if not exists frames (
  family_id   uuid primary key references families(id) on delete cascade,
  image       text not null,
  captured_at timestamptz default now()
);

create index if not exists gaps_open_idx on gaps (family_id, status);
create index if not exists reminders_state_idx on reminders (family_id, state);
