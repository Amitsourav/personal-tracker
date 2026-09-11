# Handoff — where things stand (11 Sept 2026)

## TEST CHECKLIST — everything built but not yet confirmed working
Kept at the top because it is the thing most likely to be assumed rather than
checked. Nothing below has been exercised by Amit on real data. Lint, build and
deploy all pass, which today proved repeatedly is not the same as working.

### ✅ RESOLVED 11 Sept 2026 — real WhatsApp capture is proven
At 11:38 UTC Deepak Agrawal posted in `120363420434303553@g.us`:
`Task` / `31. Ireland as a next destination for organic ranking` / `32. College
wise page` / `33. Course x college wise page`. The bot forwarded it and Tracker
produced **three** tasks at 0.95 confidence, each quoting its own line, person
matched by phone, planned dates assigned. Whole chain confirmed end to end: real
group → bot → endpoint → Task marker recognised → one message split into three.
Phase 3 is genuinely done, not merely built.

### Open, small, deferred by Amit (11 Sept)
- [ ] **Deepak Agrawal exists twice** — once from email
      (`deepak@fundmycampus.com`), once from WhatsApp (`+919711358612`). The
      schema was built for one identity across channels; nothing merges them yet
      because the two handles never coincided. Merge = move tasks/messages to one
      row, union emails/phones/whatsapp_ids, delete the other. Worth doing before
      People counts are trusted, and worth a general merge rule afterwards or it
      will recur with every contact reached on both channels.
- [ ] **The real group has no name** — stored as the raw
      `120363420434303553@g.us`. The bot is not sending `group.name`. Cosmetic,
      but ask the bot team to include it; the Review page and meeting prep both
      show it to Amit.

### Superseded — kept for the record
- [x] **WhatsApp: a real message.** Zero real groups (`@g.us`) have ever reached
      `ingest-whatsapp`; all traffic so far is synthetic (our tests + the bot's
      probe, whose group id was `connectivity-check@probe`). In an enabled group
      post two messages and check Review within ~60s:
      1. `Task` on its own line, then `test message for tracker, ignore` → should
         appear as a task
      2. One of Amit's own, e.g. `haan main kal tak ye bhej dunga` → should appear
         as a **promise**
      If nothing arrives, check in this order: `tracker_outbox` counts in the bot
      DB → bot flush logs → `whatsapp_groups` in Tracker → `function_edge_logs`.
- [ ] **Ask the bot team:** `client.js` skips `message.fromMe`. If the bot's
      WhatsApp session is linked to Amit's OWN number, his messages are `fromMe`
      and promise capture silently never fires. Expected to be a separate number,
      never confirmed.

### Phase 4 — built, unexercised
- [x] Follow-ups page + Chase draft — confirmed by Amit
- [x] Accept & reply (`draft_ack`) — confirmed in `ai_usage` 11 Sept 09:29
- [ ] **Promise tracker on WhatsApp** — both sides deployed, synthetic only
- [ ] Promise tracker on email — correct but found 1 sent email in 60 days;
      expect it to stay silent

### Phase 5 — only the day planner has been run
- [x] AI day plan — Amit ran it and approved the output
- [ ] **Accept plan → does the block actually appear in Google Calendar?**
      (`/api/calendar/block`, never exercised)
- [ ] Unschedule / complete a task → does the calendar entry disappear?
- [ ] Meeting prep — needs a real meeting with attendees already in `people`;
      current calendar has 2 events, neither with attendees
- [ ] Free-gap suggestions — only renders today, 15-120 min before the next
      meeting, with unscheduled tasks available
- [ ] Re-plan diff — run Plan, accept, then Re-plan and check the moved/new/
      dropped labels
- [ ] Morning brief + deadline risk — brief hides itself when there is nothing
      to say, so an empty screen may be correct rather than broken

### Known gap, not a bug to find
- [ ] **Calendar edits do not flow back.** Dragging a time-block to a new time
      inside Google Calendar does NOT update `tasks.scheduled_at`; Tracker will
      quietly show the old time. `sync-calendar` never writes to `tasks`. The
      plan called for `scheduled_at/duration_min ↔ events`, so this is a gap
      rather than a decision. ~30 min: when a synced event has a `task_id` and
      its start has changed, update the task to match.

