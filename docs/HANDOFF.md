# Handoff — where things stand (10 Sept 2026)

## Done
- **Phase 0 Setup**: Supabase project, Vercel project (GitHub-linked), magic-link login, Supabase auth URLs set to the Vercel domain.
- **Phase 1 Tracker** (live, Amit signed in): tasks, projects, tags, people, subtasks, repeats; list / table / board / calendar; Today, Upcoming, Inbox, All, Logbook, saved views; ⌘K; quick add with natural language (`kal tak`, `p1`, `#project`, `@tag`, `from:Name`, `~30m`, `every monday`); detail panel with activity; keyboard shortcuts; PWA; dark/light; JSON/CSV export in Settings.
- **Phase 2 code** (built, deployed on Supabase, **not yet pushed to GitHub/Vercel**):
  - `src/components/IntegrationsSettings.tsx` — Settings: OpenRouter key, models, spend cap; Google client ID/secret; Connect Gmail & Calendar; Sync now; last-sync status; ignore senders.
  - `src/app/api/google/{start,callback,disconnect}` — Google OAuth (offline access, scopes: gmail.readonly + calendar + email). Refresh token stored in `user_secrets`.
  - `src/app/api/sync/gmail` — forwards the user's JWT to the edge function for a manual run.
  - `supabase/functions/ingest-gmail/index.ts` — **deployed (v1)**. Every 5 min via pg_cron (`ingest-gmail-every-5-min`) or on demand. Reads new INBOX mail (history API, fallback `newer_than`), prefilters (promotions/social, List-Unsubscribe, no-reply, self, ignored senders/people), redacts, records `messages`, asks OpenRouter (JSON-schema output) for tasks with Hinglish/IST/EOD/Saturday rules, dedupes against open tasks from the same sender (follow-up → priority bump + `task_events` note; "done" → note only), matches/creates `people` by email, inserts tasks as `suggested` (or `accepted` for auto_accept people), logs `ai_usage`, honours monthly cap. `purge-message-bodies` cron nulls bodies after 30 days.
  - Review page: reason/subject/deadline phrase, Accept all, per-person "always accept"/"ignore".
  - Migrations recorded in `supabase/migrations/` (both already applied to the live DB).

## Remaining for Phase 2 (Amit's side, guide him click by click)
1. `git add -A && git commit -m "Phase 2: Gmail capture" && git push` → Vercel redeploys.
2. Google Cloud: new project → enable **Gmail API** + **Google Calendar API** → OAuth consent screen (External, **Publish app** so refresh tokens don't expire after 7 days) → Credentials → OAuth client (Web) with redirect URIs
   - `https://personal-tracker-eta-six.vercel.app/api/google/callback`
   - `https://iljkjqlwrjkinvloqqgx.supabase.co/auth/v1/callback`
3. In the app Settings: paste OpenRouter key; paste Client ID + secret; **Connect Gmail & Calendar** (expect the "unverified app" warning → Advanced → continue); **Sync now**; check **Review**.
4. Google sign-in: Supabase dashboard → Authentication → Providers → Google → enable, paste the same client ID/secret. (Login page already has the button.)
5. Tune on ~100 real emails: adjust prefilter regexes and the prompt in `ingest-gmail`; watch `sync_runs` and `ai_usage`. Check `supabase functions logs ingest-gmail` for errors.

## Phase 3 — WhatsApp capture (design decided)
- Mac helper (Node or Python script + `launchd` agent) reads WhatsApp Desktop's local SQLite **read-only**: `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite` (tables `ZWAMESSAGE`, `ZWACHATSESSION`, `ZWAPROFILEPUSHNAME`; Core Data timestamps = seconds since 2001-01-01). Needs **Full Disk Access** for the helper's binary. Copy the DB to a temp file before opening (WAL).
- Allow-list only: Amit picks chats (`user_secrets` or a new `whatsapp_chats` table with `jid, name, enabled`). Everything else is never read.
- Helper posts new messages (batched, every ~60 s) to a new edge function `ingest-whatsapp` with a per-user token; reuse the same extraction pipeline (factor `extract()` into a shared module). `messages.channel='whatsapp'`, `external_id` = message id, `sender_handle` = phone/JID; match `people.phones` / `whatsapp_ids`.
- Follow-ups ("kya hua?") and "done / bhej diya" signals as in Gmail. Voice notes: helper sends the .opus file; transcribe (OpenRouter audio-capable model or Sarvam for Hinglish) then extract.
- Task-bot number is **deferred** (no spare number).

## Phase 4 — People & follow-ups
- People pages exist (`/people`, `/people/[id]`: I owe them / they owe me, trust level). Add: promise tracker (scan **sent** mail + Amit's own WhatsApp messages for commitments → tasks with `waiting_on_person_id=null`, `person_id=null`, `ai_meta.kind='promise'`), waiting-for chaser drafts after N days (Gmail draft via `gmail.compose` scope — requires re-consent; or copy-to-clipboard), "noted, will do by …" reply drafts on accept, meeting prep view.

## Phase 5 — Smart planning
- Calendar scope is already requested. Two-way Google Calendar sync (`scheduled_at`/`duration_min` ↔ events), AI daily plan filling ~70% of free time (approve → time-block), re-plan diff, deadline-risk warnings, free-gap suggestions, morning brief (email/push; WhatsApp later).

## Phase 6 — AI does the work
- Detect AI-doable tasks; drafts (Gmail drafts), research, summaries; context packet (related `messages` + `task_events`); "ask your tasks" (pgvector + hybrid search, embeddings via OpenRouter).

## Later
WhatsApp task bot, stale-task cleaner / weekly review, MCP server so ChatGPT/Claude can read tasks, native iPhone app, learned estimates, photo-to-task, notification budget.

## Known gaps / notes
- Chrono parses English; Hinglish words are mapped in `src/lib/quickadd.ts` (`HINGLISH` table).
- `people/[id]` trust selector and Review page actions write `people.trust_level`; the edge function honours it.
- The cloud session that built this could not push to GitHub — Amit pushes from his IDE. The live DB already has all migrations and the edge function.
