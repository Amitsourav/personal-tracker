-- Phase 5: Google Calendar. Events are mirrored read-only for now; the planner
-- needs to know when Amit is busy before it can propose anything.
--
-- Kept in its own table rather than as tasks: an event is not a task, and
-- conflating them would put every meeting in his task list.
create table if not exists public.calendar_events (
  id uuid primary key default public.uuid_v7(),
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_id text not null default 'primary',
  external_id text not null,
  title text,
  description text,
  location text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  -- 'confirmed' | 'tentative' | 'cancelled'. Cancelled rows are kept so a
  -- deletion in Google propagates instead of leaving a ghost in the planner.
  status text not null default 'confirmed',
  -- accepted / declined / needsAction for Amit specifically. A meeting he
  -- declined is not busy time.
  self_response text,
  organizer text,
  attendees jsonb not null default '[]'::jsonb,
  html_link text,
  -- Set when a task was time-blocked into the calendar by the planner.
  task_id uuid references public.tasks(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, calendar_id, external_id)
);
create index if not exists calendar_events_user_time_idx
  on public.calendar_events(user_id, start_at);
alter table public.calendar_events enable row level security;
create policy "own events" on public.calendar_events
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.user_secrets
  add column if not exists calendar_enabled boolean not null default true,
  add column if not exists calendar_sync_token text,
  add column if not exists calendar_last_sync_at timestamptz;
