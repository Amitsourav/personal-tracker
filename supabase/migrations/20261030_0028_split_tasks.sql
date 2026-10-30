-- One piece of work, several people: split a task into one part per person.
--
-- Each part is a sub-task of the original (tasks.parent_id), assigned to one
-- person, carrying the original's notes, due date and priority. The original
-- stays with whoever split it and shows progress ("2 of 3 done"). Each part is
-- reviewed on its own, through the same chain as any other task — so parts
-- split by a lead go person → lead → Amit.
--
-- Amit splits from his own app (plain inserts under his existing policies).
-- A lead splits through lead_split(), with the same permission as handing a
-- task on: only work they are responsible for.

create or replace function public.lead_split(p_task uuid, p_members uuid[], p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare t tasks; me team_members; target team_members; n int := 0; new_id uuid; names text[] := '{}';
  note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into t from tasks where id = p_task and deleted_at is null;
  if t.id is null then raise exception 'task not found'; end if;
  me := public.require_lead(t.user_id);
  if not ((t.assignee_id = me.id and t.lead_id is null) or t.lead_id = me.id) then
    raise exception 'you can only split work you are responsible for';
  end if;
  if t.status in ('done','cancelled') then raise exception 'this task is closed'; end if;
  if t.parent_id is not null then raise exception 'this is already a part of a bigger task'; end if;
  if coalesce(array_length(p_members, 1), 0) < 2 then raise exception 'choose at least two people'; end if;

  for target in select * from team_members where id = any(p_members) and owner_id = t.user_id and removed_at is null order by name loop
    insert into tasks(user_id, parent_id, title, description, due_at, due_has_time, priority, project_id, status,
                      assignee_id, lead_id, created_by_member, source_kind, review_state, sort_order)
      values (t.user_id, t.id, left(t.title || ' — ' || target.name, 500), t.description, t.due_at, t.due_has_time, t.priority,
              t.project_id, 'todo', target.id, case when target.id = me.id then null else me.id end, me.id, 'manual', 'accepted', n)
      returning id into new_id;
    insert into task_comments(task_id, owner_id, author_id, kind, body) values (new_id, t.user_id, auth.uid(), 'created', target.name);
    if note is not null then
      insert into task_comments(task_id, owner_id, author_id, kind, body) values (new_id, t.user_id, auth.uid(), 'comment', left(note, 4000));
    end if;
    if target.id <> me.id then
      insert into team_outbox(owner_id, kind, to_member, task_id, actor_name, note) values (t.user_id, 'assigned', target.id, new_id, me.name, note);
    end if;
    names := names || target.name;
    n := n + 1;
  end loop;
  if n < 2 then raise exception 'choose at least two people on the team'; end if;
  insert into task_comments(task_id, owner_id, author_id, kind, body)
    values (p_task, t.user_id, auth.uid(), 'delegated', array_to_string(names, ', ') || ' (split into ' || n || ' parts)');
  return n;
end $$;
revoke execute on function public.lead_split(uuid, uuid[], text) from public, anon;
grant execute on function public.lead_split(uuid, uuid[], text) to authenticated;

-- The person doing a task sees how far its parts have got, and a part shows
-- which bigger task it belongs to.
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
           (select count(*) from tasks s where s.parent_id = t.id and s.deleted_at is null) as parts_total,
           (select count(*) from tasks s where s.parent_id = t.id and s.deleted_at is null and s.status = 'done') as parts_done,
           pt.title as parent_title,
           (select jsonb_build_object('kind', c.kind, 'body', c.body, 'created_at', c.created_at)
              from task_comments c
              where c.task_id = t.id and c.kind in ('status_request','review_request') and c.resolved_at is null
              order by c.created_at desc limit 1) as open_request,
           (select count(*) from task_comments c where c.task_id = t.id and c.kind not in ('status','reminder')) as comment_count
    from tasks t
    join team_members m on m.id = t.assignee_id
    left join team_members lm on lm.id = t.lead_id
    left join tasks pt on pt.id = t.parent_id
    left join projects pr on pr.id = t.project_id
    left join profiles op on op.id = t.user_id
    where m.member_id = auth.uid() and m.removed_at is null
      and t.deleted_at is null and t.review_state = 'accepted'
      and (t.status not in ('done','cancelled') or t.completed_at > now() - interval '14 days')
  ) x;
$$;
