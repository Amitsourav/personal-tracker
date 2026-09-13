-- Merging two rows that are one person.
--
-- The schema was always meant to hold one identity across channels, but nothing
-- joined them: Gmail matches on email and WhatsApp on phone, so the first time
-- someone reaches you on both you get two rows, two task counts, and a People
-- page that quietly lies. This will recur with every contact, so it is a
-- function rather than a one-off script.
--
-- The survivor keeps its own name and trust level; everything else is moved and
-- the identifiers are unioned, so no task, message or handle is lost.
create or replace function public.merge_people(keep uuid, absorb uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if keep = absorb then raise exception 'cannot merge a person into themselves'; end if;

  select user_id into uid from public.people where id = keep;
  if uid is null then raise exception 'keep person not found'; end if;
  if not exists (select 1 from public.people where id = absorb and user_id = uid) then
    raise exception 'both people must belong to the same user';
  end if;

  update public.tasks    set person_id = keep            where person_id = absorb;
  update public.tasks    set waiting_on_person_id = keep where waiting_on_person_id = absorb;
  update public.messages set person_id = keep            where person_id = absorb;

  update public.people k set
    emails       = (select array(select distinct e from unnest(coalesce(k.emails,'{}') || coalesce(a.emails,'{}')) e where e is not null and e <> '')),
    phones       = (select array(select distinct p from unnest(coalesce(k.phones,'{}') || coalesce(a.phones,'{}')) p where p is not null and p <> '')),
    whatsapp_ids = (select array(select distinct w from unnest(coalesce(k.whatsapp_ids,'{}') || coalesce(a.whatsapp_ids,'{}')) w where w is not null and w <> '')),
    company      = coalesce(k.company, a.company),
    role         = coalesce(k.role, a.role),
    notes        = nullif(concat_ws(E'\n', nullif(k.notes,''), nullif(a.notes,'')), ''),
    -- Keep whichever contact is genuinely the most recent, not whichever row won.
    last_contact_at = greatest(coalesce(k.last_contact_at, a.last_contact_at), coalesce(a.last_contact_at, k.last_contact_at)),
    updated_at   = now()
  from public.people a where k.id = keep and a.id = absorb;

  delete from public.people where id = absorb;
end $$;
revoke all on function public.merge_people(uuid, uuid) from anon;
grant execute on function public.merge_people(uuid, uuid) to authenticated;

-- Deepak Agrawal: deepak@fundmycampus.com (Gmail) and +919711358612 (WhatsApp)
-- were the same person, applied 13 Sep 2026. The WhatsApp row survived because
-- Amit had set it to auto_accept, a deliberate choice worth keeping.
