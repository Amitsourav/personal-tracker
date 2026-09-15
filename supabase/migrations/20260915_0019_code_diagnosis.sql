-- "What is actually wrong?"
--
-- Clients report symptoms, not bugs. The gap between "Gauri Bhatnagar is coming
-- in disbursed but not on invoice 30" and a named function is where the hours
-- go. This stores the cause, where to look, the cheapest way to confirm it, and
-- — the part that keeps it honest — what the model could not see.
--
-- The only feature in the GitHub set that reads source code, so the only one
-- that sends any to a model. Kept opt-in per task rather than quietly eroding
-- the promise the other three make.
alter table public.task_code_hints
  add column if not exists diagnosis jsonb;
