-- Leads: people Amit trusts to hand work on.
--
-- Amit marks a team member as a lead. A lead can:
--   * pass a task Amit gave them to anyone on the team, and move it between
--     people afterwards (they stay responsible for it: tasks.lead_id)
--   * create new tasks for the team
--   * invite new people to the team
--   * see everything they have handed out, and review it
--
-- Review runs up the chain: when the person a lead handed work to sends it for
-- review, it goes to the lead first (review_stage = 'lead'). The lead approves
-- it on to Amit (review_stage = 'owner') or sends it back. Amit can approve at
-- any stage; he is never locked out of his own task.
--
-- A task is handed on at most once: a lead can move work they are responsible
-- for, but cannot re-delegate a task someone else is already leading. Chains
-- longer than Amit → lead → person are where accountability goes to die.
--
-- Emails triggered by a lead or a team member cannot be sent from their own
-- session — only Amit's rows hold his Google token, and they must never be
-- readable by anyone else. So the functions below queue them in team_outbox,
-- and the `team-notify` edge function (service role) sends them from his
-- Gmail: immediately when the app pokes it, and every five minutes regardless.

alter table public.team_members
  add column if not exists is_lead boolean not null default false,
  add column if not exists invited_by uuid references public.team_members(id) on delete set null;

alter table public.tasks
  add column if not exists lead_id uuid references public.team_members(id) on delete set null,
  add column if not exists review_stage text check (review_stage in ('lead','owner')),
  add column if not exists created_by_member uuid references public.team_members(id) on delete set null;

alter table public.task_comments drop constraint if exists task_comments_kind_check;
alter table public.task_comments add constraint task_comments_kind_check check (kind in (
  'comment','status_request','review_request','submitted','approved','returned','status','reminder','attachment',
  'delegated',      -- a lead handed it on; body = who to
  'lead_approved',  -- a lead approved the work and sent it up to Amit
  'created'         -- a lead created the task
));

create table public.team_outbox (
  id uuid primary key default public.uuid_v7(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('invite','assigned','status_request','returned','submitted_to_lead')),
  to_member uuid not null references public.team_members(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  actor_name text not null,
  note text,
  attempts int not null default 0,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index team_outbox_pending_idx on public.team_outbox(created_at) where sent_at is null;
alter table public.team_outbox enable row level security;
create policy "own outbox" on public.team_outbox for select using (owner_id = (select auth.uid()));

-- ---------- helpers ----------

-- The caller's membership on a given owner's team, if any.
create or replace function public.my_member(p_owner uuid) returns public.team_members
language sql stable security definer set search_path = public as $$
  select * from team_members where owner_id = p_owner and member_id = auth.uid() and removed_at is null limit 1;
$$;

-- Assignee OR the lead responsible for it.
create or replace function public.is_my_assigned_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tasks t join team_members m on m.id in (t.assignee_id, t.lead_id)
    where t.id = p_task and m.member_id = auth.uid() and m.removed_at is null and t.deleted_at is null);
$$;

create or replace function public.assigned_task_owner(p_task uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select t.user_id from tasks t
  where t.id = p_task and t.deleted_at is null and public.is_my_assigned_task(p_task);
$$;

create or replace function public.member_display(p_member uuid) returns text
language sql stable security definer set search_path = public as $$
  select name from team_members where id = p_member;
$$;

-- ---------- what a team member sees ----------

create or replace function public.claim_team_invites() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my_email text := lower(auth.jwt() ->> 'email');
begin
  if me is null then return '[]'::jsonb; end if;
  update team_members set member_id = me, joined_at = coalesce(joined_at, now())
    where email = my_email and member_id is null and removed_at is null and owner_id <> me;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'member_id', m.id, 'owner_id', m.owner_id, 'name', m.name, 'is_lead', m.is_lead,
      'owner_name', coalesce(nullif(p.display_name, ''), 'your manager')))
    from team_members m left join profiles p on p.id = m.owner_id
    where m.member_id = me and m.removed_at is null and m.owner_id <> me
  ), '[]'::jsonb);
end $$;

