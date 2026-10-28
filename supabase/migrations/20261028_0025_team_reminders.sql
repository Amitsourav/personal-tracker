-- Automatic reminders to team members, so Amit does not have to chase.
--
-- Every working morning at 9:00 IST the `team-reminders` edge function emails
-- each team member ONE message listing what of theirs is due today, due
-- tomorrow, or overdue. Overdue work is mentioned on days 1, 3, 7 and 14 after
-- the deadline and then left to Amit: a reminder that arrives every single day
-- stops being read, and by two weeks it is a conversation, not an email.
--
-- Work already sent for review is never reminded about — it is waiting on
-- Amit, not on them.

alter table public.user_secrets
  add column if not exists team_reminders_enabled boolean not null default true;

-- One row per task per reminder per day: what makes a second run on the same
-- morning (a retry, a manual trigger) send nothing twice.
create table public.team_reminders (
  task_id uuid not null references public.tasks(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('due_today','due_tomorrow','overdue')),
  sent_on date not null,
  created_at timestamptz not null default now(),
  primary key (task_id, kind, sent_on)
);
alter table public.team_reminders enable row level security;
create policy "own reminders" on public.team_reminders for select using (owner_id = (select auth.uid()));

-- A reminder shows in the task's conversation, so both sides can see that the
-- nudge went out and when.
alter table public.task_comments drop constraint if exists task_comments_kind_check;
alter table public.task_comments add constraint task_comments_kind_check check (kind in (
  'comment','status_request','review_request','submitted','approved','returned','status','reminder'));

-- The message count on an employee's task counts people talking, not reminders.
create or replace function public.member_tasks() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(x) order by x.done, x.due_at nulls last, x.created_at), '[]'::jsonb) from (
    select t.id, t.title, t.description, t.status, t.priority, t.due_at, t.due_has_time,
           t.created_at, t.updated_at, t.completed_at,
           (t.status in ('done','cancelled')) as done,
           pr.name as project_name,
           coalesce(nullif(op.display_name, ''), 'your manager') as owner_name,
           (select jsonb_build_object('kind', c.kind, 'body', c.body, 'created_at', c.created_at)
              from task_comments c
              where c.task_id = t.id and c.kind in ('status_request','review_request') and c.resolved_at is null
              order by c.created_at desc limit 1) as open_request,
           (select count(*) from task_comments c where c.task_id = t.id and c.kind not in ('status','reminder')) as comment_count
    from tasks t
    join team_members m on m.id = t.assignee_id
    left join projects pr on pr.id = t.project_id
    left join profiles op on op.id = t.user_id
    where m.member_id = auth.uid() and m.removed_at is null
      and t.deleted_at is null and t.review_state = 'accepted'
      and (t.status not in ('done','cancelled') or t.completed_at > now() - interval '14 days')
  ) x;
$$;

-- 03:30 UTC = 09:00 IST, Monday to Saturday.
select cron.schedule('team-reminders-daily', '30 3 * * 1-6', $job$
  select net.http_post(
    url := 'https://gmtjbxblrdhrdrnsbipw.supabase.co/functions/v1/team-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select whatsapp_token from public.user_secrets
                                     where whatsapp_token is not null limit 1)),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$job$);
