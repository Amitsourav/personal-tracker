-- "You already did this."
--
-- Found by accident on 14 Sep: the task "Make amount mandatory when moving lead
-- stage on FMC CRM" pointed at stage_machine.py, whose last commit reads
-- 'feat(leads): a lead cannot leave "created" without a loan amount' — pushed
-- 24 minutes after Deepak asked for it. The task had been open for two days.
--
-- Deliberately a signal, never an action. A task that closes itself wrongly
-- disappears, and a thing that is not there cannot be noticed; it surfaces when
-- a client asks why it was never done. So this only ever says "probably", with
-- the commit as evidence, and Amit presses the button.
alter table public.task_code_hints
  add column if not exists maybe_done boolean not null default false,
  add column if not exists done_commit jsonb,      -- {path, message, author, at}
  add column if not exists done_reason text,
  -- Once dismissed it stays dismissed: a suggestion that returns after being
  -- rejected is how a panel trains people to ignore it.
  add column if not exists done_dismissed_at timestamptz;

-- When the check last ran, so "checked and said no" is distinguishable from
-- "never ran". Recording only the hits is how a dead cron looked healthy for a
-- day earlier in this project.
alter table public.task_code_hints
  add column if not exists done_checked_at timestamptz;
