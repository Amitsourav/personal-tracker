// Supabase Edge Function: receives WhatsApp group messages from the bot
// (Amitsourav/whatsappbot) and turns the ones aimed at Amit into suggestions.
//
// The bot has no Supabase user session, so it authenticates with the shared
// secret in user_secrets.whatsapp_token — hence verify_jwt is off for this
// function and the token is checked here instead.
//
// One AI call per POST (a batch of messages from one group), not one per
// message: a busy group would otherwise burn the monthly cap on banter.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_MESSAGES = 40;

type Incoming = {
  id: string;
  text: string | null;
  senderPhone: string | null;
  senderName: string | null;
  timestamp: number;            // unix seconds
  mentionedMe?: boolean;        // bot resolved an @mention to the owner's number
  isReplyToMe?: boolean;        // reply to a message the owner sent
  quotedText?: string | null;
};
type Body = { group: { id: string; name?: string | null }; messages: Incoming[] };
type Person = { id: string; name: string; phones: string[]; trust_level: string };
type OpenTask = { id: string; title: string; person_id: string | null; due_at: string | null; status: string };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const token = req.headers.get("Authorization")?.replace(/^Bearer /i, "").trim() ?? "";
  if (!token) return json({ error: "missing token" }, 401);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: uid } = await db.rpc("user_by_whatsapp_token", { tok: token });
  if (!uid) return json({ error: "unauthorized" }, 401);

  let body: Body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if (!body?.group?.id || !Array.isArray(body.messages)) return json({ error: "bad body" }, 400);

  try { return json(await run(db, uid as string, body)); }
  catch (e) { console.error("ingest-whatsapp", e); return json({ error: String(e) }, 500); }
});

