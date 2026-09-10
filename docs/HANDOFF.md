# Handoff — where things stand (11 Sept 2026)

## Done
- **Phase 0 Setup**: Supabase project, Vercel project (GitHub-linked), magic-link login, Supabase auth URLs set to the Vercel domain.
- **Phase 1 Tracker** (live, Amit signed in): tasks, projects, tags, people, subtasks, repeats; list / table / board / calendar; Today, Upcoming, Inbox, All, Logbook, saved views; ⌘K; quick add with natural language (`kal tak`, `p1`, `#project`, `@tag`, `from:Name`, `~30m`, `every monday`); detail panel with activity; keyboard shortcuts; PWA; dark/light; JSON/CSV export in Settings.
- **Phase 2 code** (built, deployed, pushed, and verified working):
  - `src/components/IntegrationsSettings.tsx` — Settings: OpenRouter key, models, spend cap; Google client ID/secret; Connect Gmail & Calendar; Sync now; last-sync status; ignore senders.
  - `src/app/api/google/{start,callback,disconnect}` — Google OAuth (offline access, scopes: gmail.readonly + calendar + email). Refresh token stored in `user_secrets`.
  - `src/app/api/sync/gmail` — forwards the user's JWT to the edge function for a manual run.
  - `supabase/functions/ingest-gmail/index.ts` — **deployed (v2)**. Every 5 min via pg_cron (`ingest-gmail-every-5-min`) or on demand. Reads new INBOX mail (history API, fallback `newer_than`), prefilters (promotions/social, List-Unsubscribe, no-reply, self, ignored senders/people), redacts, records `messages`, asks OpenRouter (JSON-schema output) for tasks with Hinglish/IST/EOD/Saturday rules, dedupes against open tasks from the same sender (follow-up → priority bump + `task_events` note; "done" → note only), matches/creates `people` by email, inserts tasks as `suggested` (or `accepted` for auto_accept people), logs `ai_usage`, honours monthly cap. `purge-message-bodies` cron nulls bodies after 30 days.
  - Review page: reason/subject/deadline phrase, Accept all, per-person "always accept"/"ignore".
  - Migrations recorded in `supabase/migrations/` (all three applied to the live DB).

## Phase 2 — DONE (verified end to end, 11 Sept 2026)
Proven live: Gmail read → prefilter → redact → Gemini extraction → suggestion in Review → accepted → done → reopened (see `task_events`). Cron `ingest-gmail-every-5-min` is active and succeeding.
Current models: reading `google/gemini-3.7-flash`, planning `anthropic/claude-sonnet-5`.

Two real bugs were found and fixed getting there:
1. **`log_task_event()` rejected every task INSERT** — `42804 column "actor" is of type actor_kind but expression is of type text`. A CASE result is typed `text` and is not implicitly coerced to the enum. This broke ALL task creation, manual included, since Phase 1. Fixed in `20260911_0003_fix_log_task_event_actor_cast.sql` (applied).
2. **`ingest-gmail` discarded insert errors**, so a fully failing sync reported success. It now records them in `sync_runs.error`. Same deploy widened the automated-sender prefilter (`@notify.` — nine identical Railway alerts had eaten a whole run), added same-sender/same-subject dedupe per run, and raised the scan from 24 ids/3 days to 100 ids/7 days.

### Still open (not blocking use)
1. **Google app is in Testing mode — the Gmail connection expires ~18 Sept 2026.** Amit is on the Test users list; publishing is blocked until the Branding page is completed, which needs a privacy policy + terms URL. Next step: add `/privacy` and `/terms` pages to the app, fill Branding, then Audience → Publish app.
2. Google sign-in provider (Supabase → Auth → Providers → Google) never enabled — magic link works, so this is cosmetic.

## Tuning backlog — DEFERRED BY AMIT (11 Sept 2026)
Amit's call: do not tune phase by phase. Build all the phases first, then do one tuning pass over everything at the end. Collect items here as they are noticed; do not stop to fix them mid-build unless they block a phase.

- **Gmail prefilter**: tune on ~100 real emails. Watch `messages.skipped_reason` for false skips and `sync_runs` / `ai_usage` for cost. First real extraction (Deepak Agrawal, invoice changes) was correct at 0.95 confidence, so the prompt is a reasonable baseline.
- **Extraction prompt**: Hinglish deadline handling, priority calibration, `commitment` vs `request` split, confidence floor (currently 0.35).
- **`MAX_PER_RUN` = 25 and 7-day window**: re-check once real volume is known.
- **Model choice per feature**: reading is `google/gemini-3.7-flash`, planning `anthropic/claude-sonnet-5`; revisit against real accuracy and spend.
- **Monthly cap** $10 — revisit once WhatsApp volume lands, since it will dominate call count.
- Chrono parses English only; Hinglish words are mapped in `src/lib/quickadd.ts` (`HINGLISH` table) — extend during the tuning pass.

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
- Everything is now pushed to GitHub `master` and deployed on Vercel; the live DB has all three migrations and `ingest-gmail` v2.
