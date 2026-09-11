// Supabase Edge Function: reads Amit's SENT mail and files the promises he made
// to other people as suggestions.
//
// Inbox capture answers "what is someone asking me to do". This answers the
// question nothing else can see: "what did I say I would do". Those are the
// commitments that get forgotten, because nobody is chasing them yet.
//
// Runs hourly, not every five minutes: a promise is not urgent the minute it is
// made, and one AI call per sent email is the expensive part.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_PER_RUN = 15;

type Secrets = {
  user_id: string; openrouter_key: string | null; model_extract: string; monthly_cap_usd: number;
  google_client_id: string; google_client_secret: string; google_refresh_token: string;
  google_email: string | null; promises_enabled: boolean; gmail_sent_last_at: string | null;
};
type Person = { id: string; name: string; emails: string[]; trust_level: string };
type OpenTask = { id: string; title: string; person_id: string | null; due_at: string | null };
type Mail = {
  id: string; threadId: string; toEmail: string; toName: string; cc: string;
  subject: string; date: string; body: string; labels: string[];
};

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization")?.replace(/^Bearer /i, "").trim() ?? "";
  if (!auth) return json({ error: "unauthorized" }, 401);
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let userIds: string[] = [];
  if (auth === SERVICE_KEY) {
    const { data } = await db.from("user_secrets").select("user_id")
      .eq("promises_enabled", true).not("google_refresh_token", "is", null).not("openrouter_key", "is", null);
    userIds = (data ?? []).map((r: { user_id: string }) => r.user_id);
  } else {
    const { data: uid } = await db.rpc("user_by_sync_token", { tok: auth });
    if (!uid) return json({ error: "unauthorized" }, 401);
    userIds = [uid as string];
  }

  const body = await req.json().catch(() => ({}));
  const days = Number(body?.days) > 0 ? Math.min(Number(body.days), 90) : undefined;

  const results: Record<string, unknown>[] = [];
  for (const uid of userIds) {
    try { results.push(await runForUser(db, uid, days)); }
    catch (e) { console.error("ingest-promises", uid, e); results.push({ user: uid, error: String(e) }); }
  }
  return json(results.length === 1 ? results[0] : { runs: results });
});

