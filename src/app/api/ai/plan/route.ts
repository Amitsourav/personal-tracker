import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Proposes a day: which open tasks to do, in which free gaps, for how long.
//
// It returns a proposal and writes nothing. Amit approves it in the UI, which is
// what actually sets scheduled_at — a planner that silently rearranged the day
// would be worse than no planner.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { date } = await request.json().catch(() => ({}));
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date (YYYY-MM-DD) is required" }, { status: 400 });
  }

  const [{ data: secrets }, { data: profile }, { data: spend }] = await Promise.all([
    supabase.from("user_secrets").select("openrouter_key, model_plan, monthly_cap_usd").maybeSingle(),
    supabase.from("profiles").select("*").maybeSingle(),
    supabase.rpc("month_spend", { uid: user.id }),
  ]);
  if (!secrets?.openrouter_key) return NextResponse.json({ error: "Add your OpenRouter key in Settings first" }, { status: 400 });
  if (Number(spend ?? 0) >= Number(secrets.monthly_cap_usd)) {
    return NextResponse.json({ error: `Monthly AI cap of $${secrets.monthly_cap_usd} reached` }, { status: 400 });
  }

  const tz = profile?.timezone ?? "Asia/Kolkata";
  // The day's bounds in the user's timezone, expressed as instants.
  const dayStart = new Date(`${date}T00:00:00${offsetFor(tz, date)}`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const [{ data: events }, { data: tasks }] = await Promise.all([
    supabase.from("calendar_events")
      .select("title, start_at, end_at, all_day, status, self_response")
      .neq("status", "cancelled")
      .lt("start_at", dayEnd.toISOString()).gt("end_at", dayStart.toISOString())
      .order("start_at"),
    supabase.from("tasks")
      .select("id, title, priority, due_at, duration_min, status, scheduled_at, description, ai_meta")
      .eq("review_state", "accepted").is("deleted_at", null)
      .not("status", "in", "(done,cancelled)")
      .order("priority"),
  ]);

  const open = (tasks ?? []).filter(t => !t.scheduled_at || t.scheduled_at < dayStart.toISOString() || t.scheduled_at >= dayEnd.toISOString());
  if (!open.length) return NextResponse.json({ blocks: [], note: "Nothing open to schedule." });

  // A declined meeting is not busy time; an all-day event is context, not a block.
  const busy = (events ?? [])
    .filter(e => !e.all_day && e.self_response !== "declined")
    .map(e => `${fmt(e.start_at, tz)}–${fmt(e.end_at, tz)} ${e.title}`);
  const allDay = (events ?? []).filter(e => e.all_day).map(e => e.title);

  const fmtDue = (d: string | null) => d
    ? new Date(d).toLocaleString("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short" })
    : "no deadline";

  const taskLines = open.map(t =>
    `${t.id} | ${t.title} | p${t.priority} | due ${fmtDue(t.due_at)}${t.duration_min ? ` | est ${t.duration_min}m` : ""}${(t.ai_meta as { kind?: string })?.kind === "promise" ? " | I PROMISED THIS" : ""}`
  ).join("\n");

  const system = `You plan one working day for ${profile?.display_name ?? "the user"}. Reply ONLY with JSON matching the schema.
Rules:
- Working hours are ${profile?.day_start ?? "09:00"} to ${profile?.day_end ?? "21:00"} in ${tz}. Never schedule outside them, and never on top of a MEETING listed below.
- Fill at most 70% of the free time. A day packed wall to wall is a day that breaks on the first interruption, and leaves nothing for the work that arrives during it.
- Order by what actually matters: anything overdue first, then due today, then promises the user made to other people, then priority 1-2, then the rest. A task with no deadline should not displace one with a deadline today.
- Blocks are 25 to 90 minutes. Split anything that would need longer into named parts. Leave at least 10 minutes between blocks, and do not schedule over the lunch hour (13:00-14:00) unless the day is otherwise impossible.
- Do not schedule every open task. Propose only what genuinely fits in 70% of the free time, and leave the rest for another day.
- reason: one short clause on why this task today, in plain language, for a human deciding whether to accept. Never restate the title.
- If there is no usable free time at all, return an empty blocks array and say so in note.`;

  const prompt = `DATE: ${new Date(dayStart).toLocaleDateString("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "long" })}
NOW: ${new Date().toLocaleString("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit" })} — do not schedule anything in the past if this is today.

MEETINGS ALREADY BOOKED:
${busy.length ? busy.join("\n") : "(none)"}
${allDay.length ? `\nALL-DAY CONTEXT: ${allDay.join(", ")}` : ""}

OPEN TASKS (id | title | priority | deadline | estimate):
${taskLines}`;

  const schema = {
    type: "object", additionalProperties: false,
    properties: {
      note: { type: "string" },
      blocks: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: {
            task_id: { type: "string" },
            start: { type: "string" },      // HH:MM, local
            minutes: { type: "integer", minimum: 15, maximum: 180 },
            reason: { type: "string" },
          },
          required: ["task_id", "start", "minutes", "reason"],
        },
      },
    },
    required: ["note", "blocks"],
  };

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secrets.openrouter_key}`, "Content-Type": "application/json",
      "HTTP-Referer": "https://personal-tracker-eta-six.vercel.app", "X-Title": "Tracker",
    },
    body: JSON.stringify({
      model: secrets.model_plan, temperature: 0.2,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: { name: "day_plan", strict: true, schema } },
      usage: { include: true },
    }),
  });
  const j = await r.json();
  if (!r.ok) return NextResponse.json({ error: `AI error: ${j?.error?.message ?? r.status}` }, { status: 502 });

  const usage = j.usage ?? {};
  const { error: usageErr } = await supabase.from("ai_usage").insert({
    user_id: user.id, purpose: "plan_day", model: secrets.model_plan,
    input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0, cost_usd: usage.cost ?? 0,
  });
  if (usageErr) console.error("ai_usage insert failed", JSON.stringify(usageErr));

  let out: { note: string; blocks: { task_id: string; start: string; minutes: number; reason: string }[] };
  try { out = JSON.parse((j.choices?.[0]?.message?.content ?? "{}").replace(/^```(?:json)?|```$/g, "").trim()); }
  catch { return NextResponse.json({ error: "AI returned an unreadable plan" }, { status: 502 }); }

  // Resolve each block against the real task and a real instant. A hallucinated
  // id or a malformed time is dropped rather than shown as a plan.
  const byId = new Map(open.map(t => [t.id, t]));
  const blocks = (out.blocks ?? []).flatMap(b => {
    const task = byId.get(b.task_id);
    if (!task || !/^\d{2}:\d{2}$/.test(b.start)) return [];
    const at = new Date(`${date}T${b.start}:00${offsetFor(tz, date)}`);
    if (Number.isNaN(at.getTime())) return [];
    return [{
      task_id: task.id, title: task.title, priority: task.priority, due_at: task.due_at,
      start_at: at.toISOString(), minutes: b.minutes, reason: b.reason,
    }];
  }).sort((a, b) => a.start_at.localeCompare(b.start_at));

  return NextResponse.json({ note: out.note ?? "", blocks });
}

function fmt(iso: string, tz: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
}

/** The UTC offset for a timezone on a given date, as "+05:30". */
function offsetFor(tz: string, date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(d);
  const name = parts.find(p => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const m = name.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : "+00:00";
}
