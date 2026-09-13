# Tracker

**Your tasks, from the people who give you work.**

Most task apps assume you already know what you have to do, and ask you to type
it in. In practice the work arrives in email and WhatsApp, written by other
people, in the middle of a conversation — and typing it in again is the step
everyone skips.

Tracker reads those messages, pulls out the things that are actually yours to
do, and puts them in a queue for you to accept or reject. Nothing is ever added
without you saying yes. Nothing is ever sent on your behalf.

It is a single-user app by design: every account is its own walled tracker, with
its own AI key and its own connections. You run it for yourself.

---

## What it does

### Capture — work finds its way in

| | |
|---|---|
| **Gmail** | Checks every 5 minutes. Filters newsletters, promotions, no-reply senders and anything you've muted, then reads what's left for real requests. |
| **WhatsApp groups** | Via a companion bot. Picks up messages that tag you, reply to you, or use your team's `Task` convention. |
| **Voice notes** | Transcribed on the way in — Hindi, English or Hinglish — then treated like any other message. |
| **Your own promises** | Reads what *you* said in a group. "kal bhej dunga" becomes a task, because someone is now waiting on you. |
| **Calendar** | Two-way sync with Google Calendar for time blocking. |
| **By hand** | Quick-add understands `kal tak`, `p1`, `#project`, `@tag`, `from:Deepak`, `~30m`, `every monday`. |

Everything captured lands in **Review** as a suggestion, with the sentence that
produced it and how confident the model was. You accept or reject. Per person,
you can set *always accept* or *ignore*.

### Understand — not everything is a task

One message in nine is something you have to do. The rest still matters.

Every incoming message is sorted into one of nine kinds — task, commitment,
request, decision, event, risk, opportunity, information, noise. Only **task**
creates a task. The middle seven appear on the **Signals** page: a decision
someone needs from you, a date that moved, a number worth remembering. Noise is
filed and hidden, kept only so you can audit what the filter threw away.

### Know where you stand

- **Why this is here** — every AI-created task shows the quote it came from, where it came from, and its confidence in words, not a percentage
- **Done, but not confirmed** — ticking a box records that *you* think it's finished, not that the person who asked received anything. Those are different facts and Tracker keeps them apart
- **Risks** — what is about to go wrong: promises going stale, overdue work with no time set aside, an overloaded day, capture that has quietly stopped
- **Since you last looked** — what changed while you were away
- **Follow-ups** — who owes you what, and for how long, with a drafted chase message you can edit before sending

### Plan

Day planner, free-gap suggestions, meeting prep from your calendar and contacts,
a morning brief, and a **planned date** that is deliberately separate from a due
date — because "when I intend to get to this" and "when someone is waiting for
it" are not the same thing, and treating them as one makes the overdue count
meaningless.

### The tracker itself

Tasks, subtasks, projects, tags, people, recurring rules. List, table, board and
calendar views. Today, Upcoming, Inbox, All, Logbook, saved views. ⌘K command
bar, full keyboard control, PWA install, dark and light, JSON and CSV export.

### Cost control

