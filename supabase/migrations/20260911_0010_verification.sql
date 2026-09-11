-- "Completion is not success." From the blueprint's verification ladder:
--   V0 attempted → V1 self-reported → V2 externally verified → V3 outcome verified
--
-- Ticking a box records that Amit believes he finished. It does not record that
-- the person who asked for it actually received anything. Those are different
-- facts and the system should not conflate them.
--
-- Only work someone else asked for carries a verification state. A task with no
-- person attached is his own; nobody is waiting, so done is genuinely done, and
-- asking him to confirm it would be nagging.
alter table public.tasks
  add column if not exists verification text not null default 'none'
    check (verification in ('none','self','evidence','confirmed')),
  add column if not exists verified_at timestamptz,
  add column if not exists verification_note text;

comment on column public.tasks.verification is
  'none = not applicable (nobody asked) | self = Amit says done | evidence = a message since suggests it landed | confirmed = acknowledged or Amit confirmed';

create index if not exists tasks_unverified_idx on public.tasks (user_id, verification)
  where deleted_at is null and verification = 'self';

-- Anything already completed for a person is self-reported and unconfirmed;
-- that is the honest starting state rather than assuming it all landed.
update public.tasks
set verification = 'self'
where deleted_at is null and status = 'done'
  and person_id is not null and verification = 'none';
