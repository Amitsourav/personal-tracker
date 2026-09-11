-- ai_usage had a SELECT policy and no INSERT policy. The edge functions use the
-- service role and bypass RLS, so their logging always worked; anything running
-- as the user could not insert at all. /api/ai/draft runs as the user, so every
-- chaser draft spent money that was never recorded, and month_spend() - which
-- enforces monthly_cap_usd - silently under-counted.
create policy "log own usage" on public.ai_usage
  for insert to authenticated
  with check (user_id = (select auth.uid()));
