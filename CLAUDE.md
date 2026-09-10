# Tracker — project brief for Claude (read this first)

Personal AI task tracker for **Amit Sourav** (Delhi, India). Single user. Goal: tasks arrive automatically from the people who send them (Gmail now, WhatsApp next), land in a **Review** inbox, and nothing is added or sent without Amit's approval. Dense, keyboard-driven UI (ClickUp-like). Built to last: plain Postgres as source of truth, swappable AI models, open exports.

Full agreed plan and phases: `docs/PLAN.md`. Current state and remaining steps: `docs/HANDOFF.md` — **read it before doing anything.**

## Amit's preferences (decided, don't re-ask)
- Just him. No team features, no multi-tenant concerns beyond RLS.
- Task sources: WhatsApp (mostly 1:1 chats, allow-list only) and personal Gmail (amitsourav0407@gmail.com). Google Calendar for planning.
- iPhone: web app (Add to Home Screen) first; native later. MacBook is on all day with WhatsApp Desktop.
- AI via **OpenRouter** key stored in `user_secrets` (his own DB), model switchable per feature, monthly spend cap.
- AI suggests, he approves. Per-person trust: `people.trust_level` = review | auto_accept | ignore.
- Working hours: **EOD = midnight**, six-day week (Mon–Sat), "end of week" = Saturday. Timezone Asia/Kolkata. Messages are often Hinglish ("kal tak", "parso", "kya hua?").
- UI: powerful & dense, dark/light, shortcuts. Don't make it minimal.
- Communicate simply — he is not a developer; explain in plain language, give click-by-click steps.

## Stack
- Next.js 16 (App Router, `src/proxy.ts` is the middleware), React 19, Tailwind v4, zustand store (`src/lib/store.ts`), dnd-kit, cmdk, chrono-node (quick-add dates), rrule, lucide.
- Supabase: Postgres 17, RLS per user, Realtime on tasks/projects/people/tags/task_tags, Edge Function `ingest-gmail`, pg_cron.
- Vercel (auto-deploys `master` of GitHub `Amitsourav/personal-tracker`).
- Supabase URL/publishable key have safe defaults in `src/lib/supabase/env.ts` (public by design; RLS protects data). No other env vars needed.

## IDs & URLs
- Live app: https://personal-tracker-eta-six.vercel.app
- Supabase project: `iljkjqlwrjkinvloqqgx` (org "amit personal", region ap-northeast-2). Dashboard: https://supabase.com/dashboard/project/iljkjqlwrjkinvloqqgx
- Vercel project: `personal-tracker` in team `amit-souravs-projects` (Hobby).
- GitHub: https://github.com/Amitsourav/personal-tracker (branch `master`).

## Conventions
- Schema changes: write a file in `supabase/migrations/` AND apply it (Supabase MCP `apply_migration`, or `supabase db push`). Migrations so far were applied via MCP; the files are the record.
- Edge functions live in `supabase/functions/<name>/index.ts`; deploy with Supabase MCP `deploy_edge_function` or `supabase functions deploy <name>`.
- Every task change goes through `store.ts` so the `task_events` history log and Realtime stay correct. Soft-delete (`deleted_at`), never hard-delete tasks.
- AI calls: always log to `ai_usage` and respect `user_secrets.monthly_cap_usd` (see `month_spend()`). Redact OTPs/account numbers before sending text to a model.
- Suggested tasks: `review_state='suggested'`, `status='inbox'`, with `source_kind/source_ref/source_link/source_quote/confidence/ai_meta` filled so the Review page can show why.
- `npm run lint && npm run build` must pass before pushing. Commit messages end with a `Co-Authored-By: Claude <noreply@anthropic.com>` line.