### Deferred by choice
- Morning brief is in-app only; email/push/WhatsApp delivery not built.
- Voice notes (Phase 3) — never decided.
- WhatsApp settings screen (Phase 3) — `whatsapp_groups.enabled` is enforced but
  has no UI; SQL only.

### Test data to clear before trusting any numbers
People `Priya` / `Vikas` / `Neha` (+9190000000xx); groups `120363TEST*` and
`connectivity-check@probe`; messages with ids like `test-*`, `tk-*`, `v2-*`,
`pr-*`, `probe-*`; and the tasks they produced.

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
0. **FIXED 11 Sept: automatic Gmail sync had never run.** The pg_cron job used the
   legacy anon JWT, which this project no longer accepts (it issues
   `sb_publishable_*` keys), so every tick was rejected 401 at the gateway.
   pg_cron reported "succeeded" because the POST was sent — only the response was
   rejected — so it looked healthy. `sync_runs` showed three gmail runs ever, all
   manual. Now authenticates with the sync token (`user_by_sync_token`, plain
   string compare, JWT-format independent); the cron builds its header from the
   token at run time so rotation needs no reschedule. The anon-key branch was
   removed: the publishable key is public and must never trigger paid AI work.
   Verified: 14 clean scheduled runs in the first hour.
   **Lesson: `cron.job_run_details.status` says the request was sent, NOT that it
   was accepted. Always confirm against `sync_runs` or `function_edge_logs`.**
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

## Phase 3 — WhatsApp capture: BUILT BOTH SIDES, REAL CAPTURE NOT YET VERIFIED (11 Sept 2026)

**Design changed.** The Mac-helper-reading-SQLite plan below was dropped. Amit
already runs a Baileys bot (`Amitsourav/whatsappbot`, Railway service
`whatsappbot`) in his work groups, so it forwards to Tracker instead. That removes
the Mac helper, Full Disk Access, the MacBook-must-be-awake limitation, and the
~60s polling delay. Design + contract: `docs/WHATSAPP-BOT-INTEGRATION.md`.

Tracker side: `ingest-whatsapp` (deployed, `verify_jwt` off — the bot has no user
JWT and authenticates with `user_secrets.whatsapp_token`). One AI call per batch.
Chat-specific prompt. Recognises the team's `Task` prefix convention as an
explicit task at >= 0.8 confidence (their most common format, and it carries
neither `mentionedMe` nor `isReplyToMe`).

Bot side: reported built and live by the bot team — outbox table, `tracker_enabled`
per group, flush worker every 60s, wrapped orchestrator hook, panel toggle, 332
tests including one proving a Tracker failure cannot stop a lead reaching the CRM.
Railway variables set. One group (AdmitVerse Tech Team) switched on.

### Proven
- Endpoint auth: 401 without token, 401 with the publishable key, 405 on GET
- Extraction on synthetic batches: tags, Hinglish (`kal tak`/`parso`/EOD/urgent),
  ignores acknowledgements, ignores work aimed at a third party, `Task` prefix
  captured, `Tasks` plural correctly not captured
- The wire: the bot reached the endpoint with a 23-message connectivity probe on
  11 Sept 07:48 UTC — token, batching, storage and extraction all worked

### NOT proven — the one thing left
**No message from a real WhatsApp group has ever arrived.** The only traffic is
synthetic: three of our own test batches and the bot's probe, whose group id is
`connectivity-check@probe` (a real group id ends `@g.us`). AdmitVerse Tech Team
has never appeared. The unverified link is the bot's own filter: whether a real
`@Amit` tag or a real `Task` message is queued and sent.

To settle it, post in that group:

```
Task
test message for tracker, ignore
```

then check `whatsapp_groups` for a row ending `@g.us`, and Review. Also worth
asking whether the probe's `@probe` group id bypassed a check a real `@g.us`
group would hit.