-- Tasks the caller is doing (assignee). Same columns as before, plus who
-- handed it to them and whether they may hand it on.
create or replace function public.member_tasks() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(x) order by x.done, x.due_at nulls last, x.created_at), '[]'::jsonb) from (
    select t.id, t.title, t.description, t.status, t.priority, t.due_at, t.due_has_time,
           t.created_at, t.updated_at, t.completed_at, t.review_stage,
           (t.status in ('done','cancelled')) as done,
           pr.name as project_name,
           coalesce(nullif(op.display_name, ''), 'your manager') as owner_name,
           lm.name as lead_name,
           (m.is_lead and t.lead_id is null) as can_delegate,
           (select jsonb_build_object('kind', c.kind, 'body', c.body, 'created_at', c.created_at)
              from task_comments c
              where c.task_id = t.id and c.kind in ('status_request','review_request') and c.resolved_at is null
              order by c.created_at desc limit 1) as open_request,
           (select count(*) from task_comments c where c.task_id = t.id and c.kind not in ('status','reminder')) as comment_count
    from tasks t
    join team_members m on m.id = t.assignee_id
    left join team_members lm on lm.id = t.lead_id
    left join projects pr on pr.id = t.project_id
    left join profiles op on op.id = t.user_id
    where m.member_id = auth.uid() and m.removed_at is null
      and t.deleted_at is null and t.review_state = 'accepted'
      and (t.status not in ('done','cancelled') or t.completed_at > now() - interval '14 days')
  ) x;
$$;

-- A lead's view of what they handed out (and created for others).
create or replace function public.lead_tasks() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(x) order by x.done, x.needs_me desc, x.due_at nulls last, x.created_at), '[]'::jsonb) from (
    select t.id, t.title, t.description, t.status, t.priority, t.due_at, t.due_has_time,
           t.created_at, t.updated_at, t.completed_at, t.review_stage,
           (t.status in ('done','cancelled')) as done,
           (t.status = 'in_review' and t.review_stage = 'lead') as needs_me,
           a.id as assignee_id, a.name as assignee_name,
           coalesce(nullif(op.display_name, ''), 'your manager') as owner_name,
           (select jsonb_build_object('kind', c.kind, 'body', c.body, 'created_at', c.created_at, 'by_me', c.author_id = auth.uid())
              from task_comments c where c.task_id = t.id and c.kind not in ('status','reminder')
              order by c.created_at desc limit 1) as last_comment
    from tasks t
    join team_members l on l.id = t.lead_id
    left join team_members a on a.id = t.assignee_id
    left join profiles op on op.id = t.user_id
    where l.member_id = auth.uid() and l.removed_at is null and l.is_lead
      and t.deleted_at is null and t.review_state = 'accepted'
      and (t.status not in ('done','cancelled') or t.completed_at > now() - interval '14 days')
  ) x;
$$;

-- Who a lead can hand work to: everyone on the team.
create or replace function public.lead_team() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'is_lead', o.is_lead, 'joined', o.member_id is not null, 'me', o.member_id = auth.uid()) order by o.name), '[]'::jsonb)
  from team_members l join team_members o on o.owner_id = l.owner_id and o.removed_at is null
  where l.member_id = auth.uid() and l.removed_at is null and l.is_lead;
$$;

-- ---------- what a team member does ----------

