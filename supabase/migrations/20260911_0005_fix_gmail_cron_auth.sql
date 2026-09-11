-- The ingest-gmail cron had been returning 401 on every run since it was created:
-- it authenticated with the legacy anon JWT ("eyJ..."), which this project no
-- longer accepts now that it issues sb_publishable_* / sb_secret_* keys. pg_cron
-- reported "succeeded" throughout, because the POST was sent successfully — only
-- the response was rejected. Automatic Gmail capture had therefore never run;
-- the only syncs that ever happened were manual "Sync now" clicks.
--
-- Fix: authenticate with the per-user sync token (the same value the WhatsApp bot
-- uses), which is a plain string compare and independent of JWT format. The
-- command reads the token at run time rather than embedding it, so rotating the
-- token does not require rescheduling the job.
create or replace function public.user_by_sync_token(tok text)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from public.user_secrets
  where whatsapp_token = tok and tok is not null and length(tok) >= 32;
$$;
revoke all on function public.user_by_sync_token(text) from anon, authenticated;

select cron.unschedule('ingest-gmail-every-5-min');

select cron.schedule('ingest-gmail-every-5-min', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://iljkjqlwrjkinvloqqgx.supabase.co/functions/v1/ingest-gmail',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select whatsapp_token from public.user_secrets
                                     where whatsapp_token is not null limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);