### Pending for Phase 3 (agreed 11 Sept 2026, deferred by Amit)
1. **Verify real capture.** Post in AdmitVerse Tech Team:
   ```
   Task
   test message for tracker, ignore
   ```
   then check `whatsapp_groups` for a row ending `@g.us` and check Review. Not a
   formality: the bot's probe used the group id `connectivity-check@probe`, so if
   anything in its path validates the real `@g.us` shape, the probe sailed past a
   check a real group would hit.
2. **WhatsApp section in Tracker Settings (~30 min, not started).** There is none
   today — `whatsapp_groups.enabled` exists and is enforced, but no UI reaches it,
   so the Tracker-side switch can only be flipped with SQL. Every other
   integration is controllable from Settings; this one is not. Build: list the
   groups the bot has sent from with an on/off toggle each, last-received time,
   and the token with copy + rotate buttons (rotation currently needs SQL from
   Claude). Self-contained; touches nothing running.
3. **Voice notes — undecided, not built.** A voice note containing work is
   currently ignored entirely. Needs the bot to send the audio, transcription
   (OpenRouter audio model, or Sarvam for Hinglish), then the existing extractor.
   Amit has not said how often people send him voice notes with real work in them;
   ask before building.

### Test data to clear before trusting the numbers
People `Priya` / `Vikas` / `Neha` (+9190000000xx), the three `120363TEST*` groups
and `connectivity-check@probe`, and messages with ids like `test-*`, `tk-*`, `v2-*`,
`probe-*`. Harmless but they inflate counts.

## Phase 3 — original Mac-helper design (SUPERSEDED, kept for reference)
- Mac helper (Node or Python script + `launchd` agent) reads WhatsApp Desktop's local SQLite **read-only**: `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite` (tables `ZWAMESSAGE`, `ZWACHATSESSION`, `ZWAPROFILEPUSHNAME`; Core Data timestamps = seconds since 2001-01-01). Needs **Full Disk Access** for the helper's binary. Copy the DB to a temp file before opening (WAL).
- Allow-list only: Amit picks chats (`user_secrets` or a new `whatsapp_chats` table with `jid, name, enabled`). Everything else is never read.
- Helper posts new messages (batched, every ~60 s) to a new edge function `ingest-whatsapp` with a per-user token; reuse the same extraction pipeline (factor `extract()` into a shared module). `messages.channel='whatsapp'`, `external_id` = message id, `sender_handle` = phone/JID; match `people.phones` / `whatsapp_ids`.
- Follow-ups ("kya hua?") and "done / bhej diya" signals as in Gmail. Voice notes: helper sends the .opus file; transcribe (OpenRouter audio-capable model or Sarvam for Hinglish) then extract.
- Task-bot number is **deferred** (no spare number).

## Phase 4 — BUILT AND DEPLOYED (11 Sept 2026); meeting prep moved to Phase 5

1. **Follow-ups page** (`/followups`) — everything others owe Amit, across all
   people, oldest first, split at a configurable staleness threshold. The People
   page answers "what does X owe me"; this answers "who is sitting on something",
   which is the question that actually prompts a chase. Sidebar badge counts only
   items past the threshold. **Confirmed working by Amit.**
2. **Chase drafts** — `/api/ai/draft` writes the nudge, adapting tone to WhatsApp
   vs email. Copy only, never sends: that would need `gmail.compose` and a
   re-consent, and "AI suggests, Amit approves" covers outgoing words too.
   **Confirmed working by Amit.**
3. **Accept & reply** on Review — same endpoint, `kind: "ack"`. Built and
   deployed, **not yet exercised by Amit.** Hidden when the suggestion is a
   commitment THEY made.
4. **Promise tracker, email** (`ingest-promises`, hourly) — built and correct,
   but **~zero value**: 1 sent email in 60 days. Amit does not send from this
   Gmail. Left running; costs nothing when there is nothing to read.
5. **Promise tracker, WhatsApp** — where the value actually is. `ingest-whatsapp`
   v3 splits a batch: others' messages take the task prompt, Amit's own take an
   inverted prompt asking what HE committed to. Bot side shipped the §12 addendum
   (commit `938f0e1`, deployed 14:50 IST) with `fromOwner`. Verified on synthetic
   input; **never seen a real message.**