async function run(db: SupabaseClient, uid: string, body: Body) {
  const { data: run } = await db.from("sync_runs").insert({ user_id: uid, channel: "whatsapp" }).select("id").single();
  const finish = async (patch: Record<string, unknown>) => {
    await db.from("sync_runs").update({ finished_at: new Date().toISOString(), ...patch }).eq("id", run!.id);
    return { fetched: 0, candidates: 0, created_tasks: 0, ...patch };
  };

  const { data: s } = await db.from("user_secrets").select("*").eq("user_id", uid).single();
  const sec = s as { openrouter_key: string | null; model_extract: string; monthly_cap_usd: number; whatsapp_owner_phone: string | null };
  if (!sec?.openrouter_key) return finish({ error: "No OpenRouter key" });

  const { data: spend } = await db.rpc("month_spend", { uid });
  if (Number(spend ?? 0) >= Number(sec.monthly_cap_usd)) {
    return finish({ error: `Monthly AI cap of $${sec.monthly_cap_usd} reached` });
  }

  // The group must be known and enabled here as well as in the bot — two
  // switches, so revoking capture from Tracker alone is enough.
  const { data: grp } = await db.from("whatsapp_groups")
    .upsert({ user_id: uid, wa_group_id: body.group.id, name: body.group.name ?? body.group.id, last_message_at: new Date().toISOString() },
      { onConflict: "user_id,wa_group_id" })
    .select("enabled,name").single();
  if (grp && grp.enabled === false) return finish({ error: "group disabled in Tracker" });
  const groupName = grp?.name ?? body.group.id;

  // Record every message first, so a redelivery or a mid-run failure cannot
  // create the same task twice. Same rule the bot itself follows.
  const incoming = body.messages.filter(m => m?.id && (m.text ?? "").trim()).slice(0, MAX_MESSAGES);
  if (!incoming.length) return finish({ fetched: 0 });

  const { data: seen } = await db.from("messages").select("external_id")
    .eq("user_id", uid).eq("channel", "whatsapp").in("external_id", incoming.map(m => m.id));
  const seenSet = new Set((seen ?? []).map((r: { external_id: string }) => r.external_id));
  const fresh = incoming.filter(m => !seenSet.has(m.id));
  if (!fresh.length) return finish({ fetched: incoming.length });

  const { data: peopleRows } = await db.from("people").select("id,name,phones,trust_level").eq("user_id", uid);
  const people = (peopleRows ?? []) as Person[];
  const byPhone = (p: string | null) => p ? people.find(x => (x.phones ?? []).some(v => same(v, p))) : undefined;

  for (const m of fresh) {
    const person = byPhone(m.senderPhone);
    await db.from("messages").upsert({
      user_id: uid, channel: "whatsapp", external_id: m.id, thread_id: body.group.id,
      sender_name: m.senderName ?? m.senderPhone, sender_handle: m.senderPhone,
      sent_at: new Date(m.timestamp * 1000).toISOString(),
      subject: groupName, body: redact(m.text ?? "").slice(0, 3000),
      person_id: person?.id ?? null,
      skipped_reason: person?.trust_level === "ignore" ? "ignored person" : null,
      processed_at: person?.trust_level === "ignore" ? new Date().toISOString() : null,
    }, { onConflict: "user_id,channel,external_id" });
  }

  const candidates = fresh.filter(m => byPhone(m.senderPhone)?.trust_level !== "ignore");
  if (!candidates.length) return finish({ fetched: incoming.length, candidates: 0 });

  const { data: profile } = await db.from("profiles").select("*").eq("id", uid).single();
  const { data: openRows } = await db.from("tasks").select("id,title,person_id,due_at,status")
    .eq("user_id", uid).is("deleted_at", null).not("status", "in", "(done,cancelled)").eq("review_state", "accepted");

  const out = await extract(db, uid, sec, profile, groupName, candidates, (openRows ?? []) as OpenTask[]);
  if (!out) return finish({ fetched: incoming.length, candidates: candidates.length, error: "AI returned nothing usable" });

  let created = 0;
  const errors: string[] = [];
  for (const t of out.tasks ?? []) {
    if (t.confidence < 0.35) continue;
    const src = candidates.find(m => m.id === t.message_id) ?? candidates[candidates.length - 1];

    // Follow-up or "done" about something already open: a note, never a duplicate.
    if (t.signal !== "new" && t.existing_task_id && (openRows ?? []).some((x: OpenTask) => x.id === t.existing_task_id)) {
      const who = src.senderName || src.senderPhone || "someone";
      await db.from("task_events").insert({
        user_id: uid, task_id: t.existing_task_id, actor: "ai",
        kind: t.signal === "done" ? "ai_done_signal" : "ai_follow_up",
        note: t.signal === "done" ? `${who} may have marked this done: “${t.quote}”` : `Follow-up from ${who} in ${groupName}: “${t.quote}”`,
        changes: { message_id: src.id, group: groupName },
      });
      if (t.signal === "follow_up") await db.from("tasks").update({ priority: 2 }).eq("id", t.existing_task_id).gt("priority", 2);
      continue;
    }

    let person = byPhone(src.senderPhone);
    if (!person && src.senderPhone) {
      const { data: np } = await db.from("people").insert({
        user_id: uid, name: src.senderName || src.senderPhone,
        phones: [src.senderPhone], whatsapp_ids: [src.senderPhone],
        last_contact_at: new Date(src.timestamp * 1000).toISOString(),
      }).select("id,name,phones,trust_level").single();
      if (np) { person = np as Person; people.push(person); }
    }

    const { data: row, error } = await db.from("tasks").insert({
      user_id: uid, title: t.title.slice(0, 200), description: t.details || null,
      status: "inbox", priority: t.priority, due_at: t.due_iso || null, due_has_time: !!t.due_has_time,
      person_id: t.kind === "commitment" ? null : (person?.id ?? null),
      waiting_on_person_id: t.kind === "commitment" ? (person?.id ?? null) : null,
      source_kind: "whatsapp", source_ref: src.id, source_link: null,
      source_quote: (t.quote ?? src.text ?? "").slice(0, 300), confidence: t.confidence,
      review_state: person?.trust_level === "auto_accept" ? "accepted" : "suggested",
      ai_meta: { reason: out.reason, due_raw: t.due_raw, kind: t.kind, model: sec.model_extract, subject: groupName, channel: "whatsapp" },
    }).select("id").single();
    if (error) { console.error("task insert failed", JSON.stringify(error)); errors.push(`${error.code ?? ""} ${error.message ?? ""}`.trim()); }
    if (row) created++;
  }

  await db.from("messages").update({ processed_at: new Date().toISOString(), extraction: out })
    .eq("user_id", uid).eq("channel", "whatsapp").in("external_id", candidates.map(m => m.id));

  return finish({
    fetched: incoming.length, candidates: candidates.length, created_tasks: created,
    error: errors.length ? `${errors.length} task insert(s) failed: ${errors[0]}`.slice(0, 500) : null,
  });
}

