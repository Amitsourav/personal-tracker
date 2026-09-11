# Brief: forward task messages from `whatsappbot` to Tracker

**Paste this file into the `Amitsourav/whatsappbot` repo and implement it there.**
Nothing in this document requires changes to Tracker — the receiving end is built,
deployed and tested.

---

## 1. What this is

`whatsappbot` is a Baileys bot that captures loan leads from WhatsApp groups into a
CRM. It works and it is business-critical.

**Tracker** is Amit's personal task app (Next.js + Supabase). It already captures
tasks from Gmail: mail arrives, an AI decides whether someone is asking Amit to do
something, and anything it finds lands in a **Review** inbox that Amit approves or
rejects. Nothing enters his task list without approval.

**The job:** in groups Amit switches on, forward messages to Tracker so the same
thing happens for WhatsApp. Amit is tagged in 2–3 work groups and those tasks are
currently only in his head.

This adds a **second destination**. It does not change lead capture, detection, CRM
calls, replies, or anything a group sees.

## 2. Hard rules

These are not preferences.

1. **Lead capture must never break.** Every Tracker code path is wrapped so a
   failure — network, bad response, bug — is logged and swallowed. A Tracker
   outage must be invisible to lead capture.
2. **Never block the message handler.** Queue and flush on a timer. Do not `await`
   a network call inside `Orchestrator.handle()`.
3. **Off by default.** New config is optional; a group forwards only when its
   `tracker_enabled` flag is on. A deploy with no config change must behave
   exactly as today.
4. **Never post in a group because of Tracker.** No replies, no reactions, no
   acknowledgements. Silent.
5. **Do not touch** `leads`, `lead_updates`, `detect.js`, `crm/`, or `replies.js`.
6. **Record before sending**, the same rule the lead pipeline follows — a restart
   or a redelivery must not drop or duplicate.

## 3. The Tracker endpoint (already live)

```
POST https://iljkjqlwrjkinvloqqgx.supabase.co/functions/v1/ingest-whatsapp
Authorization: Bearer <TRACKER_TOKEN>
Content-Type: application/json
```

### Request

```jsonc
{
  "group": { "id": "120363...@g.us", "name": "Partner — ABC Finance" },
  "messages": [
    {
      "id": "3EB0...",            // WhatsApp message id — the dedupe key, required
      "text": "@Amit draft kal tak bhej dena",
      "senderPhone": "+919000000002", // E.164, LIDs already resolved
      "senderName": "Priya",
      "timestamp": 1789077000,        // UNIX SECONDS, not milliseconds
      "mentionedMe": true,            // an @mention resolved to TRACKER_OWNER_PHONE
      "isReplyToMe": false,           // reply to a message Amit sent
      "quotedText": null              // text of the quoted message, if any
    }
  ]
}
```

- Max **40 messages** per POST; extras are ignored, so send in batches of ≤ 40.
- Only `id`, `text`, `timestamp` are strictly required. The flags are what make
  extraction accurate — send them.
- Messages with empty `text` are dropped by Tracker; don't bother sending them.

### Response

```jsonc
{ "fetched": 4, "candidates": 4, "created_tasks": 1, "error": null }
```

| Status | Meaning | What to do |
|---|---|---|
| 200 | Accepted (even `created_tasks: 0` — usually nothing was a task) | mark sent |
| 401 | Bad or missing token | stop; log loudly; do not retry in a loop |
| 400 | Malformed body | log the payload, mark failed, do not retry |
| 5xx / network | Tracker down | retry with backoff |

Tracker deduplicates on `(user, channel, message id)`, so **re-sending the same
message is safe** — it will not create the task twice. Prefer retrying over
dropping.

Tracker redacts OTPs and account numbers itself, so no need to pre-redact.

## 4. Config (`src/config.js`)

Follow the existing pattern — read from `process.env` only in this file.

```js
tracker: {
  url: process.env.TRACKER_URL || '',
  token: process.env.TRACKER_TOKEN || '',
  // Amit's WhatsApp number. Used to tell "tagged me" from "tagged someone else".
  ownerPhone: process.env.TRACKER_OWNER_PHONE || '+917004428198',
  flushMs: int(process.env.TRACKER_FLUSH_MS, 60_000),
  batchSize: int(process.env.TRACKER_BATCH_SIZE, 20)
}
```

