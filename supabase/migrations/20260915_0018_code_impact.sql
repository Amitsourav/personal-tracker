-- "What else does changing this touch?"
--
-- Where-to-start answers where the work is. This answers the question that
-- costs a weekend: the function you are about to change is also called by the
-- disbursement page and the CSV export, and nothing tells you until it breaks
-- in front of a client.
--
-- Computed from GitHub's own code search over symbols extracted with regexes,
-- so no model is involved and no source code leaves GitHub.
alter table public.task_code_hints
  add column if not exists impact jsonb;   -- {groups:[{file,symbols,refs}], total, uncertain, at}
