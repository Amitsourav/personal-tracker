-- Amit changed Saurabh Adwani's tranche release amount in the CRM because the
-- recorded release was lower than the invoice. He wants to verify it landed.
-- Filed under FMC: the invoice list it came from is Deepak's fundmycampus mail.
insert into public.tasks
  (user_id, title, description, status, priority, project_id, source_kind, source_quote)
select p.id,
  'Recheck Saurabh Adwani tranche release amount in CRM',
  'Changed it because the last release amount recorded in the CRM was lower than the invoice.'
    || chr(10) || 'Verify the corrected amount saved, and that it now matches the invoice.'
    || chr(10) || 'Related: item 8 of Deepak''s "invoice changes" mail (10 Sep) — commission moved to 1% from 1.35%.',
  'todo'::task_status, 2,
  '01a0904e-e2f5-7cb4-8fde-94ba3071d2a9'::uuid,   -- FMC
  'manual'::source_kind,
  '8. Saurabh adwani changed to 1% from 1.35%'
from public.profiles p;
