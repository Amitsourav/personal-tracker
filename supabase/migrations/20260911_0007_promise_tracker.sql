-- Phase 4 promise tracker: scans Amit's SENT mail for commitments he made to
-- other people ("I'll send the deck by Friday") and files them as suggestions.
--
-- Separate watermark from inbox capture: sent mail is scanned hourly rather than
-- every five minutes. A promise is not urgent the minute it is made, and one AI
-- call per sent email is the expensive part.
alter table public.user_secrets
  add column if not exists promises_enabled boolean not null default true,
  add column if not exists gmail_sent_last_at timestamptz;

-- Tasks the tracker creates carry ai_meta->>'kind' = 'promise'. Indexed because
-- the Follow-ups page filters on it on every render.
create index if not exists tasks_promise_idx on public.tasks ((ai_meta->>'kind'))
  where deleted_at is null;

-- Hourly, offset from the 5-minute inbox job so they do not collide.
-- select cron.schedule('ingest-promises-hourly', '20 * * * *', $$ select net.http_post(url := '.../functions/v1/ingest-promises', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select whatsapp_token from public.user_secrets where whatsapp_token is not null limit 1)), body := '{}'::jsonb, timeout_milliseconds := 180000); $$);