Add to `validate()` as a **warning, never fatal**:

> `TRACKER_URL` / `TRACKER_TOKEN` not set — WhatsApp task capture is off.

Railway values (set these when deploying):

| Variable | Value |
|---|---|
| `TRACKER_URL` | `https://iljkjqlwrjkinvloqqgx.supabase.co/functions/v1/ingest-whatsapp` |
| `TRACKER_TOKEN` | *(Amit will paste it — it is in Tracker's `user_secrets.whatsapp_token`)* |
| `TRACKER_OWNER_PHONE` | `+917004428198` |

## 5. Database (`src/db/schema.js`)

**Append** a migration. Never edit an existing one.

```js
{
  name: '0NN_tracker_outbox',
  sql: `
    -- Groups whose messages are forwarded to Tracker (Amit's task app).
    -- Deliberately separate from is_active: a group can feed Tracker without
    -- being a lead group, and a lead group need not feed Tracker.
    ALTER TABLE groups ADD COLUMN tracker_enabled INTEGER NOT NULL DEFAULT 0;

    -- Queue of messages owed to Tracker. Written before any network call, so a
    -- restart or an outage is a delay rather than a loss.
    CREATE TABLE tracker_outbox (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_message_id TEXT    NOT NULL UNIQUE,
      group_id      INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      wa_group_id   TEXT    NOT NULL,
      group_name    TEXT,
      payload       TEXT    NOT NULL,   -- the message object, JSON
      status        TEXT    NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sent','failed')),
      attempts      INTEGER NOT NULL DEFAULT 0,
      last_error    TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      sent_at       TEXT
    );

    CREATE INDEX idx_tracker_outbox_pending
      ON tracker_outbox(status, wa_group_id) WHERE status = 'pending';
  `
}
```

`wa_message_id UNIQUE` makes WhatsApp redelivery a no-op — same trick as `leads`.

Add to `src/db/repositories.js`, matching the existing style:

- `trackerOutbox.enqueue({ waMessageId, groupId, waGroupId, groupName, payload })`
  → `INSERT ... ON CONFLICT(wa_message_id) DO NOTHING`; return null if already queued
- `trackerOutbox.pending(limit)` → oldest pending, grouped by `wa_group_id`
- `trackerOutbox.markSent(ids)` / `markFailed(id, error)` / `recordAttempt(id)`
- `groups.setTrackerEnabled(id, enabled)`

## 6. Which messages to forward

In `Orchestrator.handle()`, **after** `repo.groups.upsert(...)` and the watermark
write, and **before** the `if (!group.is_active) return;` line — a group can feed
Tracker without being a lead group:

```js
try {
  tracker.maybeQueue(message, group);
} catch (error) {
  logger.warn(`Tracker queue failed for ${message?.id}: ${error.message}`);
}
```

Note it is **outside** the `is_active` check and **wrapped**. `maybeQueue` is
synchronous (a SQLite insert) — no `await`, so the lead path is not delayed.

`maybeQueue` forwards only when **all** of these hold:

- `group.tracker_enabled` is 1
- `config.tracker.url` and `config.tracker.token` are set
- `message.isGroup` is true
- `message.fromMe` is false
- `message.text` is non-empty
- the sender is **not** Amit himself (`same(senderPhone, ownerPhone)`) — his own
  messages are promises, not tasks; that is Tracker's Phase 4
- `commands.parse(message.text)` returns nothing (`/help` etc. are not tasks)
- `noise.classify(message.text).isNoise` is false (drops "ok", "done", "thik hai")

…**and at least one** of:

1. `mentionedMe` — `message.mentions.some(p => same(p, config.tracker.ownerPhone))`
2. `isReplyToMe` — the quoted message was sent by Amit (see §7)
3. the text looks task-shaped — a small keyword test, case-insensitive:

```js
const TASKISH = /\b(bhej|bhejna|bhej dena|kar dena|karna hai|kar do|dekh lena|dekh lo|check kar|send|share|update|pending|follow ?up|kya hua|reminder|complete|submit|draft|prepare|arrange|confirm|kal tak|aaj tak|parso|eod|asap|urgent)\b/i;
```

Rule 3 is deliberately loose; Tracker's AI is the real filter and it is strict
(anything below 0.35 confidence is discarded, and messages aimed at other people
are ignored). The keyword test exists only to keep pure banter out of the AI and
off the bill.

`same()` compares phone numbers ignoring `+`, spaces and a missing country code —
match the last 10 digits when both are ≥ 10 long.

## 7. `isReplyToMe` — one small addition to `messages.js`

`contextInfo.participant` holds the author of the quoted message. `normalise()`
does not currently capture it. Add it:

```js
quotedAuthorJid: context?.participant || null,
```

Then in `client.js` `prepareAndEmit()`, resolve it if it is a LID (reuse
`resolveLids`), setting `message.quotedAuthorPhone`. Best effort — if it cannot be
resolved, leave it null and `isReplyToMe` is false. Rules 1 and 3 still work, so
this must not throw or delay the message.

## 8. `src/tracker/client.js`

A queue plus a flush timer, modelled on `RetryWorker` (`src/pipeline/worker.js`).

```
maybeQueue(message, group)    // sync; applies §6 and inserts into tracker_outbox
start() / stop()              // setInterval(flushMs), timer.unref()
flush()                       // called by the timer
```

`flush()`:

1. Read up to `batchSize` pending rows **grouped by `wa_group_id`** — one POST per
   group, because Tracker extracts per conversation and mixing groups would
   confuse it
2. POST the batch with a **10-second timeout** (`AbortSignal.timeout`)
3. `200` → `markSent(ids)`
4. `401`/`400` → `markFailed`, log loudly, and **stop the timer** on 401 (a bad
   token will not fix itself; retrying forever just makes noise)
5. network/`5xx` → `recordAttempt`, leave pending; after 8 attempts `markFailed`
   (same ceiling as `MAX_ATTEMPTS` in the orchestrator)
6. Never throw out of `flush()` — wrap the whole body

Start it in `src/index.js` next to the retry worker, **only if** `tracker.url` and
`tracker.token` are set. Log one line at boot: which groups are enabled, or that
capture is off.

## 9. Admin panel

In `src/api/server.js` and `web/index.html`, add a **"Send tasks to Tracker"**
toggle per group in the existing groups table, calling `groups.setTrackerEnabled`.
Independent of the existing active/sending switches.

Nice to have: a small counter of pending/sent/failed outbox rows.

## 10. Tests

Match the existing `node --test` style in `test/`:

- `maybeQueue` skips: tracker disabled group, `fromMe`, Amit's own message,
  noise, commands, empty text, non-group
- `maybeQueue` queues: tagged, reply-to-me, task-shaped keyword
- enqueueing the same `wa_message_id` twice inserts one row
- `flush` marks sent on 200, retries on 500, stops on 401 (stub `fetch`)
- a throwing `fetch` does not propagate out of `flush`
- **an orchestrator test proving a Tracker failure does not affect lead creation**

## 11. Rollout

1. Merge with no Railway variables set → behaviour identical to today. Verify
   leads still flow.
2. Set the three variables; redeploy. Still nothing forwards — every group has
   `tracker_enabled = 0`.
3. Add the bot to Amit's 2 work groups. They appear in the panel, inactive.
4. Turn on **Send tasks to Tracker** for **one** group. Leave lead capture off.
5. Watch: bot logs, `tracker_outbox`, and Tracker's Review page.
6. If it looks right, enable the rest.

Rolling back is turning the toggles off. Nothing is destructive.

## 12. Definition of done

- A tagged message in an enabled group appears in Tracker's Review within ~60s
- A message tagging someone else does not
- "ok" / "done" / "thik hai" do not
- A lead message in the internal group still reaches the CRM, unchanged
- Tracker being unreachable produces warnings and a growing outbox, and **zero**
  impact on lead capture
- All groups off → no outbound Tracker traffic at all
