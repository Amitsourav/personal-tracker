import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Answers a plain-English question about Amit's tasks, citing the tasks it used.
//
// No embeddings yet, deliberately. His whole task list fits comfortably in one
// prompt as a compact digest, and a digest the model can see in full gives more
// reliable answers than top-k retrieval over a few hundred rows. The point to
// switch to pgvector is when MAX_TASKS starts truncating — the response says so
// when that happens, rather than quietly answering from half the data.
const MAX_TASKS = 300;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { question } = await request.json().catch(() => ({}));
  if (!question || typeof question !== "string" || question.trim().length < 2) {
    return NextResponse.json({ error: "Ask a question" }, { status: 400 });
  }

  const [{ data: secrets }, { data: profile }, { data: spend }] = await Promise.all([
    supabase.from("user_secrets").select("openrouter_key, model_plan, monthly_cap_usd").maybeSingle(),
    supabase.from("profiles").select("display_name, timezone").maybeSingle(),
    supabase.rpc("month_spend", { uid: user.id }),
  ]);
  if (!secrets?.openrouter_key) return NextResponse.json({ error: "Add your OpenRouter key in Settings first" }, { status: 400 });
  if (Number(spend ?? 0) >= Number(secrets.monthly_cap_usd)) {
    return NextResponse.json({ error: `Monthly AI cap of $${secrets.monthly_cap_usd} reached` }, { status: 400 });
  }

  const [{ data: tasks, count }, { data: people }] = await Promise.all([
    supabase.from("tasks")
      .select("id,title,status,priority,due_at,scheduled_at,completed_at,person_id,waiting_on_person_id,project_id,review_state,source_kind,ai_meta,created_at", { count: "exact" })
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_TASKS),
    supabase.from("people").select("id,name,company"),
  ]);

  const tz = profile?.timezone ?? "Asia/Kolkata";
  const nameOf = new Map((people ?? []).map(p => [p.id, p.name]));
  const day = (d: string | null) => d
    ? new Date(d).toLocaleDateString("en-IN", { timeZone: tz, day: "numeric", month: "short", year: "2-digit" })
    : "—";

  // One line per task, dense on purpose: the model reads better from a
  // consistent table than from prose, and it keeps the prompt affordable.
  const lines = (tasks ?? []).map(t => {
    const bits = [
      t.id.slice(0, 8),
      t.title,
      t.review_state === "suggested" ? "AWAITING REVIEW" : t.status,
      `p${t.priority}`,
      `due ${day(t.due_at)}`,
    ];
    if (t.person_id) bits.push(`for ${nameOf.get(t.person_id) ?? "someone"}`);
    if (t.waiting_on_person_id) bits.push(`WAITING ON ${nameOf.get(t.waiting_on_person_id) ?? "someone"}`);
    if ((t.ai_meta as { kind?: string })?.kind === "promise") bits.push("I PROMISED THIS");
    if (t.completed_at) bits.push(`done ${day(t.completed_at)}`);
    if (t.scheduled_at) bits.push(`blocked ${day(t.scheduled_at)}`);
    bits.push(`via ${t.source_kind}`);
    return bits.join(" | ");
  });

  const truncated = (count ?? 0) > MAX_TASKS;

  const system = `You answer questions about ${profile?.display_name ?? "the user"}'s task list. Reply ONLY with JSON matching the schema.
Rules:
- Answer from the TASKS table only. Never invent a task, a person, a date or a deadline that is not there.
- If the table does not contain the answer, say so plainly in one sentence. That is a good answer, not a failure.
- Today is ${new Date().toLocaleDateString("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" })} (${tz}).
- Be direct and brief: two or three sentences, or a short list. No preamble, no "based on your tasks", no restating the question.
- Counts must be exact. Count the rows; do not estimate.
- "AWAITING REVIEW" means suggested but not yet accepted — mention that distinction when it matters to the answer.
- "WAITING ON X" means X owes it to the user. "for X" means the user owes X. Do not confuse the two.
- task_ids: the 8-character ids of tasks your answer actually relies on, at most 12. Leave empty if none apply.${truncated ? `\n- NOTE: only the ${MAX_TASKS} most recent of ${count} tasks are shown. If the answer might lie outside them, say so.` : ""}`;

  const prompt = `TASKS (id | title | status | priority | due | who | flags):\n${lines.join("\n")}\n\nQUESTION: ${question.trim()}`;

  const schema = {
    type: "object", additionalProperties: false,
    properties: {
      answer: { type: "string" },
      task_ids: { type: "array", items: { type: "string" } },
    },
    required: ["answer", "task_ids"],
  };

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secrets.openrouter_key}`, "Content-Type": "application/json",
      "HTTP-Referer": "https://personal-tracker-eta-six.vercel.app", "X-Title": "Tracker",
    },
    body: JSON.stringify({
      model: secrets.model_plan, temperature: 0.1,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema } },
      usage: { include: true },
    }),
  });
  const j = await r.json();
  if (!r.ok) return NextResponse.json({ error: `AI error: ${j?.error?.message ?? r.status}` }, { status: 502 });

  const usage = j.usage ?? {};
  const { error: usageErr } = await supabase.from("ai_usage").insert({
    user_id: user.id, purpose: "ask_tasks", model: secrets.model_plan,
    input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0, cost_usd: usage.cost ?? 0,
  });
  if (usageErr) console.error("ai_usage insert failed", JSON.stringify(usageErr));

  let out: { answer: string; task_ids: string[] };
  try { out = JSON.parse((j.choices?.[0]?.message?.content ?? "{}").replace(/^```(?:json)?|```$/g, "").trim()); }
  catch { return NextResponse.json({ error: "AI returned an unreadable answer" }, { status: 502 }); }

  // Resolve the short ids back to real tasks. Anything that does not match is
  // dropped rather than shown as a citation to something that does not exist.
  const cited = (out.task_ids ?? [])
    .map(short => (tasks ?? []).find(t => t.id.startsWith(short)))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_at: t.due_at, review_state: t.review_state }));

  return NextResponse.json({ answer: out.answer ?? "", tasks: cited, truncated, total: count ?? 0 });
}
