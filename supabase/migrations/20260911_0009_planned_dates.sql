-- "Planned date" (tasks.start_at): when Amit intends to get to something, as
-- distinct from due_at, which means somebody is waiting for it.
--
-- Almost none of his backlog has real deadlines. Marking it all "due" would put
-- 32 tasks overdue on the same day and turn the overdue count into noise, right
-- when it most needs to stay true. A planned date gives the planner something to
-- order by without claiming a promise that was never made.

-- 09:00 local, n working days out, skipping Sundays (his week is Mon-Sat).
create or replace function public.planned_date(days_out int, tz text default 'Asia/Kolkata')
returns timestamptz language sql stable as $$
  select case
    when extract(dow from (date_trunc('day', (now() at time zone tz) + make_interval(days => days_out)))) = 0
      then (date_trunc('day', (now() at time zone tz) + make_interval(days => days_out + 1)) + interval '9 hours') at time zone tz
    else (date_trunc('day', (now() at time zone tz) + make_interval(days => days_out)) + interval '9 hours') at time zone tz
  end;
$$;

-- New tasks that carry neither a deadline nor a plan get one, so nothing lands
-- in the backlog invisible to the planner. A real due_at always wins: this only
-- ever fills a gap, and never overwrites anything.
create or replace function public.set_planned_date() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.due_at is null and new.start_at is null and new.parent_id is null then
    new.start_at := public.planned_date(3);
  end if;
  return new;
end $$;

drop trigger if exists tasks_planned_date on public.tasks;
create trigger tasks_planned_date before insert on public.tasks
  for each row execute function public.set_planned_date();

-- Backfill the existing backlog: broken things first, then oldest first, three a
-- day across the coming fortnight rather than all on one date.
with ordered as (
  select id, row_number() over (order by priority, created_at) - 1 as n
  from public.tasks
  where deleted_at is null and due_at is null and start_at is null
    and status not in ('done','cancelled') and parent_id is null
)
update public.tasks t
set start_at = public.planned_date((o.n / 3)::int + 1)
from ordered o
where t.id = o.id;
