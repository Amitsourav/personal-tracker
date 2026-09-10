-- Applied 2026-09-10. Per-user secrets + integration state, AI spend log, sync runs, scheduled ingestion.
create table public.user_secrets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  openrouter_key text,
  model_extract text not null default 'openai/gpt-4o-mini',
  model_plan text not null default 'anthropic/claude-sonnet-4',
  monthly_cap_usd numeric not null default 10,
  google_client_id text, google_client_secret text, google_refresh_token text, google_email text,
  google_scopes text[] not null default '{}',
  gmail_history_id text, gmail_last_sync_at timestamptz, gmail_enabled boolean not null default true,
  gmail_ignore_senders text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.user_secrets enable row level security;
create policy "own secrets" on public.user_secrets for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create trigger user_secrets_updated before update on public.user_secrets for each row execute function public.set_updated_at();

create table public.ai_usage (
  id uuid primary key default public.uuid_v7(), user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null, model text not null, input_tokens integer not null default 0, output_tokens integer not null default 0,
  cost_usd numeric not null default 0, created_at timestamptz not null default now()
);
create index ai_usage_user_month_idx on public.ai_usage(user_id, created_at);
alter table public.ai_usage enable row level security;
create policy "own usage" on public.ai_usage for select using (user_id = (select auth.uid()));

create table public.sync_runs (
  id uuid primary key default public.uuid_v7(), user_id uuid not null references auth.users(id) on delete cascade,
  channel source_kind not null, started_at timestamptz not null default now(), finished_at timestamptz,
  fetched integer not null default 0, candidates integer not null default 0, created_tasks integer not null default 0, error text
);
create index sync_runs_user_idx on public.sync_runs(user_id, started_at desc);
alter table public.sync_runs enable row level security;
create policy "own runs" on public.sync_runs for select using (user_id = (select auth.uid()));

create or replace function public.month_spend(uid uuid) returns numeric language sql stable security invoker set search_path = public as $$
  select coalesce(sum(cost_usd), 0) from public.ai_usage where user_id = uid and created_at >= date_trunc('month', now());
$$;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
-- Every 5 min: call the ingest-gmail edge function with the (legacy, JWT) anon key so verify_jwt passes; the function uses the service role internally.
-- select cron.schedule('ingest-gmail-every-5-min', '*/5 * * * *', $$ select net.http_post(url := 'https://<ref>.supabase.co/functions/v1/ingest-gmail', headers := '{"Content-Type":"application/json","Authorization":"Bearer <ANON_JWT>"}'::jsonb, body := '{}'::jsonb, timeout_milliseconds := 120000); $$);
-- select cron.schedule('purge-message-bodies', '30 3 * * *', $$ update public.messages set body = null where body is not null and sent_at < now() - interval '30 days' $$);
