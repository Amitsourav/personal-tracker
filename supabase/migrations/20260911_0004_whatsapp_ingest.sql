-- Phase 3: WhatsApp capture via the existing Baileys bot (Amitsourav/whatsappbot).
-- The bot posts messages from allow-listed groups to the ingest-whatsapp edge
-- function. It has no Supabase user session, so it authenticates with a shared
-- secret held here rather than a JWT.
alter table public.user_secrets
  add column if not exists whatsapp_token text,
  add column if not exists whatsapp_owner_phone text,
  add column if not exists whatsapp_enabled boolean not null default true;

-- Give the existing row a token so there is nothing to copy by hand.
update public.user_secrets
set whatsapp_token = replace(gen_random_uuid()::text, '-', '')
                  || replace(gen_random_uuid()::text, '-', '')
where whatsapp_token is null;

-- Groups the bot is allowed to forward from. The bot holds its own switch too;
-- this is the Tracker-side record, and what the Review page shows as the source.
create table if not exists public.whatsapp_groups (
  id uuid primary key default public.uuid_v7(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wa_group_id text not null,
  name text,
  enabled boolean not null default true,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, wa_group_id)
);
alter table public.whatsapp_groups enable row level security;
create policy "own whatsapp groups" on public.whatsapp_groups
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Look a token up without exposing user_secrets to the function's caller.
create or replace function public.user_by_whatsapp_token(tok text)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from public.user_secrets
  where whatsapp_token = tok and whatsapp_enabled and tok is not null;
$$;
revoke all on function public.user_by_whatsapp_token(text) from anon, authenticated;