async function runForUser(db: SupabaseClient, uid: string, override?: number) {
  const { data: s } = await db.from("user_secrets").select("*").eq("user_id", uid).single();
  const sec = s as Secrets;
  if (!sec?.promises_enabled) return { skipped: "promises disabled" };
  if (!sec.google_refresh_token) return { error: "Gmail not connected" };
  if (!sec.openrouter_key) return { error: "No OpenRouter key" };

  const { data: run } = await db.from("sync_runs").insert({ user_id: uid, channel: "gmail" }).select("id").single();
  const finish = async (patch: Record<string, unknown>) => {
    await db.from("sync_runs").update({ finished_at: new Date().toISOString(), ...patch }).eq("id", run!.id);
    return { fetched: 0, candidates: 0, created_tasks: 0, ...patch };
  };

  const { data: spend } = await db.rpc("month_spend", { uid });
  if (Number(spend ?? 0) >= Number(sec.monthly_cap_usd)) {
    return finish({ error: `Monthly AI cap of $${sec.monthly_cap_usd} reached` });
  }

  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: sec.google_client_id, client_secret: sec.google_client_secret,
      refresh_token: sec.google_refresh_token, grant_type: "refresh_token",
    }),
  });
  const tok = await tokRes.json();
  if (!tok.access_token) return finish({ error: `Google token: ${tok.error_description ?? tok.error ?? "failed"}` });
  const g = (path: string, params: Record<string, string> = {}) =>
    fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}?${new URLSearchParams(params)}`,
      { headers: { Authorization: `Bearer ${tok.access_token}` } }).then(r => r.json());

  // Gmail's date operators take whole days, so the watermark is only a coarse
  // filter; messages.external_id is what actually prevents reprocessing.
  // A caller may override the window to backfill: POST {"days": 30}.
  const sinceDays = override ?? (sec.gmail_sent_last_at
    ? Math.max(1, Math.ceil((Date.now() - new Date(sec.gmail_sent_last_at).getTime()) / 86_400_000) + 1)
    : 30);
  // labelIds is authoritative. `in:sent` as a search operator is easy to get
  // subtly wrong, and a silent empty result looks identical to "nothing sent".
  const list = await g("messages", {
    labelIds: "SENT", q: `newer_than:${Math.min(sinceDays, 90)}d`, maxResults: "60",
  });
  if (list.error) return finish({ error: `Gmail list: ${list.error.message ?? "failed"}` });
  let ids: string[] = (list.messages ?? []).map((m: { id: string }) => m.id);
  if (!ids.length) {
    await db.from("user_secrets").update({ gmail_sent_last_at: new Date().toISOString() }).eq("user_id", uid);
    return finish({ fetched: 0 });
  }

  const { data: seen } = await db.from("messages").select("external_id")
    .eq("user_id", uid).eq("channel", "gmail").in("external_id", ids);
  const seenSet = new Set((seen ?? []).map((r: { external_id: string }) => r.external_id));
  ids = ids.filter(id => !seenSet.has(id)).slice(0, MAX_PER_RUN * 2);
  if (!ids.length) {
    await db.from("user_secrets").update({ gmail_sent_last_at: new Date().toISOString() }).eq("user_id", uid);
    return finish({ fetched: 0 });
  }

  const { data: peopleRows } = await db.from("people").select("id,name,emails,trust_level").eq("user_id", uid);
  const people = (peopleRows ?? []) as Person[];
  const { data: profile } = await db.from("profiles").select("*").eq("id", uid).single();
  const selfEmail = (sec.google_email ?? "").toLowerCase();

  const candidates: Mail[] = [];
  let fetched = 0;
  for (const id of ids) {
    const m = await g(`messages/${id}`, { format: "full" });
    if (!m.payload) continue;
    fetched++;
    const mail = parseSent(m);

    let skip: string | null = null;
    if (!mail.toEmail) skip = "no recipient";
    else if (mail.toEmail === selfEmail) skip = "note to self";
    else if (/no-?reply|donotreply|support@|billing@|@notify\./i.test(mail.toEmail)) skip = "automated recipient";
    else if (mail.body.trim().length < 25) skip = "too short to contain a promise";

    await db.from("messages").upsert({
      user_id: uid, channel: "gmail", external_id: mail.id, thread_id: mail.threadId,
      is_outgoing: true, sender_name: profile?.display_name ?? "me", sender_handle: selfEmail,
      sent_at: mail.date, subject: mail.subject,
      body: skip ? null : redact(mail.body).slice(0, 3000),
      link: `https://mail.google.com/mail/u/0/#sent/${mail.id}`,
      skipped_reason: skip, processed_at: skip ? new Date().toISOString() : null,
      person_id: people.find(p => p.emails.map(e => e.toLowerCase()).includes(mail.toEmail))?.id ?? null,
    }, { onConflict: "user_id,channel,external_id" });

    if (!skip) candidates.push(mail);
    if (candidates.length >= MAX_PER_RUN) break;
  }

  const { data: openRows } = await db.from("tasks").select("id,title,person_id,due_at")
    .eq("user_id", uid).is("deleted_at", null).not("status", "in", "(done,cancelled)");
  const openTasks = (openRows ?? []) as OpenTask[];

  let created = 0;
  const errors: string[] = [];
  for (const mail of candidates) {
    const person = people.find(p => p.emails.map(e => e.toLowerCase()).includes(mail.toEmail));
    const theirs = person ? openTasks.filter(t => t.person_id === person.id) : [];
    const out = await extract(db, uid, sec, profile, mail, theirs);
    const taskIds: string[] = [];

    for (const p of out?.promises ?? []) {
      // Deliberately strict. A false promise is worse than a missed one: it puts
      // words in Amit's mouth that he then feels obliged to honour.
      if (p.confidence < 0.5) continue;

      let who = person;
      if (!who) {
        const { data: np } = await db.from("people").insert({
          user_id: uid, name: mail.toName || mail.toEmail,
          emails: [mail.toEmail], last_contact_at: mail.date,
        }).select("id,name,emails,trust_level").single();
        if (np) { who = np as Person; people.push(who); }
      }

      const { data: row, error } = await db.from("tasks").insert({
        user_id: uid, title: p.title.slice(0, 200), description: p.details || null,
        status: "inbox", priority: p.priority, due_at: p.due_iso || null, due_has_time: !!p.due_has_time,
        // A promise is something Amit owes THEM, so it belongs under "I owe them"
        // on their page, not under what he is waiting on.
        person_id: who?.id ?? null, waiting_on_person_id: null,
        source_kind: "gmail", source_ref: mail.id,
        source_link: `https://mail.google.com/mail/u/0/#sent/${mail.id}`,
        source_quote: p.quote?.slice(0, 300) ?? null, confidence: p.confidence,
        review_state: "suggested",   // never auto-accepted, whatever their trust level
        ai_meta: {
          kind: "promise", reason: out?.reason, due_raw: p.due_raw,
          model: sec.model_extract, subject: mail.subject, to: mail.toEmail,
        },
      }).select("id").single();

      if (error) { console.error("promise insert failed", JSON.stringify(error)); errors.push(`${error.code ?? ""} ${error.message ?? ""}`.trim()); }
      if (row) { taskIds.push(row.id); created++; }
    }

    await db.from("messages").update({
      processed_at: new Date().toISOString(), extraction: out ?? {}, task_ids: taskIds,
    }).eq("user_id", uid).eq("channel", "gmail").eq("external_id", mail.id);
  }

  await db.from("user_secrets").update({ gmail_sent_last_at: new Date().toISOString() }).eq("user_id", uid);
  return finish({
    fetched, candidates: candidates.length, created_tasks: created,
    error: errors.length ? `${errors.length} promise insert(s) failed: ${errors[0]}`.slice(0, 500) : null,
  });
}

