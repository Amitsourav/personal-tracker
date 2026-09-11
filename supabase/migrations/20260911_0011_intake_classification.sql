-- Universal intake, from the blueprint: every message is classified, and only
-- ONE of the types becomes a task. The document's own exclusion list says "not
-- a system that turns every message into a task" - which is what Tracker was,
-- because anything that was not a task was thrown away.
--
-- Now the rest is kept: a decision someone is waiting on, an event that changes
-- plans, a risk, an opportunity, a fact worth remembering.
alter table public.messages
  add column if not exists intake_type text
    check (intake_type in ('information','task','commitment','request','decision','event','risk','opportunity','noise')),
  add column if not exists intake_summary text,
  -- Set when Amit has seen it, so a signal stops resurfacing without being
  -- deleted - these are context, and deleting context is the old behaviour.
  add column if not exists intake_seen_at timestamptz;

comment on column public.messages.intake_type is
  'Blueprint universal intake. Only ''task'' creates a task; the rest are kept as context rather than discarded.';

create index if not exists messages_intake_idx
  on public.messages (user_id, intake_type, sent_at desc)
  where intake_seen_at is null and intake_type is not null;
