-- Voice notes arrive as audio and are transcribed on the way in, so the rest of
-- the pipeline never has to know the difference. media_kind records which
-- messages were spoken rather than typed: a transcript is a reading of what
-- someone said, not their words, and anything quoting it should be able to say so.
alter table public.messages add column if not exists media_kind text
  check (media_kind is null or media_kind in ('audio'));
