-- Files and links on tasks: a screenshot of the bug, the PDF that was asked
-- for, the Drive folder where the work lives.
--
-- Files go in a PRIVATE storage bucket, stored at
--   <owner id>/<task id>/<random>-<file name>
-- so the path itself says whose task it belongs to, and the storage rules can
-- check access from the path alone. Amit can reach everything under his own id.
-- A team member can read and add files only under a task currently assigned to
-- them; remove them from the task (or the team) and access ends at once.
--
-- As with tasks and comments, employees get no policy on the table itself —
-- they go through member_attachments / member_attach / member_detach.

insert into storage.buckets (id, name, public, file_size_limit)
values ('task-files', 'task-files', false, 26214400)   -- 25 MB
on conflict (id) do nothing;

create table public.task_attachments (
  id uuid primary key default public.uuid_v7(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('file','link')),
  name text not null,
  path text,          -- storage path, for files
  url text,           -- for links
  size_bytes bigint,
  mime text,
  created_at timestamptz not null default now(),
  check ((kind = 'file' and path is not null) or (kind = 'link' and url ~* '^https?://'))
);
create index task_attachments_task_idx on public.task_attachments(task_id, created_at);
alter table public.task_attachments enable row level security;
create policy "own task attachments" on public.task_attachments for all
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.tasks t where t.id = task_id and t.user_id = (select auth.uid()))
  );

-- "Ravi attached report.pdf" in the conversation, so it is noticed.
alter table public.task_comments drop constraint if exists task_comments_kind_check;
alter table public.task_comments add constraint task_comments_kind_check check (kind in (
  'comment','status_request','review_request','submitted','approved','returned','status','reminder','attachment'));

-- The owner of a task assigned to the caller, or null. What the storage rules
-- use to check a team member's path.
create or replace function public.assigned_task_owner(p_task uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select t.user_id from tasks t join team_members m on m.id = t.assignee_id
  where t.id = p_task and m.member_id = auth.uid() and m.removed_at is null and t.deleted_at is null;
$$;

-- A path segment that is not a uuid must fail the check, not raise an error.
create or replace function public.try_uuid(p text) returns uuid
language plpgsql immutable as $$
begin return p::uuid; exception when others then return null; end $$;

create policy "task files: owner" on storage.objects for all to authenticated
  using (bucket_id = 'task-files' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'task-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "task files: assignee reads" on storage.objects for select to authenticated
  using (bucket_id = 'task-files'
    and public.assigned_task_owner(public.try_uuid((storage.foldername(name))[2]))::text = (storage.foldername(name))[1]);
create policy "task files: assignee adds" on storage.objects for insert to authenticated
  with check (bucket_id = 'task-files'
    and public.assigned_task_owner(public.try_uuid((storage.foldername(name))[2]))::text = (storage.foldername(name))[1]);

create or replace function public.member_attachments(p_task uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.assigned_task_owner(p_task) is null then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'kind', a.kind, 'name', a.name, 'path', a.path, 'url', a.url,
      'size_bytes', a.size_bytes, 'mime', a.mime, 'created_at', a.created_at,
      'mine', a.uploaded_by = auth.uid()) order by a.created_at)
    from task_attachments a where a.task_id = p_task), '[]'::jsonb) end;
$$;

create or replace function public.member_attach(p_task uuid, p_kind text, p_name text, p_path text default null,
  p_url text default null, p_size bigint default null, p_mime text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare owner uuid := public.assigned_task_owner(p_task); new_id uuid;
begin
  if owner is null then raise exception 'not your task'; end if;
  -- A file row may only point at a file under this task's own folder.
  if p_kind = 'file' and (p_path is null or p_path not like owner::text || '/' || p_task::text || '/%') then
    raise exception 'bad file path';
  end if;
  insert into task_attachments(task_id, owner_id, uploaded_by, kind, name, path, url, size_bytes, mime)
    values (p_task, owner, auth.uid(), p_kind, left(p_name, 300), p_path, p_url, p_size, left(p_mime, 120))
    returning id into new_id;
  insert into task_comments(task_id, owner_id, author_id, kind, body)
    values (p_task, owner, auth.uid(), 'attachment', left(p_name, 300));
  return new_id;
end $$;

-- Team members can take back only what they added themselves. The file itself
-- stays in Amit's folder (Supabase refuses deletes from storage tables in SQL,
-- and a team member deleting files from his storage is not a power they need);
-- with its row gone nothing links to it.
create or replace function public.member_detach(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a task_attachments;
begin
  select * into a from task_attachments where id = p_id;
  if a.id is null or a.uploaded_by is distinct from auth.uid() or public.assigned_task_owner(a.task_id) is null then
    raise exception 'not allowed';
  end if;
  delete from task_attachments where id = p_id;
end $$;

revoke execute on function public.assigned_task_owner(uuid), public.member_attachments(uuid),
  public.member_attach(uuid, text, text, text, text, bigint, text), public.member_detach(uuid) from public, anon;
grant execute on function public.assigned_task_owner(uuid), public.member_attachments(uuid),
  public.member_attach(uuid, text, text, text, text, bigint, text), public.member_detach(uuid) to authenticated;
