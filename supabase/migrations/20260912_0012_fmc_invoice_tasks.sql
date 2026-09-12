-- Items 34-37 from the AdmitVerse Tech Team group on 11 Sep 2026, posted by
-- "~Deepak" (+91 78272 25354) at 17:36-17:44 IST. They continue Deepak Sir's
-- numbered task list but carry no "Task" marker, so the bot never forwarded
-- them and Tracker never saw them. Added by hand from Amit's screenshot.
--
-- source_kind stays 'manual': these were typed in, not captured. Claiming
-- 'whatsapp' would make a broken capture path look like it worked.
insert into public.tasks
  (user_id, title, description, status, priority, project_id, source_kind, source_quote)
select
  p.id, v.title, v.description, 'todo'::task_status, v.priority,
  '01a0904e-e2f5-7cb4-8fde-94ba3071d2a9'::uuid,   -- FMC
  'manual'::source_kind, v.quote
from public.profiles p
cross join (values
  ('Fix Kuhoo invoice changes (FMC-074, FMC-075)',
   'Two invoices still outstanding:' || chr(10) ||
   '- Rajwardhan, FMC-074, Kuhoo, Other 3, Rs 274,468' || chr(10) ||
   '- Mansi Bansal, FMC-075, Kuhoo, Ankit DM1, Rs 268,715' || chr(10) ||
   'Apart from these two, all payments received (although not fully).',
   2::smallint,
   '34. Invoice changes of Kuhoo — Rajwardhan FMC-074 Rs 274,468; Mansi Bansal FMC-075 Rs 268,715. Apart from these two - all payments received (although not fully)'),
  ('Map uploaded invoices student-wise',
   'Invoices have been uploaded but are not mapped to students. Example case to check: Kuhoo.',
   2::smallint,
   '35. Invoices have been uploaded but somehow not mapped student wise - need to check this (example from Kuhoo)'),
  ('Allow editing the amount on a previous invoice',
   'Previous invoices are currently locked. The amount field needs to be editable.',
   3::smallint,
   '36. Editable amount for previous invoice to be opened'),
  ('Add dropdown of students with invoices already raised',
   'So an invoice can be picked against a student instead of searching.',
   3::smallint,
   '37. Drop down of students for whom invoice has been raised')
) as v(title, description, priority, quote);
