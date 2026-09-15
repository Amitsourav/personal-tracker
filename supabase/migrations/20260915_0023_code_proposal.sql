-- The first draft of a change.
--
-- The last rung, and the one the industry is currently falling off: generating
-- code stopped being the constraint in 2026, reviewing it became the
-- constraint. So this is built to be reviewable rather than prolific — one
-- task, the files already traced to it, a patch small enough to read.
--
-- Nothing is written to GitHub. The token stays read-only; opening a pull
-- request means handing an AI push access, which is a decision to make
-- deliberately once this has proved useful, not a side effect of trying it.
alter table public.task_code_hints
  add column if not exists proposal jsonb;   -- {ready, missing, summary, patch, how_to_check, risks, confidence}