### Open
- **No real WhatsApp traffic has ever reached Tracker** (Phase 3's open item).
  One message in an enabled group settles both task and promise capture:
  a `Task`-marked line, and one of Amit's own like "kal tak bhej dunga".
- **Ask the bot team:** `client.js` skips `message.fromMe`. If the bot's session
  is linked to Amit's OWN number, his messages are `fromMe` and promise capture
  silently never fires. Expected to be a separate number, but unverified.
- Meeting prep needs Calendar; it is Phase 5 work and was moved there deliberately.

## Phase 4 — original scope notes
- People pages exist (`/people`, `/people/[id]`: I owe them / they owe me, trust level). Add: promise tracker (scan **sent** mail + Amit's own WhatsApp messages for commitments → tasks with `waiting_on_person_id=null`, `person_id=null`, `ai_meta.kind='promise'`), waiting-for chaser drafts after N days (Gmail draft via `gmail.compose` scope — requires re-consent; or copy-to-clipboard), "noted, will do by …" reply drafts on accept, meeting prep view.

## Phase 5 — COMPLETE (11 Sept 2026)

1. **Calendar sync** (`sync-calendar`, every 15 min) — mirrors the primary
   calendar into `calendar_events` using Google's syncToken, so each run moves
   only changes. A 410 (expired token) is routine and falls back to a bounded
   full window. Deletions arrive as `status:cancelled` and are kept so removals
   propagate. Verified against the live calendar.
2. **AI day planner** (`/api/ai/plan`, `/plan`) — proposes blocks around real
   meetings: fills at most 70% of free time, orders overdue → due today →
   promises → priority, 25-90 min blocks, keeps lunch clear, never schedules in
   the past. Declined meetings are not busy time. Hallucinated task ids and
   malformed times are dropped rather than rendered. Writes nothing until
   accepted. **Amit ran it and approved the output.**
3. **Blocks pushed to Google Calendar** (`/api/calendar/block`) — accepted blocks
   become real calendar entries so they appear on his phone and block the slot.
   One entry point handles create/move/remove; `scheduled_at` is the source of
   truth. Unscheduling or completing removes the entry. A calendar failure never
   undoes a plan already accepted in Tracker.
4. **Morning brief + deadline risk** (`src/components/Brief.tsx`) — computed
   locally, not by a model: exact, instant, free. Hides entirely when there is
   nothing to say. Risk compares work due within 48h against working time left
   after meetings.
5. **Meeting prep** (`src/components/MeetingPrep.tsx`) — expand a meeting to see
   attendees matched to people, what is open in both directions, last contact
   and the last thread. Unmatched attendees are listed rather than dropped.
6. **Free gaps + re-plan diff** — what fits before the next meeting (15-120 min
   only), and what a re-plan moved, added or dropped.

### Notes
- Everything above is built and deployed but running on thin data: 2 calendar
  events (no attendees), 1 real Gmail task, 0 real WhatsApp messages. The
  machinery is proven; the judgement calls (70% fill, block lengths, gap bounds,
  staleness thresholds) are guesses until real work flows through. They belong
  in the deferred tuning pass.
- Calendar write uses the scope granted at connect time; no re-consent needed.

## Phase 5 — original scope notes
- Calendar scope is already requested. Two-way Google Calendar sync (`scheduled_at`/`duration_min` ↔ events), AI daily plan filling ~70% of free time (approve → time-block), re-plan diff, deadline-risk warnings, free-gap suggestions, morning brief (email/push; WhatsApp later).

## Phase 6 — AI does the work
- Detect AI-doable tasks; drafts (Gmail drafts), research, summaries; context packet (related `messages` + `task_events`); "ask your tasks" (pgvector + hybrid search, embeddings via OpenRouter).

## Later
WhatsApp task bot, stale-task cleaner / weekly review, MCP server so ChatGPT/Claude can read tasks, native iPhone app, learned estimates, photo-to-task, notification budget.

## Known gaps / notes
- Chrono parses English; Hinglish words are mapped in `src/lib/quickadd.ts` (`HINGLISH` table).
- `people/[id]` trust selector and Review page actions write `people.trust_level`; the edge function honours it.
- Everything is now pushed to GitHub `master` and deployed on Vercel; the live DB has all three migrations and `ingest-gmail` v2.