You bring your own [OpenRouter](https://openrouter.ai) key and set a monthly cap.
Every AI call is logged with its token count and price. When the cap is reached,
capture stops rather than quietly spending more. Reading and planning use
different models, both switchable.

---

## Privacy

Worth being explicit, because this app reads your mail.

- **Your data lives in your own Supabase project.** Not ours. There is no shared server.
- **Row-level security** is enforced by the database, not by application code. One account cannot read another's rows even if the app has a bug.
- **OTPs, long numbers and IFSC codes are stripped** before any text is sent to a model.
- **Message bodies are deleted after 30 days** by a scheduled job. The task survives; the email doesn't.
- **Nothing is sent on your behalf.** Drafts are drafts until you press send.
- **Your API keys are yours** — stored in your database, used only by your account.

---

## Stack

Next.js 16 (App Router) · React 19 · Tailwind v4 · zustand · Supabase
(Postgres 17, RLS, Realtime, Edge Functions, pg_cron) · OpenRouter for models ·
Vercel.

---

## Setting it up

You need three free accounts: **Supabase**, **Vercel**, and **OpenRouter**
(pay-as-you-go, a few dollars lasts a long time). Budget about an hour. The
Google steps are the fiddly part.

### 1. The database

Create a project at [supabase.com](https://supabase.com), then:

```bash
git clone https://github.com/Amitsourav/personal-tracker.git
cd personal-tracker
npm install

supabase link --project-ref <your-project-ref>
supabase db push          # applies everything in supabase/migrations/
```

No CLI? Paste each file in `supabase/migrations/` into the SQL editor, in
filename order.

> Migrations `0012` and `0014` insert tasks from the author's own work. Skip
> them — they are kept as a record, not as schema.

### 2. Edge functions

```bash
supabase functions deploy ingest-gmail     --no-verify-jwt
supabase functions deploy ingest-whatsapp  --no-verify-jwt
supabase functions deploy ingest-promises  --no-verify-jwt
supabase functions deploy sync-calendar    --no-verify-jwt
```

They authenticate with a per-user token checked inside the function, which is
why JWT verification is off.

### 3. The app

```bash
cp .env.example .env.local   # or create it
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```

Both are in Supabase → Project Settings → API.

> **Set these before deploying anywhere.** `src/lib/supabase/env.ts` falls back
> to the author's project if they're missing, so a fresh clone will silently
> talk to the wrong database.

```bash
npm run dev     # http://localhost:3000
```

Deploy by importing the repo into Vercel and adding the same two variables.

### 4. Login

In Supabase → Authentication → URL Configuration, set **Site URL** to your
deployed domain and add `https://your-app.vercel.app/auth/callback` to redirect
URLs.

Magic-link email works out of the box but Supabase's built-in sender allows only
a couple of emails per hour. **Enable Google sign-in** (Authentication → Sign In
/ Providers) or configure real SMTP before relying on it.

### 5. Scheduled capture

In the SQL editor:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('ingest-gmail-every-5-min', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://<your-ref>.supabase.co/functions/v1/ingest-gmail',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select whatsapp_token from public.user_secrets
                                     where whatsapp_token is not null limit 1)),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$job$);
```

Same shape for `ingest-promises` (hourly) and `sync-calendar` (every 15 min).
The token is read at run time, so rotating it needs no reschedule.

> `cron.job_run_details.status` says the request was **sent**, not that it was
> accepted. Always confirm against the `sync_runs` table. A silently failing cron
> that reports success cost this project a day.

### 6. In the app

Sign in, then open **Settings**:

1. Paste your **OpenRouter key** and set a monthly cap
2. Create a Google Cloud OAuth client (Web application), add
   `https://your-app.vercel.app/api/google/callback` as a redirect URI, and paste
   the client ID and secret
3. Click **Connect Gmail & Calendar**

Scopes used: `gmail.readonly`, `calendar`, `email`. Read-only on mail — Tracker
cannot send email as you.

Your Google app starts in Testing mode, where tokens expire after 7 days. Add
yourself as a test user to begin with; publish it when you're ready for a token
that lasts.

### 7. WhatsApp (optional)

Needs a companion bot running [Baileys](https://github.com/WhiskeySockets/Baileys).
The full specification — what to send, when to send it, dedupe rules, voice
notes — is in [docs/WHATSAPP-BOT-INTEGRATION.md](docs/WHATSAPP-BOT-INTEGRATION.md).

Your endpoint token:

```sql
select whatsapp_token from user_secrets;
```

> **Be aware:** logging a bot into WhatsApp as a user is against WhatsApp's terms
> and the number can be banned. The official Business API cannot read group
> messages at all, so there is no compliant version of this feature. Use it on a
> number you can afford to lose, and understand the trade.

---

## Keyboard

`N` new task · `⌘K` commands · `J` `K` move · `↵` open · `X` complete ·
`1`–`4` priority · `T` `M` `W` due today / tomorrow / next week ·
`G` then `T` `U` `I` `A` `P` `L` jump to a view

---

## Known gaps

Stated plainly, because a README that only lists wins is a sales page.

- Calendar edits don't flow back — move a block in Google Calendar and Tracker keeps the old time
- The WhatsApp bot only forwards a message if it tags you, replies to you, or starts with `Task`. A numbered list continued across messages is missed
- Group enable/disable is SQL-only; there's no settings screen for it
- A brand-new account lands in an empty app with no onboarding
- Meeting prep, calendar blocking and re-plan diffs are built but lightly tested

More detail, and what's been proven versus merely built, in
[docs/HANDOFF.md](docs/HANDOFF.md).

---

## Documentation

| | |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | The phases and what each contains |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Current state, open questions, what is and isn't tested |
| [docs/WHATSAPP-BOT-INTEGRATION.md](docs/WHATSAPP-BOT-INTEGRATION.md) | The bot specification |

---

Built for one person's real workload, in the open. If you fork it, the
interesting part isn't the task list — it's the Review queue, and the decision
that a machine reading your mail should never act without being told to.
