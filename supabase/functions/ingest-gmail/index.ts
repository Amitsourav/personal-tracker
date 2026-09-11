// Supabase Edge Function: reads new Gmail for each connected user, asks the AI for tasks, inserts them as suggestions.
// Called every 5 minutes by pg_cron (anon key → all users) or by "Sync now" in Settings (user JWT → that user only).
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MAX_PER_RUN = 25;

type Secrets = { user_id: string; openrouter_key: string | null; model_extract: string; monthly_cap_usd: number; google_client_id: string; google_client_secret: string; google_refresh_token: string; google_email: string | null; gmail_history_id: string | null; gmail_enabled: boolean; gmail_ignore_senders: string[] };
type Person = { id: string; name: string; emails: string[]; trust_level: string };
type OpenTask = { id: string; title: string; person_id: string | null; due_at: string | null; status: string };
type Mail = { id: string; threadId: string; from: string; fromEmail: string; fromName: string; to: string; subject: string; date: string; body: string; labels: string[]; unsubscribe: boolean };

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization")?.replace(/^Bearer /i, "").trim() ?? "";
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  if (!auth) return json({ error: "unauthorized" }, 401);
  let userIds: string[] = [];
  if (auth === SERVICE_KEY) {
    // Full sweep. The service key is secret; the publishable key is NOT and must
    // never be enough to trigger paid AI work.
    const { data } = await admin.from("user_secrets").select("user_id").eq("gmail_enabled", true).not("google_refresh_token", "is", null).not("openrouter_key", "is", null);
    userIds = (data ?? []).map((r: { user_id: string }) => r.user_id);
  } else {
    // pg_cron sends the per-user sync token. It is checked first because it is a
    // plain string compare in the DB and does not depend on the project's JWT
    // format — the legacy anon JWT the cron used before stopped being accepted
    // when the project moved to sb_publishable_* keys, and every scheduled run
    // had been failing 401 since.
    const { data: tokUser } = await admin.rpc("user_by_sync_token", { tok: auth });
    if (tokUser) userIds = [tokUser as string];
    else {
      const { data: { user } } = await createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${auth}` } } }).auth.getUser();
      if (!user) return json({ error: "unauthorized" }, 401);
      userIds = [user.id];
    }
  }
  const results: Record<string, unknown>[] = [];
  for (const uid of userIds) {
    try { results.push(await runForUser(admin, uid)); } catch (e) { results.push({ user: uid, error: String(e) }); }
  }
  return json(userIds.length === 1 ? results[0] : { runs: results });
});

async function runForUser(db: SupabaseClient, uid: string) {
  const { data: s } = await db.from("user_secrets").select("*").eq("user_id", uid).single();
  const sec = s as Secrets;
  if (!sec?.google_refresh_token) return { error: "Gmail not connected" };
  if (!sec.openrouter_key) return { error: "No OpenRouter key" };
  const { data: run } = await db.from("sync_runs").insert({ user_id: uid, channel: "gmail" }).select("id").single();
  const finish = async (patch: Record<string, unknown>) => { await db.from("sync_runs").update({ finished_at: new Date().toISOString(), ...patch }).eq("id", run!.id); return { fetched: 0, candidates: 0, created_tasks: 0, ...patch }; };

  const { data: spend } = await db.rpc("month_spend", { uid });
  if (Number(spend ?? 0) >= Number(sec.monthly_cap_usd)) return finish({ error: `Monthly AI cap of $${sec.monthly_cap_usd} reached` });

  const { data: profile } = await db.from("profiles").select("*").eq("id", uid).single();
  const { data: peopleRows } = await db.from("people").select("id,name,emails,trust_level").eq("user_id", uid);
  const people = (peopleRows ?? []) as Person[];

  // ---- Gmail: access token
  const tokRes = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: sec.google_client_id, client_secret: sec.google_client_secret, refresh_token: sec.google_refresh_token, grant_type: "refresh_token" }) });
  const tok = await tokRes.json();
  if (!tok.access_token) return finish({ error: `Google token: ${tok.error_description ?? tok.error ?? "failed"}` });
  const g = (path: string, params: Record<string, string> = {}) => fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${tok.access_token}` } }).then(r => r.json());

  // ---- Which messages are new?
  let ids: string[] = [];
  const prof = await g("profile");
  if (sec.gmail_history_id) {
    const h = await g("history", { startHistoryId: sec.gmail_history_id, historyTypes: "messageAdded", labelId: "INBOX", maxResults: "100" });
    if (h.error) { // history too old → fall back to recent list
      const l = await g("messages", { q: "newer_than:2d in:inbox", maxResults: "30" });
      ids = (l.messages ?? []).map((m: { id: string }) => m.id);
    } else ids = [...new Set(((h.history ?? []) as { messagesAdded?: { message: { id: string } }[] }[]).flatMap(x => (x.messagesAdded ?? []).map(m => m.message.id)))];
  } else {
    const l = await g("messages", { q: "newer_than:7d in:inbox", maxResults: "100" });
    ids = (l.messages ?? []).map((m: { id: string }) => m.id);
  }
  // skip already-processed
  if (ids.length) {
    const { data: seen } = await db.from("messages").select("external_id").eq("user_id", uid).eq("channel", "gmail").in("external_id", ids);
    const seenSet = new Set((seen ?? []).map((r: { external_id: string }) => r.external_id));
    ids = ids.filter(id => !seenSet.has(id));
  }
  ids = ids.slice(0, MAX_PER_RUN * 4);

  // ---- Fetch + prefilter
  const selfEmail = (sec.google_email ?? "").toLowerCase();
  const ignore = sec.gmail_ignore_senders.map(x => x.toLowerCase());
  const candidates: Mail[] = [];
  const seenInRun = new Set<string>();
  let fetched = 0;
  for (const id of ids) {
    const m = await g(`messages/${id}`, { format: "full" });
    if (!m.payload) continue;
    fetched++;
    const mail = parseMail(m);
    let skip: string | null = null;
    if (!mail.labels.includes("INBOX")) skip = "not inbox";
    else if (mail.labels.some(l => ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS", "SPAM"].includes(l))) skip = "promotions/social";
    else if (mail.unsubscribe) skip = "newsletter";
    else if (/no-?reply|donotreply|notification|mailer-daemon|alerts?@|newsletter|marketing|@notify\.|notifications?@|@mailer\.|@bounce/i.test(mail.fromEmail)) skip = "automated sender";
    else if (mail.fromEmail === selfEmail) skip = "sent by me";
    else if (ignore.some(x => mail.fromEmail.includes(x))) skip = "ignored sender";
    else if (people.find(p => p.emails.map(e => e.toLowerCase()).includes(mail.fromEmail))?.trust_level === "ignore") skip = "ignored person";
    else if (seenInRun.has(`${mail.fromEmail}|${mail.subject}`)) skip = "duplicate in run";
    if (!skip) seenInRun.add(`${mail.fromEmail}|${mail.subject}`);
    await db.from("messages").upsert({ user_id: uid, channel: "gmail", external_id: mail.id, thread_id: mail.threadId, sender_name: mail.fromName, sender_handle: mail.fromEmail, sent_at: mail.date, subject: mail.subject, body: skip ? null : redact(mail.body).slice(0, 3000), link: `https://mail.google.com/mail/u/0/#inbox/${mail.id}`, skipped_reason: skip, processed_at: skip ? new Date().toISOString() : null, person_id: people.find(p => p.emails.map(e => e.toLowerCase()).includes(mail.fromEmail))?.id ?? null }, { onConflict: "user_id,channel,external_id" });
    if (!skip) candidates.push(mail);
    if (candidates.length >= MAX_PER_RUN) break;
  }

  // ---- AI extraction
  let created = 0;
  const insertErrors: string[] = [];
  const { data: openRows } = await db.from("tasks").select("id,title,person_id,due_at,status").eq("user_id", uid).is("deleted_at", null).not("status", "in", "(done,cancelled)").eq("review_state", "accepted");
  const openTasks = (openRows ?? []) as OpenTask[];
  for (const mail of candidates) {
    const existing = people.find(p => p.emails.map(e => e.toLowerCase()).includes(mail.fromEmail));
    const senderTasks = existing ? openTasks.filter(t => t.person_id === existing.id) : [];
    const out = await extract(sec, profile, mail, senderTasks, db, uid);
    const ids: string[] = [];
    if (out?.tasks?.length) {
      let person = existing;
      if (!person && out.tasks.some(t => t.signal === "new")) {
        const { data: np } = await db.from("people").insert({ user_id: uid, name: mail.fromName || mail.fromEmail, emails: [mail.fromEmail], last_contact_at: mail.date }).select("id,name,emails,trust_level").single();
        if (np) { person = np as Person; people.push(person); }
      } else if (person) await db.from("people").update({ last_contact_at: mail.date }).eq("id", person.id);
      for (const t of out.tasks) {
        if (t.confidence < 0.35) continue;
        if (t.signal !== "new" && t.existing_task_id && senderTasks.some(x => x.id === t.existing_task_id)) {
          const note = t.signal === "done" ? `${mail.fromName || mail.fromEmail} may have marked this done: “${t.quote}”` : `Follow-up from ${mail.fromName || mail.fromEmail}: “${t.quote}”`;
          await db.from("task_events").insert({ user_id: uid, task_id: t.existing_task_id, kind: t.signal === "done" ? "ai_done_signal" : "ai_follow_up", actor: "ai", note, changes: { message_id: mail.id, link: `https://mail.google.com/mail/u/0/#inbox/${mail.id}` } });
          if (t.signal === "follow_up") { const cur = senderTasks.find(x => x.id === t.existing_task_id); await db.from("tasks").update({ priority: 2 }).eq("id", t.existing_task_id).gt("priority", 2); void cur; }
          continue;
        }
        const { data: row, error: insErr } = await db.from("tasks").insert({
          user_id: uid, title: t.title.slice(0, 200), description: t.details || null, status: "inbox", priority: t.priority,
          due_at: t.due_iso || null, due_has_time: !!t.due_has_time, person_id: t.kind === "commitment" ? null : (person?.id ?? null), waiting_on_person_id: t.kind === "commitment" ? (person?.id ?? null) : null,
          source_kind: "gmail", source_ref: mail.id, source_link: `https://mail.google.com/mail/u/0/#inbox/${mail.id}`, source_quote: t.quote?.slice(0, 300) ?? null, confidence: t.confidence,
          review_state: person?.trust_level === "auto_accept" ? "accepted" : "suggested", ai_meta: { reason: out.reason, due_raw: t.due_raw, kind: t.kind, model: sec.model_extract, subject: mail.subject },
        }).select("id").single();
        if (insErr) { console.error("task insert failed", JSON.stringify(insErr)); insertErrors.push(`${insErr.code ?? ""} ${insErr.message ?? ""} ${insErr.details ?? ""}`.trim()); }
        if (row) { ids.push(row.id); created++; }
      }
    }
    await db.from("messages").update({ processed_at: new Date().toISOString(), extraction: out ?? {}, task_ids: ids }).eq("user_id", uid).eq("channel", "gmail").eq("external_id", mail.id);
  }
  await db.from("user_secrets").update({ gmail_history_id: prof.historyId ? String(prof.historyId) : sec.gmail_history_id, gmail_last_sync_at: new Date().toISOString() }).eq("user_id", uid);
  return finish({ fetched, candidates: candidates.length, created_tasks: created, error: insertErrors.length ? `${insertErrors.length} task insert(s) failed: ${insertErrors[0]}`.slice(0, 500) : null });
}

// ---------- helpers
function header(h: { name: string; value: string }[], n: string) { return h.find(x => x.name.toLowerCase() === n.toLowerCase())?.value ?? ""; }
function b64(s: string) { try { return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))); } catch { return ""; } }
function textOf(p: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }): { plain: string; html: string } {
  let plain = "", html = "";
  const walk = (x: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }) => {
    if (x.mimeType === "text/plain" && x.body?.data) plain += b64(x.body.data);
    else if (x.mimeType === "text/html" && x.body?.data) html += b64(x.body.data);
    for (const c of (x.parts ?? []) as { mimeType?: string; body?: { data?: string }; parts?: unknown[] }[]) walk(c);
  };
  walk(p); return { plain, html };
}
function stripHtml(h: string) { return h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim(); }
function parseMail(m: { id: string; threadId: string; labelIds?: string[]; payload: { headers: { name: string; value: string }[]; mimeType?: string; body?: { data?: string }; parts?: unknown[] }; internalDate: string }): Mail {
  const h = m.payload.headers ?? [];
  const from = header(h, "From"); const em = from.match(/<([^>]+)>/); const fromEmail = (em ? em[1] : from).trim().toLowerCase();
  const fromName = from.replace(/<[^>]+>/, "").replace(/"/g, "").trim();
  const { plain, html } = textOf(m.payload);
  let body = (plain || stripHtml(html)).trim();
  // cut quoted replies
  body = body.split(/\n(?:On .{5,120}wrote:|-----Original Message-----|From: .+\n(?:Sent|Date): )/)[0];
  return { id: m.id, threadId: m.threadId, from, fromEmail, fromName, to: header(h, "To"), subject: header(h, "Subject"), date: new Date(Number(m.internalDate)).toISOString(), body: body.slice(0, 6000), labels: m.labelIds ?? [], unsubscribe: !!header(h, "List-Unsubscribe") };
}
function redact(s: string) { return s.replace(/\b(otp|one[- ]time (?:password|code)|verification code|passcode)\b[^\d]{0,30}\d{4,8}/gi, "$1 [redacted]").replace(/\b\d{10,19}\b/g, "[number]").replace(/\b[A-Z]{4}0[A-Z0-9]{6}\b/g, "[ifsc]"); }

async function extract(sec: Secrets, profile: { timezone: string; eod_time: string; work_days: number[]; display_name: string | null } | null, mail: Mail, senderTasks: OpenTask[], db: SupabaseClient, uid: string) {
  const tz = profile?.timezone ?? "Asia/Kolkata";
  const sent = new Date(mail.date);
  const sentLocal = sent.toLocaleString("en-IN", { timeZone: tz, weekday: "long", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const nowLocal = new Date().toLocaleString("en-IN", { timeZone: tz, weekday: "long", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const workDays = (profile?.work_days ?? [1, 2, 3, 4, 5, 6]).map(d => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", ");
  const system = `You extract action items for ${profile?.display_name ?? "the user"} ("me") from one email. Reply ONLY with JSON matching the schema.
Rules:
- A task is something ME must do (kind "request"), or something the SENDER promised to do for me (kind "commitment" → I am waiting on them). Ignore FYI, newsletters, receipts, automated notices, and things already done.
- Messages may be in English, Hindi or Hinglish (Romanised Hindi). Interpret naturally.
- Dates: resolve relative to the email's SENT time (${sentLocal}, timezone ${tz}). Now is ${nowLocal}. "kal" with a future/imperative verb = tomorrow; "parso" = day after tomorrow; "aaj" = today; "EOD" = ${profile?.eod_time ?? "23:59"} same day; "EOW"/"end of week" = the coming Saturday (work days: ${workDays}); "jaldi"/"ASAP"/"urgent" = no date but priority 1. If no deadline, due_iso = null. Output due_iso as ISO 8601 with the ${tz} offset. due_has_time true only if a clock time was given.
- Priority: 1 urgent (ASAP/today/explicit urgency), 2 high (named deadline within 2 days or from a client/boss), 3 medium, 4 low.
- If the email is a reminder/follow-up ("any update?", "reminder", "kya hua?", "gentle ping") about one of the OPEN TASKS listed, output signal "follow_up" with that existing_task_id instead of a new task. If it says the sender finished something on that list, signal "done". Otherwise signal "new".
- title: short imperative, ≤ 12 words, in English, naming the deliverable. quote: the exact sentence from the email that asks for it (≤ 200 chars).
- confidence 0–1: how sure you are this is a real, still-open action for me.`;
  const user = `OPEN TASKS from this sender (id → title, due):\n${senderTasks.length ? senderTasks.map(t => `${t.id} → ${t.title} (${t.due_at ?? "no date"}, ${t.status})`).join("\n") : "(none)"}\n\nEMAIL\nFrom: ${mail.fromName} <${mail.fromEmail}>\nTo: ${mail.to}\nSubject: ${mail.subject}\nSent: ${sentLocal}\n\n${redact(mail.body).slice(0, 5000)}`;
  const schema = { type: "object", additionalProperties: false, properties: { actionable: { type: "boolean" }, reason: { type: "string" }, tasks: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, details: { type: "string" }, kind: { type: "string", enum: ["request", "commitment"] }, signal: { type: "string", enum: ["new", "follow_up", "done"] }, existing_task_id: { type: ["string", "null"] }, due_raw: { type: ["string", "null"] }, due_iso: { type: ["string", "null"] }, due_has_time: { type: "boolean" }, priority: { type: "integer", minimum: 1, maximum: 4 }, quote: { type: "string" }, confidence: { type: "number" } }, required: ["title", "details", "kind", "signal", "existing_task_id", "due_raw", "due_iso", "due_has_time", "priority", "quote", "confidence"] } } }, required: ["actionable", "reason", "tasks"] };
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${sec.openrouter_key}`, "Content-Type": "application/json", "HTTP-Referer": "https://personal-tracker-eta-six.vercel.app", "X-Title": "Tracker" }, body: JSON.stringify({ model: sec.model_extract, temperature: 0.1, messages: [{ role: "system", content: system }, { role: "user", content: user }], response_format: { type: "json_schema", json_schema: { name: "extraction", strict: true, schema } }, usage: { include: true } }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${j?.error?.message ?? "error"}`);
  const usage = j.usage ?? {};
  await db.from("ai_usage").insert({ user_id: uid, purpose: "extract", model: sec.model_extract, input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0, cost_usd: usage.cost ?? 0 });
  const content = j.choices?.[0]?.message?.content ?? "{}";
  try { const out = JSON.parse(content.replace(/^```(?:json)?|```$/g, "").trim()); if (!out.actionable) out.tasks = []; return out as { actionable: boolean; reason: string; tasks: { title: string; details: string; kind: string; signal: string; existing_task_id: string | null; due_raw: string | null; due_iso: string | null; due_has_time: boolean; priority: 1 | 2 | 3 | 4; quote: string; confidence: number }[] }; } catch { return null; }
}
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
