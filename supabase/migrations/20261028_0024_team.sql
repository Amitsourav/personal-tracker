-- Team: Amit can add employees, assign them his tasks, ask them for an update or
-- a review, and they can send finished work back to him for approval.
--
-- The privacy line this has to hold: an employee sees ONLY the tasks assigned to
-- them, and only the fields a colleague needs (title, notes, dates, status,
-- project name, the conversation). Never the source quote, the email or WhatsApp
-- message behind it, AI metadata, people, signals, or anything else of Amit's.
--
-- So employees get NO new row-level policy on `tasks`. Every read and write they
-- make goes through the security-definer functions below, which return a fixed
-- set of columns and accept a fixed set of actions. A policy on `tasks` would
-- hand them every column of the row, and Postgres cannot hide columns per policy.
--
-- Amit's own access is unchanged: he owns the rows, his existing policies apply.

-- A colleague can say "this is ready for you to look at" without being allowed
-- to call it done. Done stays Amit's word.
alter type public.task_status add value if not exists 'in_review' after 'waiting';

create table public.team_members (
  id uuid primary key default public.uuid_v7(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  -- Filled the first time they sign in with the invited email. Until then the
  -- invite exists and work can already be assigned to it.
  member_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text not null check (email = lower(email) and email like '%@%'),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  -- Soft remove: their past comments keep a name, their access stops at once.
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, email)
);
create index team_members_member_idx on public.team_members(member_id) where removed_at is null;
alter table public.team_members enable row level security;
create policy "own team" on public.team_members for all
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

alter table public.tasks
  add column if not exists assignee_id uuid references public.team_members(id) on delete set null;
create index if not exists tasks_assignee_idx on public.tasks(assignee_id) where deleted_at is null;

-- The conversation on a task between Amit and whoever it is assigned to.
-- `kind` records what a message was for, so requests can be shown as open
-- until answered rather than scrolling away as one more comment.
create table public.task_comments (
  id uuid primary key default public.uuid_v7(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,   -- the task's owner, for RLS
  author_id uuid references auth.users(id) on delete set null,
  kind text not null default 'comment' check (kind in (
    'comment',
    'status_request',  -- Amit: "where is this?"
    'review_request',  -- Amit: "please look this over and tell me what you think"
    'submitted',       -- employee: "done from my side, please review"
    'approved',        -- Amit accepted the submitted work
    'returned',        -- Amit sent it back with a note
    'status'           -- employee moved the status (a record, not a message)
  )),
  body text,
  -- For the two request kinds: when the employee answered.
  resolved_at timestamptz,
  -- For messages from the employee: when Amit saw them.
  seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index task_comments_task_idx on public.task_comments(task_id, created_at);
create index task_comments_owner_unseen_idx on public.task_comments(owner_id) where seen_at is null;
alter table public.task_comments enable row level security;
-- Amit reads and writes the conversation on his own tasks. Employees have no
-- policy here; they use the functions below.
create policy "own task comments" on public.task_comments for all
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.tasks t where t.id = task_id and t.user_id = (select auth.uid()))
  );
alter publication supabase_realtime add table public.task_comments;

-- ---------- functions employees call ----------

-- Called on every sign-in. Links any invite sent to this person's (verified)
-- email to their account. An owner can never claim their own invite, so adding
-- your own address by mistake cannot lock you into the employee screen.
create or replace function public.claim_team_invites() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my_email text := lower(auth.jwt() ->> 'email');
begin
  if me is null then return '[]'::jsonb; end if;
  update team_members set member_id = me, joined_at = coalesce(joined_at, now())
    where email = my_email and member_id is null and removed_at is null and owner_id <> me;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'member_id', m.id, 'owner_id', m.owner_id, 'name', m.name,
      'owner_name', coalesce(nullif(p.display_name, ''), 'your manager')))
    from team_members m left join profiles p on p.id = m.owner_id
    where m.member_id = me and m.removed_at is null and m.owner_id <> me
  ), '[]'::jsonb);
end $$;

-- The employee's list. Only these columns ever leave the database.
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
           (select count(*) from task_comments c where c.task_id = t.id and c.kind <> 'status') as comment_count
    from tasks t
    join team_members m on m.id = t.assignee_id
    left join projects pr on pr.id = t.project_id
    left join profiles op on op.id = t.user_id
    where m.member_id = auth.uid() and m.removed_at is null
      and t.deleted_at is null and t.review_state = 'accepted'
      and (t.status not in ('done','cancelled') or t.completed_at > now() - interval '14 days')
  ) x;
$$;

create or replace function public.is_my_assigned_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tasks t join team_members m on m.id = t.assignee_id
    where t.id = p_task and m.member_id = auth.uid() and m.removed_at is null and t.deleted_at is null);
$$;

create or replace function public.member_comments(p_task uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_my_assigned_task(p_task) then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'kind', c.kind, 'body', c.body, 'created_at', c.created_at,
      'mine', c.author_id = auth.uid(),
      'author', case when c.author_id = c.owner_id then coalesce(nullif(p.display_name, ''), 'Manager')
                     else coalesce(m.name, 'Team member') end
    ) order by c.created_at)
    from task_comments c
    left join profiles p on p.id = c.owner_id
    left join team_members m on m.member_id = c.author_id and m.owner_id = c.owner_id
    where c.task_id = p_task), '[]'::jsonb) end;
$$;

-- Everything an employee can do to a task, in one place so the rules are in one
-- place: comment, move between working statuses, or submit for review. Never
-- complete, delete, re-date or edit the title — those stay Amit's.
create or replace function public.member_act(p_task uuid, p_action text, p_body text default null, p_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tasks; body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if not public.is_my_assigned_task(p_task) then raise exception 'not your task'; end if;
  select * into t from tasks where id = p_task;
  if t.status in ('done','cancelled') then raise exception 'this task is closed'; end if;

  if p_action = 'comment' then
    if body is null then raise exception 'empty comment'; end if;
    insert into task_comments(task_id, owner_id, author_id, kind, body) values (p_task, t.user_id, auth.uid(), 'comment', left(body, 4000));
  elsif p_action = 'status' then
    if p_status is null or p_status not in ('todo','in_progress','waiting') then raise exception 'not allowed'; end if;
    if p_status <> t.status::text then
      update tasks set status = p_status::task_status where id = p_task;
      insert into task_comments(task_id, owner_id, author_id, kind, body) values (p_task, t.user_id, auth.uid(), 'status', p_status);
    end if;
    if body is not null then
      insert into task_comments(task_id, owner_id, author_id, kind, body) values (p_task, t.user_id, auth.uid(), 'comment', left(body, 4000));
    end if;
  elsif p_action = 'submit' then
    update tasks set status = 'in_review' where id = p_task;
    insert into task_comments(task_id, owner_id, author_id, kind, body) values (p_task, t.user_id, auth.uid(), 'submitted', left(body, 4000));
  else
    raise exception 'unknown action';
  end if;

  -- Any reply answers whatever Amit was waiting on.
  if p_action = 'submit' or body is not null then
    update task_comments set resolved_at = now()
      where task_id = p_task and kind in ('status_request','review_request') and resolved_at is null;
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.claim_team_invites(), public.member_tasks(), public.is_my_assigned_task(uuid),
  public.member_comments(uuid), public.member_act(uuid, text, text, text) from public, anon;
grant execute on function public.claim_team_invites(), public.member_tasks(), public.is_my_assigned_task(uuid),
  public.member_comments(uuid), public.member_act(uuid, text, text, text) to authenticated;
