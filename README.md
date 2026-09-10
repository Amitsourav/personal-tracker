# Tracker

Personal AI task tracker. See [docs/PLAN.md](docs/PLAN.md) for the agreed plan and phases.

## Run locally

```bash
npm install
npm run dev
```

Supabase URL and publishable key default to the project in `src/lib/supabase/env.ts`; override with `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` if needed.

## Keyboard

`N` new task · `⌘K` commands · `J/K` move · `↵` open · `X` complete · `1–4` priority · `T/M/W` due today/tomorrow/next week · `G then T/U/I/A/P/L` go to view
