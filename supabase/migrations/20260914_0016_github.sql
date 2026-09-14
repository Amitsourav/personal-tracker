-- GitHub: so a task can say where in the code to start.
--
-- Amit writes the code himself, so the expensive part of his day is not doing
-- the work — it is working out where the work lives, across four projects, from
-- a sentence someone typed into WhatsApp. This holds enough of each repository
-- to answer that.
alter table public.user_secrets
  add column if not exists github_token text,
  add column if not exists github_login text;

create table if not exists public.github_repos (
  id uuid primary key default public.uuid_v7(),
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,                    -- "Amitsourav/personal-tracker"
  default_branch text not null default 'main',
  description text,
  language text,
  private boolean not null default true,
  -- Off by default: connecting an account should not silently start reading
  -- every repository someone has ever forked.
  enabled boolean not null default false,
  pushed_at timestamptz,
  -- The file list, paths only. Enough for a model to reason about structure
  -- without shipping the source anywhere, and small enough to keep in a row.
  paths jsonb,
  path_count int,
  readme text,
  indexed_at timestamptz,
  index_error text,
  created_at timestamptz not null default now(),
  unique (user_id, full_name)
);
alter table public.github_repos enable row level security;
create policy "own github repos" on public.github_repos
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create index if not exists github_repos_user_enabled on public.github_repos (user_id, enabled);

-- What the AI concluded about a task, kept so it is computed once and stays
-- readable later — the same reason ai_meta exists on tasks.
create table if not exists public.task_code_hints (
  id uuid primary key default public.uuid_v7(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  repo text,
  files jsonb,            -- [{path, why, last_commit, last_author, last_at}]
  reason text,
  confidence real,
  model text,
  created_at timestamptz not null default now(),
  unique (task_id)
);
alter table public.task_code_hints enable row level security;
create policy "own code hints" on public.task_code_hints
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