// ---------- helpers
/** Compare phone numbers ignoring +, spaces and a missing country code. */
function same(a: string, b: string) {
  const n = (x: string) => x.replace(/\D/g, "").replace(/^0+/, "");
  const [x, y] = [n(a), n(b)];
  return x === y || (x.length >= 10 && y.length >= 10 && x.slice(-10) === y.slice(-10));
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
  db: SupabaseClient, uid: string,
  sec: { openrouter_key: string | null; model_extract: string },
  profile: { timezone: string; eod_time: string; work_days: number[]; display_name: string | null } | null,
  groupName: string, msgs: Incoming[], openTasks: OpenTask[],
) {
  const tz = profile?.timezone ?? "Asia/Kolkata";
  const nowLocal = new Date().toLocaleString("en-IN", { timeZone: tz, weekday: "long", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const workDays = (profile?.work_days ?? [1, 2, 3, 4, 5, 6]).map(d => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", ");
  const me = profile?.display_name ?? "the user";

  const system = `You read a WhatsApp GROUP conversation and extract only the action items for ${me} ("me"). Reply ONLY with JSON matching the schema.
Rules:
- This is a work group. Most messages are chatter between other people — extract NOTHING from those. A message is only a task for me if it asks ME to do something, or someone promises something TO me.
- Messages marked [TAGGED ME] or [REPLY TO ME] are aimed at me — weigh them heavily. A message aimed at someone else is not my task even if it describes work.
- kind "request" = I must do it. kind "commitment" = the sender promised it to me and I am waiting on them.
- Ignore: greetings, acknowledgements ("ok", "done", "thik hai", "ji"), status chatter, forwarded jokes, and anything already completed.
- Messages are English, Hindi or Hinglish (Romanised Hindi). Interpret naturally: "bhej dena" = send it, "kar dena" = do it, "dekh lena" = check it, "pending hai" = still open.
- Dates resolve against each message's own sent time. Now is ${nowLocal} (${tz}). "kal" with a future verb = tomorrow; "parso" = day after; "aaj" = today; "EOD" = ${profile?.eod_time ?? "23:59"} that day; "EOW"/"end of week" = the coming Saturday (work days: ${workDays}); "jaldi"/"ASAP"/"urgent" = no date but priority 1. No deadline → due_iso null. Output due_iso as ISO 8601 with the ${tz} offset. due_has_time only if a clock time was given.
- Priority: 1 urgent, 2 high (deadline within 2 days, or from a client/boss), 3 medium, 4 low.
- If a message chases something in OPEN TASKS ("kya hua", "any update", "reminder"), use signal "follow_up" with that existing_task_id instead of creating a new task. If it says that task is finished, signal "done". Otherwise "new".
- message_id: the id of the message the task came from. title: short imperative, <= 12 words, English. quote: the exact sentence asking for it (<= 200 chars).
- confidence 0-1. Be strict: if you are not sure it is my task, score below 0.35.`;

  const transcript = msgs.map(m => {
    const flags = [m.mentionedMe ? "[TAGGED ME]" : "", m.isReplyToMe ? "[REPLY TO ME]" : ""].filter(Boolean).join(" ");
    const when = new Date(m.timestamp * 1000).toLocaleString("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const quoted = m.quotedText ? `\n   (replying to: “${redact(m.quotedText).slice(0, 160)}”)` : "";
    return `[${m.id}] ${when} — ${m.senderName || m.senderPhone || "unknown"} ${flags}\n   ${redact(m.text ?? "").slice(0, 800)}${quoted}`;
  }).join("\n");

  const user = `GROUP: ${groupName}\n\nOPEN TASKS (id → title, due):\n${openTasks.length ? openTasks.map(t => `${t.id} → ${t.title} (${t.due_at ?? "no date"}, ${t.status})`).join("\n") : "(none)"}\n\nCONVERSATION\n${transcript}`;

  const schema = {
    type: "object", additionalProperties: false,
    properties: {
      actionable: { type: "boolean" }, reason: { type: "string" },
      tasks: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: {
            message_id: { type: "string" }, title: { type: "string" }, details: { type: "string" },
            kind: { type: "string", enum: ["request", "commitment"] },
            signal: { type: "string", enum: ["new", "follow_up", "done"] },
            existing_task_id: { type: ["string", "null"] },
            due_raw: { type: ["string", "null"] }, due_iso: { type: ["string", "null"] },
            due_has_time: { type: "boolean" },
            priority: { type: "integer", minimum: 1, maximum: 4 },
            quote: { type: "string" }, confidence: { type: "number" },
          },
          required: ["message_id", "title", "details", "kind", "signal", "existing_task_id", "due_raw", "due_iso", "due_has_time", "priority", "quote", "confidence"],
        },
      },
    },
    required: ["actionable", "reason", "tasks"],
  };

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${sec.openrouter_key}`, "Content-Type": "application/json", "HTTP-Referer": "https://personal-tracker-eta-six.vercel.app", "X-Title": "Tracker" },
    body: JSON.stringify({
      model: sec.model_extract, temperature: 0.1,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: { name: "extraction", strict: true, schema } },
      usage: { include: true },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${j?.error?.message ?? "error"}`);
  const usage = j.usage ?? {};
  await db.from("ai_usage").insert({
    user_id: uid, purpose: "extract_whatsapp", model: sec.model_extract,
    input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0, cost_usd: usage.cost ?? 0,
  });
  try {
    const out = JSON.parse((j.choices?.[0]?.message?.content ?? "{}").replace(/^```(?:json)?|```$/g, "").trim());
    if (!out.actionable) out.tasks = [];
    return out as {
      actionable: boolean; reason: string;
      tasks: { message_id: string; title: string; details: string; kind: string; signal: string; existing_task_id: string | null; due_raw: string | null; due_iso: string | null; due_has_time: boolean; priority: 1 | 2 | 3 | 4; quote: string; confidence: number }[];
    };
  } catch { return null; }
}
