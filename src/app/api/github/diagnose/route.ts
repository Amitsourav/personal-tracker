import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fileText } from "@/lib/github";

/**
 * What is actually wrong?
 *
 * Clients report symptoms, not bugs. "Some Gauri Bhatnagar is coming in
 * disbursed and payment received but not on CRM invoice 30" is a perfectly
 * clear description of an experience and tells you nothing about a cause. The
 * gap between that sentence and a named function is where the hours go.
 *
 * This is the one feature in the GitHub set that reads the source, and so the
 * only one that sends code to a model. Everything else — locating files,
 * already-done, impact — deliberately works from names alone. That distinction
 * is worth keeping visible rather than quietly eroding, so this is opt-in on
 * every task and the panel says plainly what it is about to do.
 *
 * It runs on the planning model, not the reading one. Diagnosis is the hardest
 * reasoning in the app: everything else summarises or classifies, this infers a
 * cause from evidence.
 */
const MAX_FILES = 3;
const MAX_CHARS_PER_FILE = 18_000;
const MAX_TOTAL = 45_000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { taskId, refresh } = await request.json().catch(() => ({}));
  if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });

  const [{ data: hint }, { data: task }, { data: sec }, { data: spend }] = await Promise.all([
    supabase.from("task_code_hints").select("*").eq("task_id", taskId).maybeSingle(),
    supabase.from("tasks").select("title,description,source_quote").eq("id", taskId).is("deleted_at", null).maybeSingle(),
    supabase.from("user_secrets").select("github_token, openrouter_key, model_plan, monthly_cap_usd").maybeSingle(),
    supabase.rpc("month_spend", { uid: user.id }),
  ]);

  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  if (!hint?.repo) return NextResponse.json({ error: "Find where the code is first" }, { status: 400 });
  if (hint.diagnosis && !refresh) return NextResponse.json({ diagnosis: hint.diagnosis, cached: true });
  if (!sec?.github_token) return NextResponse.json({ error: "No GitHub token" }, { status: 400 });
  if (!sec.openrouter_key) return NextResponse.json({ error: "Add your OpenRouter key in Settings first" }, { status: 400 });
  if (Number(spend ?? 0) >= Number(sec.monthly_cap_usd)) {
    return NextResponse.json({ error: `Monthly AI cap of $${sec.monthly_cap_usd} reached` }, { status: 400 });
  }

  const wanted = (hint.files as { path: string; why?: string }[] ?? []).slice(0, MAX_FILES);
  const sources: { path: string; text: string; truncated: boolean }[] = [];
  let budget = MAX_TOTAL;

  for (const f of wanted) {
    if (budget <= 0) break;
    const text = await fileText(sec.github_token, hint.repo, f.path);
    if (!text) continue;
    const cap = Math.min(MAX_CHARS_PER_FILE, budget);
    sources.push({ path: f.path, text: text.slice(0, cap), truncated: text.length > cap });
    budget -= Math.min(text.length, cap);
  }

  if (!sources.length) return NextResponse.json({ error: "Could not read any of those files" }, { status: 400 });

  // What else calls into these, when it is already known. A cause that sits in a
  // caller rather than the file itself is a common and expensive miss.
  const impact = hint.impact as { groups?: { file: string; refs?: { path: string; symbols: string[] }[] }[] } | null;
  const callers = (impact?.groups ?? [])
    .flatMap(g => (g.refs ?? []).map(r => `${r.path} uses ${r.symbols.join(", ")} from ${g.file}`))
    .slice(0, 12);

  const system = `You are diagnosing a reported problem in a codebase you have been given the relevant files from. Reply ONLY with JSON matching the schema.

The report was written by a non-developer describing what they saw — a client, a colleague, often in English or Hinglish. It describes a symptom, not a cause.

Rules:
- Work out the most likely CAUSE, and say it in plain English a non-developer could follow. Name the function or query at fault and what it is doing wrong.
- "where" names the exact places to look: file, the function or block, and why that one. Only files you were given.
- "check_first" is the single cheapest thing that would confirm or kill your theory — a query to run, a value to print, a case to try. One sentence.
- "fix_sketch" is what the change probably is, in a sentence or two. Do not write the code.
- "unknowns" names what you could not see that would change your answer: a file you were not given, the database schema, how the data got there. Be specific. If you genuinely have enough, say so.
- confidence 0-1. A symptom with one plausible cause in the files given is 0.7. A symptom that could have five causes, three of them outside these files, is 0.3. Being confidently wrong sends him to rewrite the wrong function, so understate rather than overstate.
- Never invent a file, function or line that is not in what you were given.`;

  const user_msg = [
    `REPORTED PROBLEM: ${task.title}`,
    task.description ? `DETAILS: ${task.description}` : "",
    task.source_quote ? `EXACTLY AS REPORTED: “${task.source_quote}”` : "",
    `REPOSITORY: ${hint.repo}`,
    callers.length ? `\nKNOWN CALLERS:\n${callers.join("\n")}` : "",
    "",
    ...sources.map(s => `--- ${s.path}${s.truncated ? " (truncated)" : ""} ---\n${s.text}`),
  ].filter(Boolean).join("\n");

  const schema = {
    type: "object", additionalProperties: false,
    properties: {
      cause: { type: "string" },
      check_first: { type: "string" },
      fix_sketch: { type: "string" },
      unknowns: { type: "string" },
      confidence: { type: "number" },
      where: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: { path: { type: "string" }, symbol: { type: "string" }, why: { type: "string" } },
          required: ["path", "symbol", "why"],
        },
      },
    },
    required: ["cause", "check_first", "fix_sketch", "unknowns", "confidence", "where"],
  };

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sec.openrouter_key}`, "Content-Type": "application/json",
      "HTTP-Referer": "https://personal-tracker-eta-six.vercel.app", "X-Title": "Tracker",
    },
    body: JSON.stringify({
      model: sec.model_plan, temperature: 0.2,
      messages: [{ role: "system", content: system }, { role: "user", content: user_msg }],
      response_format: { type: "json_schema", json_schema: { name: "diagnosis", strict: true, schema } },
      usage: { include: true },
    }),
  });
  const j = await r.json();

  const u = j.usage ?? {};
  await supabase.from("ai_usage").insert({
    user_id: user.id, purpose: "diagnose", model: sec.model_plan,
    input_tokens: u.prompt_tokens ?? 0, output_tokens: u.completion_tokens ?? 0, cost_usd: u.cost ?? 0,
  });
  if (!r.ok) return NextResponse.json({ error: `OpenRouter ${r.status}: ${j?.error?.message ?? "error"}` }, { status: 502 });

  let out;
  try {
    out = JSON.parse((j.choices?.[0]?.message?.content ?? "{}").replace(/^```(?:json)?|```$/g, "").trim());
  } catch {
    return NextResponse.json({ error: "The model returned nothing usable" }, { status: 502 });
  }

  // Same rule as the locate panel: a place that does not exist sends him
  // hunting for it and discredits everything else on the screen.
  const given = new Set(sources.map(s => s.path));
  const where = (out.where ?? []).filter((w: { path: string }) => given.has(w.path)).slice(0, 4);

  const diagnosis = {
    ...out,
    where,
    confidence: where.length ? out.confidence ?? 0 : Math.min(out.confidence ?? 0, 0.25),
    read: sources.map(s => ({ path: s.path, truncated: s.truncated })),
    model: sec.model_plan,
    at: new Date().toISOString(),
  };

  const { error } = await supabase.from("task_code_hints").update({ diagnosis }).eq("task_id", taskId);
  if (error) console.error("diagnosis save failed", error);

  return NextResponse.json({ diagnosis, cached: false });
}
