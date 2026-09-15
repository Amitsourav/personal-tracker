-- Let other AI tools ask the tracker questions.
--
-- The documented gap of 2026: every AI tool keeps its context inside its own
-- app, so the same project gets re-explained to Cursor, then to Claude Code,
-- then to ChatGPT. MCP is the open standard that fixes it, and the tracker
-- already holds the thing those tools cannot know — what the client actually
-- asked for, in the words they used.
--
-- Its own token, not the WhatsApp one. Two systems sharing a secret means
-- rotating either breaks both, and this one is pasted into editor config files
-- that end up in dotfile repositories.
alter table public.user_secrets
  add column if not exists mcp_token text,
  add column if not exists mcp_enabled boolean not null default true;

update public.user_secrets
set mcp_token = replace(gen_random_uuid()::text, '-', '')
             || replace(gen_random_uuid()::text, '-', '')
where mcp_token is null;

create or replace function public.user_by_mcp_token(tok text)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from public.user_secrets
  where mcp_token = tok and mcp_enabled and tok is not null and length(tok) >= 32;
$$;
revoke all on function public.user_by_mcp_token(text) from anon, authenticated;
