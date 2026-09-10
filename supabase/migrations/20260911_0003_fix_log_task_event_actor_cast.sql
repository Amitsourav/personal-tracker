-- log_task_event() failed on every INSERT with:
--   42804 column "actor" is of type actor_kind but expression is of type text
-- A CASE expression is typed `text`, and Postgres will not implicitly coerce it to
-- the actor_kind enum (a bare literal would have been coerced, a CASE result is not).
-- Every task insert was rejected, so nothing could ever reach the Review inbox.
-- Fix: cast the CASE result explicitly. Body is otherwise unchanged.
create or replace function public.log_task_event()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  ch jsonb := '{}'::jsonb;
  k text;
  f text;
  tracked text[] := array['title','status','priority','due_at','scheduled_at','duration_min','project_id','person_id','waiting_on_person_id','description','recurrence','parent_id','review_state','deleted_at'];
begin
  if tg_op = 'INSERT' then
    insert into task_events(user_id, task_id, kind, actor, changes)
      values (new.user_id, new.id, case when new.review_state='suggested' then 'ai_suggested' else 'created' end,
              (case when new.source_kind='manual' then 'user' else 'ai' end)::actor_kind,
              jsonb_build_object('title', new.title, 'status', new.status, 'due_at', new.due_at));
    return new;
  end if;
  foreach f in array tracked loop
    if to_jsonb(old)->f is distinct from to_jsonb(new)->f then
      ch := ch || jsonb_build_object(f, jsonb_build_object('from', to_jsonb(old)->f, 'to', to_jsonb(new)->f));
    end if;
  end loop;
  if ch = '{}'::jsonb then return new; end if;
  k := case
    when new.status='done' and old.status<>'done' then 'completed'
    when old.status='done' and new.status<>'done' then 'reopened'
    when new.deleted_at is not null and old.deleted_at is null then 'deleted'
    when ch ? 'due_at' or ch ? 'scheduled_at' then 'rescheduled'
    when ch ? 'review_state' and new.review_state='accepted' then 'ai_accepted'
    when ch ? 'review_state' and new.review_state='rejected' then 'ai_rejected'
    else 'updated' end;
  if new.status='done' and old.status<>'done' and new.completed_at is null then new.completed_at := now(); end if;
  if old.status='done' and new.status<>'done' then new.completed_at := null; end if;
  insert into task_events(user_id, task_id, kind, actor, changes) values (new.user_id, new.id, k, 'user', ch);
  return new;
end $function$;
