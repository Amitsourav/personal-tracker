-- "How long will this take?"
--
-- When eighteen items arrive in one message they look alike. Two are twenty
-- minutes and one is two days, and nothing on the screen says which — so the
-- day planner runs on a default of thirty minutes and a week planned against it
-- is fiction.
--
-- Measured, then judged: the files are read to count lines, exported names and
-- whether anything tests them, and only those numbers reach the model. Source
-- code stays on GitHub, as everywhere else except the diagnosis feature.
alter table public.task_code_hints
  add column if not exists estimate jsonb;   -- {low, high, suggest, drivers, confidence, measured}
