# Tracker — project brief for Claude (read this first)

Personal AI task tracker for **Amit Sourav** (Delhi, India). One owner (Amit) plus, since Oct 2026, a team he hands work to. Goal: tasks arrive automatically from the people who send them (Gmail now, WhatsApp next), land in a **Review** inbox, and nothing is added or sent without Amit's approval. Dense, keyboard-driven UI (ClickUp-like). Built to last: plain Postgres as source of truth, swappable AI models, open exports.

Full agreed plan and phases: `docs/PLAN.md`. Current state and remaining steps: `docs/HANDOFF.md` — **read it before doing anything.**

## Amit's preferences (decided, don't re-ask)
- One owner. Since 28 Oct 2026 he can add **team members** (employees) and assign them tasks (decisions on the next line). Still no multi-owner/org features.
- Team decisions (decided 28–30 Oct, don't re-ask): employees have their own login and see **only tasks assigned to them** (never Gmail/WhatsApp/sources/people/signals); employees can add only their own private to-dos; notifications to employees are **email from Amit's Gmail** (gmail.send scope); review = employee sends for review, only Amit (or a lead, then Amit) closes. **Leads**: marked by Amit; can hand work on to anyone on the team (one level: Amit → lead → person), create tasks, invite people, split a task between people, and review before Amit (person → lead → Amit).
- Task sources: WhatsApp (mostly 1:1 chats, allow-list only) and personal Gmail (amitsourav0407@gmail.com). Google Calendar for planning.
- iPhone: web app (Add to Home Screen) first; native later. MacBook is on all day with WhatsApp Desktop.
- AI via **OpenRouter** key stored in `user_secrets` (his own DB), model switchable per feature, monthly spend cap.
- AI suggests, he approves. Per-person trust: `people.trust_level` = review | auto_accept | ignore.
- Working hours: **EOD = midnight**, six-day week (Mon–Sat), "end of week" = Saturday. Timezone Asia/Kolkata. Messages are often Hinglish ("kal tak", "parso", "kya hua?").
- UI: powerful & dense, dark/light, shortcuts. Don't make it minimal.
- Communicate simply — he is not a developer; explain in plain language, give click-by-click steps.

## Stack
- Next.js 16 (App Router, `src/proxy.ts` is the middleware), React 19, Tailwind v4, zustand store (`src/lib/store.ts`), dnd-kit, cmdk, chrono-node (quick-add dates), rrule, lucide.
- Supabase: Postgres 17, RLS per user, Realtime on tasks/projects/people/tags/task_tags/task_comments, pg_cron. Edge functions: `ingest-gmail`, `ingest-whatsapp`, `ingest-promises`, `sync-calendar`, `mcp`, `team-reminders`, `team-notify`. Storage bucket `task-files` (private).
- Vercel (auto-deploys `master` of GitHub `Amitsourav/personal-tracker`).
- Supabase URL/publishable key come from `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`.env.local` locally, Vercel env in production); `src/lib/supabase/env.ts` refuses to start without them. Public by design; RLS protects data. No server secrets in the web app.

## IDs & URLs
- Live app: https://personal-tracker-eta-six.vercel.app
- **Supabase project in use: `gmtjbxblrdhrdrnsbipw`** ("personal tracker", org "Personal Traacekr", region ap-northeast-2, created 17 Sept 2026). Dashboard: https://supabase.com/dashboard/project/gmtjbxblrdhrdrnsbipw. `.env.local` and Vercel point here.
- The original project `iljkjqlwrjkinvloqqgx` (org "amit personal") is **no longer what the app uses** — older notes and early migration comments refer to it.
- Access from Claude: the claude.ai Supabase connector is signed in to a **different account** (sees only "iconiq-crm"/"number tracking") and cannot reach this project. The local Supabase CLI *is* logged in to the right account and linked to `gmtjbxblrdhrdrnsbipw` — use it for `supabase functions deploy <name> --no-verify-jwt --project-ref gmtjbxblrdhrdrnsbipw`.
- Vercel project: `personal-tracker` in team `amit-souravs-projects` (Hobby).
- GitHub: https://github.com/Amitsourav/personal-tracker (branch `master`).

## Conventions
- Schema changes: write a file in `supabase/migrations/` AND get it applied. Since Oct 2026 **Amit pastes the SQL** into the dashboard SQL editor (copy the file to his clipboard with `pbcopy`, give him the link + click-by-click). **Do not use `supabase db push`**: remote history holds MCP-era timestamp versions that don't match the local filenames, so it would try to re-run everything from the core schema. Verify a migration landed by probing with the publishable key (new RPCs should answer 42501 "permission denied" to anon; new tables answer `[]`).
- Edge functions live in `supabase/functions/<name>/index.ts`; deploy with the CLI (see IDs above). All are `--no-verify-jwt` and check auth themselves (sync token = `user_secrets.whatsapp_token` via `user_by_sync_token`, or the service key; `team-notify` also accepts any signed-in user's JWT).
- **Team privacy rule**: employees get NO row-level policies on `tasks`, `task_comments` or `task_attachments`. Every read/write they make goes through security-definer functions (`member_*`, `lead_*`, `claim_team_invites`) that return fixed columns. Postgres can't hide columns per policy, so adding a member policy on `tasks` would leak `source_quote`/`ai_meta`. Keep it that way.
- Emails to team members: from Amit's session via `/api/team/email`; anything a member/lead triggers is queued in `team_outbox` and sent by `team-notify` (poked from the app, plus a 5-min cron). All carry an `X-Tracker` header, which `ingest-promises` skips.
- Every task change goes through `store.ts` so the `task_events` history log and Realtime stay correct. Soft-delete (`deleted_at`), never hard-delete tasks.
- AI calls: always log to `ai_usage` and respect `user_secrets.monthly_cap_usd` (see `month_spend()`). Redact OTPs/account numbers before sending text to a model.
- Suggested tasks: `review_state='suggested'`, `status='inbox'`, with `source_kind/source_ref/source_link/source_quote/confidence/ai_meta` filled so the Review page can show why.
- `npm run lint && npm run build` must pass before pushing. Commit messages end with a `Co-Authored-By: Claude <noreply@anthropic.com>` line.
