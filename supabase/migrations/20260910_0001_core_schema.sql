-- Applied to project iljkjqlwrjkinvloqqgx on 2026-09-10 (via Supabase MCP). Kept here for reference / fresh setups.
create extension if not exists "pgcrypto";

create or replace function public.uuid_v7() returns uuid language plpgsql volatile set search_path = public, extensions, pg_temp as $$
declare
  unix_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000);
  b bytea := gen_random_bytes(10);
begin
  return encode(
    set_byte(set_byte(
      overlay(('\x' || lpad(to_hex(unix_ms), 12, '0'))::bytea placing b from 7 for 10),
      6, (get_byte(b,0) & 15) | 112), 8, (get_byte(b,2) & 63) | 128), 'hex')::uuid;
end $$;

create type task_status as enum ('inbox','todo','in_progress','waiting','done','cancelled');
create type review_state as enum ('suggested','accepted','rejected');
create type source_kind as enum ('manual','gmail','whatsapp','bot','calendar','meeting','other');
create type actor_kind as enum ('user','ai','system');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'Asia/Kolkata',
  eod_time time not null default '23:59',
  work_days int[] not null default '{1,2,3,4,5,6}',
  day_start time not null default '09:00',
  day_end time not null default '21:00',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.projects (
  id uuid primary key default public.uuid_v7(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, description text, color text not null default '#3144C2', icon text,
  status text not null default 'active', sort_order double precision not null default 0,
  parent_id uuid references public.projects(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create table public.people (
  id uuid primary key default public.uuid_v7(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, emails text[] not null default '{}', phones text[] not null default '{}', whatsapp_ids text[] not null default '{}',
  company text, role text, notes text,
  trust_level text not null default 'review', -- review | auto_accept | ignore
  last_contact_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.tags (
  id uuid primary key default public.uuid_v7(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, color text not null default '#566172', created_at timestamptz not null default now(), unique (user_id, name)
);
create table public.custom_field_defs (
  id uuid primary key default public.uuid_v7(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, kind text not null default 'text', options jsonb not null default '[]'::jsonb, sort_order double precision not null default 0, created_at timestamptz not null default now()
);
create table public.tasks (
  id uuid primary key default public.uuid_v7(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, description text,
  status task_status not null default 'todo',
  priority smallint not null default 4 check (priority between 1 and 4),
  due_at timestamptz, due_has_time boolean not null default false, start_at timestamptz, scheduled_at timestamptz, duration_min integer, completed_at timestamptz,
  project_id uuid references public.projects(id) on delete set null,
  parent_id uuid references public.tasks(id) on delete cascade,
  person_id uuid references public.people(id) on delete set null,
  waiting_on_person_id uuid references public.people(id) on delete set null,
  recurrence text, recurrence_anchor timestamptz,
  custom_fields jsonb not null default '{}'::jsonb,
  source_kind source_kind not null default 'manual', source_ref text, source_link text, source_quote text, confidence real,
  review_state review_state not null default 'accepted',
  ai_meta jsonb not null default '{}'::jsonb,
  sort_order double precision not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create index tasks_user_status_idx on public.tasks(user_id, status) where deleted_at is null;
create index tasks_user_due_idx on public.tasks(user_id, due_at) where deleted_at is null;
create index tasks_user_project_idx on public.tasks(user_id, project_id) where deleted_at is null;
create index tasks_user_review_idx on public.tasks(user_id, review_state) where deleted_at is null;
create index tasks_parent_idx on public.tasks(parent_id);
create table public.task_tags (task_id uuid not null references public.tasks(id) on delete cascade, tag_id uuid not null references public.tags(id) on delete cascade, primary key (task_id, tag_id));
create table public.task_events (
  id uuid primary key default public.uuid_v7(), user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade, kind text not null, actor actor_kind not null default 'user',
  changes jsonb not null default '{}'::jsonb, note text, created_at timestamptz not null default now()
);
create index task_events_task_idx on public.task_events(task_id, created_at);
create index task_events_user_time_idx on public.task_events(user_id, created_at);
create table public.saved_views (
  id uuid primary key default public.uuid_v7(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, layout text not null default 'list', filter jsonb not null default '{}'::jsonb, sort jsonb not null default '[]'::jsonb,
  group_by text, icon text, sort_order double precision not null default 0, created_at timestamptz not null default now()
);
create table public.messages (
  id uuid primary key default public.uuid_v7(), user_id uuid not null references auth.users(id) on delete cascade,
  channel source_kind not null, external_id text not null, thread_id text,
  person_id uuid references public.people(id) on delete set null,
  sender_name text, sender_handle text, is_outgoing boolean not null default false, sent_at timestamptz not null,
  subject text, body text, link text, processed_at timestamptz, extraction jsonb, created_at timestamptz not null default now(),
  task_ids uuid[] not null default '{}', skipped_reason text,
  unique (user_id, channel, external_id)
);
create index messages_user_sent_idx on public.messages(user_id, sent_at desc);

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path = public, pg_temp as $$ begin new.updated_at = now(); return new; end $$;
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger projects_updated before update on public.projects for each row execute function public.set_updated_at();
create trigger people_updated before update on public.people for each row execute function public.set_updated_at();
create trigger tasks_updated before update on public.tasks for each row execute function public.set_updated_at();

-- append-only history log (undo, analytics, AI learning)
create or replace function public.log_task_event() returns trigger language plpgsql security definer set search_path = public as $$
declare ch jsonb := '{}'::jsonb; k text; f text;
  tracked text[] := array['title','status','priority','due_at','scheduled_at','duration_min','project_id','person_id','waiting_on_person_id','description','recurrence','parent_id','review_state','deleted_at'];
begin
  if tg_op = 'INSERT' then
    insert into task_events(user_id, task_id, kind, actor, changes) values (new.user_id, new.id, case when new.review_state='suggested' then 'ai_suggested' else 'created' end, case when new.source_kind='manual' then 'user' else 'ai' end, jsonb_build_object('title', new.title, 'status', new.status, 'due_at', new.due_at));
    return new;
  end if;
  foreach f in array tracked loop
    if to_jsonb(old)->f is distinct from to_jsonb(new)->f then ch := ch || jsonb_build_object(f, jsonb_build_object('from', to_jsonb(old)->f, 'to', to_jsonb(new)->f)); end if;
  end loop;
  if ch = '{}'::jsonb then return new; end if;
  k := case when new.status='done' and old.status<>'done' then 'completed' when old.status='done' and new.status<>'done' then 'reopened'
    when new.deleted_at is not null and old.deleted_at is null then 'deleted' when ch ? 'due_at' or ch ? 'scheduled_at' then 'rescheduled'
    when ch ? 'review_state' and new.review_state='accepted' then 'ai_accepted' when ch ? 'review_state' and new.review_state='rejected' then 'ai_rejected' else 'updated' end;
  if new.status='done' and old.status<>'done' and new.completed_at is null then new.completed_at := now(); end if;
  if old.status='done' and new.status<>'done' then new.completed_at := null; end if;
  insert into task_events(user_id, task_id, kind, actor, changes) values (new.user_id, new.id, k, 'user', ch);
  return new;
end $$;
create trigger tasks_log before update on public.tasks for each row execute function public.log_task_event();
create trigger tasks_log_insert after insert on public.tasks for each row execute function public.log_task_event();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)));
  insert into public.projects(user_id, name, color, icon) values (new.id, 'Inbox', '#566172', 'inbox');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
revoke execute on function public.handle_new_user() from anon, authenticated, public;
grant execute on function public.handle_new_user() to supabase_auth_admin;
revoke execute on function public.log_task_event() from anon, public;
grant execute on function public.log_task_event() to authenticated, service_role;
grant execute on function public.uuid_v7() to supabase_auth_admin, authenticated, service_role;
grant execute on function public.set_updated_at() to authenticated, service_role, supabase_auth_admin;

alter table public.profiles enable row level security; alter table public.projects enable row level security; alter table public.people enable row level security;
alter table public.tags enable row level security; alter table public.custom_field_defs enable row level security; alter table public.tasks enable row level security;
alter table public.task_tags enable row level security; alter table public.task_events enable row level security; alter table public.saved_views enable row level security; alter table public.messages enable row level security;
create policy "own profile" on public.profiles for all using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "own projects" on public.projects for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own people" on public.people for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own tags" on public.tags for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own field defs" on public.custom_field_defs for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own tasks" on public.tasks for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own task_tags" on public.task_tags for all using (exists (select 1 from public.tasks t where t.id = task_id and t.user_id = (select auth.uid()))) with check (exists (select 1 from public.tasks t where t.id = task_id and t.user_id = (select auth.uid())));
create policy "own events" on public.task_events for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own views" on public.saved_views for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own messages" on public.messages for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter publication supabase_realtime add table public.tasks, public.projects, public.people, public.tags, public.task_tags;
