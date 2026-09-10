# Tracker — Build Plan

Personal AI task tracker for Amit. Captures tasks automatically from the people who send them (WhatsApp, Gmail), with a review inbox where nothing is added until approved.

Research brief: https://claude.ai/code/artifact/d04d315c-11ec-4a94-ada2-7b5e4d071f83
Build plan page: https://claude.ai/code/artifact/2007566b-4463-4873-bf96-9dbd4cbe03c2

## Agreed setup

| Decision | Choice |
|---|---|
| Users | Just Amit (personal). No team features, no Google audit. |
| Task sources | WhatsApp (mostly 1:1 chats) and personal Gmail |
| WhatsApp route | Read-only helper on the MacBook (WhatsApp Desktop's local database). Only chats Amit chooses. Task-bot number deferred (no spare number). |
| Calendar | Google Calendar |
| Phone | iPhone — web app (Add to Home Screen) first, native app later |
| AI | OpenRouter key; model switchable per feature; monthly spend cap |
| AI control | Suggest, Amit approves. Trusted senders can be auto-accepted later. |
| Working hours | EOD = midnight; six-day week (Mon–Sat), so "end of week" = Saturday |
| UI | Powerful & dense (ClickUp-like), keyboard-driven, dark/light |
| Login | Google sign-in (magic link until the Google OAuth client exists) |

## Version 1 features

**Capture & review inbox** — WhatsApp chats read from the Mac (allow-list), Gmail read as mail arrives, voice-note capture, Hinglish/office-speak deadlines (kal tak, parso, EOD, EOW), duplicate merging across channels, follow-up detection ("kya hua?") raises priority, "done / bhej diya" suggests closing, every task links back to its source message.

**Task workspace (dense)** — list, table (inline edit), board, calendar, Today, Upcoming; projects, sub-tasks, tags, priorities, custom fields, repeating tasks; saved filters incl. plain-English filters; ⌘K command bar and shortcuts; split view with task detail + source; quick add ("call Rohit tmrw 3pm p1 #clientX"); dark/light; Mac + iPhone.

**People & follow-ups** — page per person (what I owe them / what they owe me / last contact); one identity across WhatsApp + email; promise tracker from sent messages; waiting-for with drafted chaser after N days; "noted, will do by Wed" reply drafts; meeting prep.

**Smart planning** — two-way Google Calendar sync; AI daily plan filling ~70% of free time, approved then time-blocked; re-plan showing what moves; deadline-risk warnings; morning brief; free-gap suggestions.

**AI does the work** — detects AI-doable tasks (drafts, replies, research, summaries); Gmail drafts and pre-filled WhatsApp replies; context packet on opening a task; "ask your tasks" with links.

**Trust & control** — AI action log with undo; model per job + spend cap; OTPs/account numbers redacted before AI; nightly export to Google Drive in open formats.

## Build phases

0. **Setup** — Supabase (org "amit personal", project iljkjqlwrjkinvloqqgx), Vercel, Google Cloud OAuth (Gmail + Calendar), OpenRouter key, Full Disk Access for the Mac helper.
1. **The tracker itself** — tasks, projects, all views, command bar, shortcuts, quick add; login; installable. *(this commit)*
2. **Gmail capture + review inbox** — Gmail connection, filtering, AI extraction, Hinglish dates, duplicate merging; review inbox; tuned on ~100 real emails.
3. **WhatsApp capture** — Mac helper (read-only, every minute), allow-list, voice notes; tuned on real Hinglish chats.
4. **People & follow-ups** — people pages, identity merging, promise tracker, waiting-for, chasers, "noted" replies.
5. **Smart planning** — Calendar sync, AI daily plan, time-blocking, re-planning, deadline risk, free gaps, morning brief.
6. **AI does the work** — AI-doable task detection, drafts, research, summaries; context packet; ask your tasks.

Each phase ends with something usable; Amit approves before the next starts.

## Later versions

- WhatsApp task bot (when a spare number exists) + morning brief on WhatsApp
- Stale-task fighting: stale scores, weekly clean-up wizard, procrastination doctor, guided weekly review
- Use from ChatGPT / Claude (MCP server)
- Native iPhone app (widgets, share sheet, Siri)
- Learned time estimates and peak hours
- Photo-to-task, meeting-notes import
- Notification budget and location/context triggers

## Tech

- **Database & auth:** Supabase (Postgres 17, RLS per user, realtime, append-only `task_events` history for undo/analytics/learning)
- **App:** Next.js 16 (App Router) on Vercel, Tailwind v4, zustand, dnd-kit, cmdk, chrono-node, rrule
- **AI:** OpenRouter via a provider-agnostic layer (Phase 2)
- **Background:** Supabase cron/queues; Railway only if long jobs need it
- **Mac helper:** small background process reading WhatsApp Desktop's local database, read-only (Phase 3)

## Running cost (once live)

Supabase $0→$25 · Vercel $0 · Railway $0–5 · OpenRouter $5–20 · **≈ $30–50/month (₹2,500–4,500)**
