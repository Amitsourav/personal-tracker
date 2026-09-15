-- Focus sessions.
--
-- Everything else built here brings work in: Gmail, WhatsApp, voice notes,
-- signals, code hints. Nothing kept any of it out. The research is unambiguous
-- that a developer loses more to interruption than to any task on the list —
-- 23 minutes to recover from each one, and interrupted work carries twice the
-- errors — so capture being continuous must not mean delivery is.
--
-- Recording the session has a second use: actual minutes against the estimate
-- is the only honest feedback the estimator will ever get.
create table if not exists public.focus_sessions (
  id uuid primary key default public.uuid_v7(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  planned_min int not null default 50,
  actual_min int,
  -- What the estimator had predicted when the session began, frozen here so a
  -- later re-estimate cannot quietly rewrite its own record.
  estimated_min int,
  -- Suggestions that arrived while he was working, shown on the way out rather
  -- than the moment they landed.
  arrived int,
  created_at timestamptz not null default now()
);
alter table public.focus_sessions enable row level security;
create policy "own focus sessions" on public.focus_sessions
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create index if not exists focus_sessions_user_started on public.focus_sessions (user_id, started_at desc);