// ---------- helpers
function header(h: { name: string; value: string }[], n: string) {
  return h.find(x => x.name.toLowerCase() === n.toLowerCase())?.value ?? "";
}
function b64(s: string) {
  try { return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))); }
  catch { return ""; }
}
function textOf(p: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }): { plain: string; html: string } {
  let plain = "", html = "";
  const walk = (x: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }) => {
    if (x.mimeType === "text/plain" && x.body?.data) plain += b64(x.body.data);
    else if (x.mimeType === "text/html" && x.body?.data) html += b64(x.body.data);
    for (const c of (x.parts ?? []) as { mimeType?: string; body?: { data?: string }; parts?: unknown[] }[]) walk(c);
  };
  walk(p); return { plain, html };
}
function stripHtml(h: string) {
  return h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
function parseSent(m: {
  id: string; threadId: string; labelIds?: string[];
  payload: { headers: { name: string; value: string }[]; mimeType?: string; body?: { data?: string }; parts?: unknown[] };
  internalDate: string;
}): Mail {
  const h = m.payload.headers ?? [];
  const to = header(h, "To");
  const em = to.match(/<([^>]+)>/);
  const toEmail = (em ? em[1] : to).split(",")[0].trim().toLowerCase();
  const toName = to.replace(/<[^>]+>/, "").replace(/"/g, "").split(",")[0].trim();
  const { plain, html } = textOf(m.payload);
  let body = (plain || stripHtml(html)).trim();
  // Everything below the quoted reply is the other person's words, not a promise.
  body = body.split(/\n(?:On .{5,120}wrote:|-----Original Message-----|From: .+\n(?:Sent|Date): )/)[0];
  return {
    id: m.id, threadId: m.threadId, toEmail, toName, cc: header(h, "Cc"),
    subject: header(h, "Subject"), date: new Date(Number(m.internalDate)).toISOString(),
    body: body.slice(0, 6000), labels: m.labelIds ?? [],
  };
}
function redact(s: string) {
  return s.replace(/\b(otp|one[- ]time (?:password|code)|verification code|passcode)\b[^\d]{0,30}\d{4,8}/gi, "$1 [redacted]")
    .replace(/\b\d{10,19}\b/g, "[number]")
    .replace(/\b[A-Z]{4}0[A-Z0-9]{6}\b/g, "[ifsc]");
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function extract(
  db: SupabaseClient, uid: string, sec: Secrets,
  profile: { timezone: string; eod_time: string; work_days: number[]; display_name: string | null } | null,
  mail: Mail, theirOpenTasks: OpenTask[],
) {
  const tz = profile?.timezone ?? "Asia/Kolkata";
  const sentLocal = new Date(mail.date).toLocaleString("en-IN", { timeZone: tz, weekday: "long", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const nowLocal = new Date().toLocaleString("en-IN", { timeZone: tz, weekday: "long", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const workDays = (profile?.work_days ?? [1, 2, 3, 4, 5, 6]).map(d => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", ");
  const me = profile?.display_name ?? "the user";

  const system = `This is an email ${me} ("I") SENT. Find the commitments I made to the recipient — things I said I would do that are not done yet. Reply ONLY with JSON matching the schema.
Rules:
- A promise is a first-person future commitment: "I'll send X", "will share by Friday", "let me check and revert", "main kal bhej dunga". The recipient is now waiting on me for it.
- NOT promises: anything I asked THEM to do; things I said I had already done ("sent", "attached", "done"); pleasantries ("looking forward", "let's catch up", "will do my best"); vague intent with no deliverable ("we should explore this"); hypotheticals ("if needed I could…"); and anything in a quoted reply below my own text.
- An attached deliverable is NOT a promise — "please find attached" means it is already delivered.
- Text may be English, Hindi or Hinglish. "bhej dunga" = I will send, "kar dunga" = I will do, "dekh ke batata hoon" = I will check and tell you, "revert karta hoon" = I will get back.
- Dates resolve against when I sent it (${sentLocal}, ${tz}). Now is ${nowLocal}. "kal" = next day, "parso" = day after, "aaj" = same day, "EOD" = ${profile?.eod_time ?? "23:59"} that day, "EOW"/"end of week" = the coming Saturday (work days: ${workDays}). No date given → due_iso null. ISO 8601 with the ${tz} offset. due_has_time only if a clock time was stated.
- Priority: 1 if I promised it today or said urgent, 2 if within 2 days or to a client, 3 otherwise, 4 for vague or low-stakes.
- If a promise matches something in ALREADY TRACKED below, skip it entirely — it is already on my list.
- title: short imperative naming what I owe them, <= 12 words, English. quote: my exact sentence promising it (<= 200 chars).
- confidence 0-1. Be strict: score below 0.5 unless it is unmistakably a commitment I have not yet fulfilled. Inventing a promise is worse than missing one.`;

  const user = `ALREADY TRACKED for this person (do not repeat):\n${theirOpenTasks.length ? theirOpenTasks.map(t => `- ${t.title} (${t.due_at ?? "no date"})`).join("\n") : "(none)"}\n\nEMAIL I SENT\nTo: ${mail.toName} <${mail.toEmail}>\n${mail.cc ? `Cc: ${mail.cc}\n` : ""}Subject: ${mail.subject}\nSent: ${sentLocal}\n\n${redact(mail.body).slice(0, 5000)}`;

  const schema = {
    type: "object", additionalProperties: false,
    properties: {
      reason: { type: "string" },
      promises: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: {
            title: { type: "string" }, details: { type: "string" },
            due_raw: { type: ["string", "null"] }, due_iso: { type: ["string", "null"] },
            due_has_time: { type: "boolean" },
            priority: { type: "integer", minimum: 1, maximum: 4 },
            quote: { type: "string" }, confidence: { type: "number" },
          },
          required: ["title", "details", "due_raw", "due_iso", "due_has_time", "priority", "quote", "confidence"],
        },
      },
    },
    required: ["reason", "promises"],
  };

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sec.openrouter_key}`, "Content-Type": "application/json",
      "HTTP-Referer": "https://personal-tracker-eta-six.vercel.app", "X-Title": "Tracker",
    },
    body: JSON.stringify({
      model: sec.model_extract, temperature: 0.1,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: { name: "promises", strict: true, schema } },
      usage: { include: true },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${j?.error?.message ?? "error"}`);

  const usage = j.usage ?? {};
  const { error: usageErr } = await db.from("ai_usage").insert({
    user_id: uid, purpose: "extract_promise", model: sec.model_extract,
    input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0,
    cost_usd: usage.cost ?? 0,
  });
  if (usageErr) console.error("ai_usage insert failed", JSON.stringify(usageErr));

  try {
    return JSON.parse((j.choices?.[0]?.message?.content ?? "{}").replace(/^```(?:json)?|```$/g, "").trim()) as {
      reason: string;
      promises: { title: string; details: string; due_raw: string | null; due_iso: string | null; due_has_time: boolean; priority: 1 | 2 | 3 | 4; quote: string; confidence: number }[];
    };
  } catch { return null; }
}
