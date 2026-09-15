import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * What did this draft just commit me to?
 *
 * The tracker already catches promises Amit types into WhatsApp himself. It did
 * not catch the ones it wrote for him — and the AI drafts replies like
 * "will follow the same approach and share the plan shortly", which is a
 * deliverable somebody will now wait for.
 *
 * A system that manufactures obligations and then forgets them is worse than
 * one that does neither, because he trusts it to be watching.
 *
 * Nothing is created here. It reports what it found; the panel offers to add it.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { text, taskId } = await request.json().catch(() => ({}));
  if (!text || typeof text !== "string" || text.length < 15) return NextResponse.json({ promises: [] });

  const [{ data: sec }, { data: profile }, { data: spend }] = await Promise.all([
    supabase.from("user_secrets").select("openrouter_key, model_extract, monthly_cap_usd").maybeSingle(),
    supabase.from("profiles").select("display_name, timezone, eod_time, work_days").maybeSingle(),
    supabase.rpc("month_spend", { uid: user.id }),
  ]);
  if (!sec?.openrouter_key) return NextResponse.json({ promises: [] });
  if (Number(spend ?? 0) >= Number(sec.monthly_cap_usd)) return NextResponse.json({ promises: [] });

  const tz = profile?.timezone ?? "Asia/Kolkata";
  const now = new Date().toLocaleString("en-IN", { timeZone: tz, weekday: "long", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const system = `A message is about to be sent by ${profile?.display_name ?? "the user"}. Find the commitments it makes — things he will now owe someone once this is sent. Reply ONLY with JSON matching the schema.

Rules:
- A commitment is a future deliverable he promises: "I'll share the plan shortly", "will send it by Friday", "we'll start on Monday". Somebody will wait for it.
- NOT commitments: stating something is already done; describing what happened; asking a question; opinions; pleasantries; work that is simply the task itself being confirmed with no extra deliverable.
- The task this reply belongs to is ALREADY tracked. Only report deliverables BEYOND it — a plan, a follow-up, a call, a second thing. If the message only promises the task itself, return nothing.
- Dates resolve against now: ${now} (${tz}). "shortly" and "soon" carry no date — leave due_iso null rather than inventing one.
- title: short imperative naming what he owes, <= 12 words, English.
- quote: the exact sentence in the message that promises it.
- Be strict. Adding a task he did not promise is noise, and noise is how a list stops being read.`;

  const schema = {
    type: "object", additionalProperties: false,
    properties: {
      promises: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: {
            title: { type: "string" },
            quote: { type: "string" },
            due_iso: { type: ["string", "null"] },
          },
          required: ["title", "quote", "due_iso"],
        },
      },
    },
    required: ["promises"],
  };

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sec.openrouter_key}`, "Content-Type": "application/json",
      "HTTP-Referer": "https://personal-tracker-eta-six.vercel.app", "X-Title": "Tracker",
    },
    body: JSON.stringify({
      model: sec.model_extract, temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `THE MESSAGE:\n${text.slice(0, 3000)}` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "promises", strict: true, schema } },
      usage: { include: true },
    }),
  });
  if (!r.ok) return NextResponse.json({ promises: [] });
  const j = await r.json();

  const u = j.usage ?? {};
  await supabase.from("ai_usage").insert({
    user_id: user.id, purpose: "promises_in_draft", model: sec.model_extract,
    input_tokens: u.prompt_tokens ?? 0, output_tokens: u.completion_tokens ?? 0, cost_usd: u.cost ?? 0,
  });

  try {
    const out = JSON.parse((j.choices?.[0]?.message?.content ?? "{}").replace(/^```(?:json)?|```$/g, "").trim());
    return NextResponse.json({ promises: (out.promises ?? []).slice(0, 3), taskId });
  } catch {
    return NextResponse.json({ promises: [] });
  }
}