create or replace function public.member_act(p_task uuid, p_action text, p_body text default null, p_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tasks; me team_members; body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if not public.is_my_assigned_task(p_task) then raise exception 'not your task'; end if;
  select * into t from tasks where id = p_task;
  me := public.my_member(t.user_id);
  if t.status in ('done','cancelled') then raise exception 'this task is closed'; end if;
  -- Moving and submitting are the doer's; the lead uses lead_act.
  if p_action in ('status','submit') and t.assignee_id is distinct from me.id then raise exception 'only the person doing it can do that'; end if;

  if p_action = 'comment' then
    if body is null then raise exception 'empty comment'; end if;
    insert into task_comments(task_id, owner_id, author_id, kind, body) values (p_task, t.user_id, auth.uid(), 'comment', left(body, 4000));
  elsif p_action = 'status' then
    if p_status is null or p_status not in ('todo','in_progress','waiting') then raise exception 'not allowed'; end if;
    if p_status <> t.status::text then
      update tasks set status = p_status::task_status, review_stage = null where id = p_task;
      insert into task_comments(task_id, owner_id, author_id, kind, body) values (p_task, t.user_id, auth.uid(), 'status', p_status);
    end if;
    if body is not null then
      insert into task_comments(task_id, owner_id, author_id, kind, body) values (p_task, t.user_id, auth.uid(), 'comment', left(body, 4000));
    end if;
  elsif p_action = 'submit' then
    -- Up the chain: to the lead who handed it over, else straight to Amit.
    if t.lead_id is not null and t.lead_id <> me.id then
      update tasks set status = 'in_review', review_stage = 'lead' where id = p_task;
      insert into team_outbox(owner_id, kind, to_member, task_id, actor_name, note)
        values (t.user_id, 'submitted_to_lead', t.lead_id, p_task, me.name, body);
    else
      update tasks set status = 'in_review', review_stage = 'owner' where id = p_task;
    end if;
    insert into task_comments(task_id, owner_id, author_id, kind, body) values (p_task, t.user_id, auth.uid(), 'submitted', left(body, 4000));
  else
    raise exception 'unknown action';
  end if;

  if p_action = 'submit' or body is not null then
    update task_comments set resolved_at = now()
      where task_id = p_task and kind in ('status_request','review_request') and resolved_at is null
        and author_id is distinct from auth.uid();
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- The caller as a lead on this task's owner's team, or an exception.
create or replace function public.require_lead(p_owner uuid) returns public.team_members
language plpgsql stable security definer set search_path = public as $$
declare me team_members := public.my_member(p_owner);
begin
  if me.id is null or not me.is_lead then raise exception 'only a lead can do that'; end if;
  return me;
end $$;

-- Hand a task on, move it between people, or take it back.
create or replace function public.lead_assign(p_task uuid, p_to uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tasks; me team_members; target team_members; note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into t from tasks where id = p_task and deleted_at is null;
  if t.id is null then raise exception 'task not found'; end if;
  me := public.require_lead(t.user_id);
  if not ((t.assignee_id = me.id and t.lead_id is null) or t.lead_id = me.id) then
    raise exception 'you can only hand on work you are responsible for';
  end if;
  if t.status in ('done','cancelled') then raise exception 'this task is closed'; end if;
  select * into target from team_members where id = p_to and owner_id = t.user_id and removed_at is null;
  if target.id is null then raise exception 'not on the team'; end if;
  if target.id = t.assignee_id then return jsonb_build_object('ok', true); end if;

  update tasks set
    assignee_id = target.id,
    lead_id = case when target.id = me.id then null else me.id end,
    status = case when status = 'in_review' then 'todo'::task_status else status end,
    review_stage = null
  where id = p_task;
  insert into task_comments(task_id, owner_id, author_id, kind, body)
    values (p_task, t.user_id, auth.uid(), 'delegated', case when target.id = me.id then 'themselves' else target.name end);
  if note is not null then
    insert into task_comments(task_id, owner_id, author_id, kind, body) values (p_task, t.user_id, auth.uid(), 'comment', left(note, 4000));
  end if;
  if target.id <> me.id then
    insert into team_outbox(owner_id, kind, to_member, task_id, actor_name, note) values (t.user_id, 'assigned', target.id, p_task, me.name, note);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- What a lead does on work they handed out.
create or replace function public.lead_act(p_task uuid, p_action text, p_body text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tasks; me team_members; body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  select * into t from tasks where id = p_task and deleted_at is null;
  if t.id is null then raise exception 'task not found'; end if;
  me := public.require_lead(t.user_id);
  if t.lead_id is distinct from me.id then raise exception 'not a task you handed out'; end if;
  if t.status in ('done','cancelled') then raise exception 'this task is closed'; end if;

  if p_action = 'status_request' then
    insert into task_comments(task_id, owner_id, author_id, kind, body) values (p_task, t.user_id, auth.uid(), 'status_request', left(body, 4000));
    insert into team_outbox(owner_id, kind, to_member, task_id, actor_name, note) values (t.user_id, 'status_request', t.assignee_id, p_task, me.name, body);
  elsif p_action = 'approve' then
    if not (t.status = 'in_review' and t.review_stage = 'lead') then raise exception 'nothing waiting for your review'; end if;
    update tasks set review_stage = 'owner' where id = p_task;
    insert into task_comments(task_id, owner_id, author_id, kind, body) values (p_task, t.user_id, auth.uid(), 'lead_approved', left(body, 4000));
  elsif p_action = 'return' then
    if body is null then raise exception 'say what needs changing'; end if;
    update tasks set status = 'in_progress', review_stage = null where id = p_task;
    insert into task_comments(task_id, owner_id, author_id, kind, body) values (p_task, t.user_id, auth.uid(), 'returned', left(body, 4000));
    insert into team_outbox(owner_id, kind, to_member, task_id, actor_name, note) values (t.user_id, 'returned', t.assignee_id, p_task, me.name, body);
  else
    raise exception 'unknown action';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- A new task from a lead. It lands in Amit's tracker like any other — he
-- sees everything his team creates — marked as created by the lead.
create or replace function public.lead_create_task(p_owner uuid, p_title text, p_description text default null,
  p_due timestamptz default null, p_priority int default 4, p_to uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me team_members := public.require_lead(p_owner); target team_members; new_id uuid;
begin
  if nullif(btrim(coalesce(p_title, '')), '') is null then raise exception 'a task needs a title'; end if;
  if p_to is not null then
    select * into target from team_members where id = p_to and owner_id = p_owner and removed_at is null;
    if target.id is null then raise exception 'not on the team'; end if;
  else
    target := me;
  end if;
  insert into tasks(user_id, title, description, due_at, priority, status, assignee_id, lead_id, created_by_member, source_kind, review_state)
    values (p_owner, left(btrim(p_title), 500), nullif(btrim(coalesce(p_description, '')), ''), p_due,
            greatest(1, least(4, coalesce(p_priority, 4))), 'todo', target.id,
            case when target.id = me.id then null else me.id end, me.id, 'manual', 'accepted')
    returning id into new_id;
  insert into task_comments(task_id, owner_id, author_id, kind, body) values (new_id, p_owner, auth.uid(), 'created', target.name);
  if target.id <> me.id then
    insert into team_outbox(owner_id, kind, to_member, task_id, actor_name) values (p_owner, 'assigned', target.id, new_id, me.name);
  end if;
  return new_id;
end $$;

create or replace function public.lead_invite(p_owner uuid, p_name text, p_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare me team_members := public.require_lead(p_owner); new_id uuid; em text := lower(btrim(coalesce(p_email, '')));
begin
  if nullif(btrim(coalesce(p_name, '')), '') is null or em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'add a name and a valid email'; end if;
  if exists (select 1 from team_members where owner_id = p_owner and email = em) then raise exception 'that email is already on the team'; end if;
  if exists (select 1 from auth.users where id = p_owner and lower(email) = em) then raise exception 'that is the owner''s own email'; end if;
  insert into team_members(owner_id, name, email, invited_by) values (p_owner, left(btrim(p_name), 120), em, me.id) returning id into new_id;
  insert into team_outbox(owner_id, kind, to_member, actor_name) values (p_owner, 'invite', new_id, me.name);
  return new_id;
end $$;

revoke execute on function public.my_member(uuid), public.member_display(uuid), public.lead_tasks(), public.lead_team(),
  public.require_lead(uuid), public.lead_assign(uuid, uuid, text), public.lead_act(uuid, text, text),
  public.lead_create_task(uuid, text, text, timestamptz, int, uuid), public.lead_invite(uuid, text, text) from public, anon;
grant execute on function public.lead_tasks(), public.lead_team(), public.lead_assign(uuid, uuid, text), public.lead_act(uuid, text, text),
  public.lead_create_task(uuid, text, text, timestamptz, int, uuid), public.lead_invite(uuid, text, text) to authenticated;
-- my_member / require_lead / member_display are internal helpers, called only from the functions above.

-- Safety net for the outbox: the app pokes team-notify straight away; this
-- catches anything a closed tab left behind.
select cron.schedule('team-notify-every-5-min', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://gmtjbxblrdhrdrnsbipw.supabase.co/functions/v1/team-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select whatsapp_token from public.user_secrets
                                     where whatsapp_token is not null limit 1)),
    body := '{}'::jsonb, timeout_milliseconds := 60000)
  where exists (select 1 from public.team_outbox where sent_at is null and attempts < 3);
$job$);
