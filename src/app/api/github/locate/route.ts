import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lastCommit } from "@/lib/github";

/**
 * Where in the code does this task live?
 *
 * Amit writes the code himself, so the expensive part of his day is not the
 * work — it is reconstructing, from a sentence someone typed into WhatsApp,
 * which of four projects it belongs to and which files to open. "Linked lead
 * search on create invoice is not working" is a perfectly clear instruction to
 * a human who already holds the codebase in their head, and useless to one who
 * does not.
 *
 * Deliberately paths only: the model is given file names, the README and the
 * task, never the source. That is enough to reason about structure, it keeps
 * the call cheap, and it means connecting a repository does not ship anyone's
 * code to a model provider.
 *
 * The answer is a lead, not a fact. It names files, says why each one, and
 * gives its confidence — and the panel that shows it says "probably".
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { taskId, refresh } = await request.json().catch(() => ({}));
  if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });

  // Computed once and kept: the answer does not change until the code does, and
  // paying a model every time a task is opened is how a feature gets switched off.
  if (!refresh) {
    const { data: cached } = await supabase.from("task_code_hints").select("*").eq("task_id", taskId).maybeSingle();
    if (cached) return NextResponse.json({ ...cached, cached: true });
  }

  const [{ data: task }, { data: sec }, { data: repos }, { data: spend }] = await Promise.all([
    supabase.from("tasks").select("id,title,description,source_quote,project_id").eq("id", taskId).is("deleted_at", null).maybeSingle(),
    supabase.from("user_secrets").select("openrouter_key, model_extract, monthly_cap_usd").maybeSingle(),
    supabase.from("github_repos").select("full_name,description,language,readme,paths,path_count").eq("enabled", true).not("paths", "is", null),
    supabase.rpc("month_spend", { uid: user.id }),
  ]);

  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  if (!sec?.openrouter_key) return NextResponse.json({ error: "Add your OpenRouter key in Settings first" }, { status: 400 });
  if (!repos?.length) return NextResponse.json({ error: "No repositories are switched on and indexed yet" }, { status: 400 });
  if (Number(spend ?? 0) >= Number(sec.monthly_cap_usd)) {
    return NextResponse.json({ error: `Monthly AI cap of $${sec.monthly_cap_usd} reached` }, { status: 400 });
  }

  const { data: project } = task.project_id
    ? await supabase.from("projects").select("name").eq("id", task.project_id).maybeSingle()
    : { data: null };

  // One repo's worth of paths is a few thousand lines; several would swamp the
  // request and the cost. Trimmed per repo so every candidate still appears.
  const budget = Math.max(300, Math.floor(2400 / repos.length));
  const catalogue = repos.map(r => [
    `## ${r.full_name}${r.language ? ` · ${r.language}` : ""}`,
    r.description ? `${r.description}` : "",
    r.readme ? `README (start): ${r.readme.slice(0, 600).replace(/\s+/g, " ")}` : "",
    `Files (${r.path_count}${(r.paths as string[]).length < (r.path_count ?? 0) ? ", trimmed" : ""}):`,
    (r.paths as string[]).slice(0, budget).join("\n"),
  ].filter(Boolean).join("\n")).join("\n\n");

  const system = `You are helping a developer work out where in his own codebases a piece of work belongs. Reply ONLY with JSON matching the schema.

You are given every repository he has switched on: its name, description, README opening and its file paths. You are NOT given the source code — reason from paths, names and conventions.

Rules:
- Pick the ONE repository the task belongs to. If nothing fits, set repo to null and confidence below 0.3 rather than guessing.
- Name 2 to 5 files he should open, most likely first. Each must be a path that appears verbatim in that repository's list. Never invent a path.
- For each file, one short sentence on why it is relevant — what you believe it does, based on its name and where it sits.
- "reason" is 1-2 sentences: how you read the task and what led you to this part of the codebase. Plain English, no preamble.
- Requests are often written by non-developers describing a symptom, in English or Hinglish. "Linked lead search on create invoice is not working" means the search control on the invoice creation screen. Translate the symptom into the feature, then the feature into files.
- confidence 0-1. Be honest: a vague task against an unfamiliar structure is a 0.4, not a 0.9. He will open these files, so a confident wrong answer costs him more than an uncertain right one.`;

  const user_msg = [
    `TASK: ${task.title}`,
    task.description ? `DETAILS: ${task.description}` : "",
    task.source_quote ? `ORIGINALLY WRITTEN AS: “${task.source_quote}”` : "",
    project?.name ? `PROJECT IN TRACKER: ${project.name}` : "",
    "",
    "REPOSITORIES",
    catalogue,
  ].filter(Boolean).join("\n");

  const schema = {
    type: "object", additionalProperties: false,
    properties: {
      repo: { type: ["string", "null"] },
      reason: { type: "string" },
      confidence: { type: "number" },
      files: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: { path: { type: "string" }, why: { type: "string" } },
          required: ["path", "why"],
        },
      },
    },
    required: ["repo", "reason", "confidence", "files"],
  };

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sec.openrouter_key}`, "Content-Type": "application/json",
      "HTTP-Referer": "https://personal-tracker-eta-six.vercel.app", "X-Title": "Tracker",
    },
    body: JSON.stringify({
      model: sec.model_extract, temperature: 0.1,
      messages: [{ role: "system", content: system }, { role: "user", content: user_msg }],
      response_format: { type: "json_schema", json_schema: { name: "locate", strict: true, schema } },
      usage: { include: true },
    }),
  });
  const j = await r.json();
  if (!r.ok) return NextResponse.json({ error: `OpenRouter ${r.status}: ${j?.error?.message ?? "error"}` }, { status: 502 });

  const usage = j.usage ?? {};
  await supabase.from("ai_usage").insert({
    user_id: user.id, purpose: "locate_code", model: sec.model_extract,
    input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0, cost_usd: usage.cost ?? 0,
  });

  let out: { repo: string | null; reason: string; confidence: number; files: { path: string; why: string }[] };
  try {
    out = JSON.parse((j.choices?.[0]?.message?.content ?? "{}").replace(/^```(?:json)?|```$/g, "").trim());
  } catch {
    return NextResponse.json({ error: "The model returned nothing usable" }, { status: 502 });
  }

  // A path the model invented is worse than no answer: it sends him looking for
  // a file that does not exist and quietly discredits the whole panel.
  const chosen = repos.find(x => x.full_name === out.repo);
  const known = new Set((chosen?.paths as string[] | undefined) ?? []);
  const files = (out.files ?? []).filter(f => known.has(f.path)).slice(0, 5);

  // Who touched each file last — the context that turns a path into a lead.
  const { data: gh } = await supabase.from("user_secrets").select("github_token").maybeSingle();
  const enriched = gh?.github_token && chosen
    ? await Promise.all(files.map(async f => ({ ...f, ...(await lastCommit(gh.github_token!, chosen.full_name, f.path) ?? {}) })))
    : files;

  const row = {
    user_id: user.id, task_id: taskId,
    repo: chosen?.full_name ?? null,
    files: enriched,
    reason: out.reason ?? "",
    // Naming files that do not exist is itself evidence the answer is weak.
    confidence: files.length ? out.confidence ?? 0 : Math.min(out.confidence ?? 0, 0.2),
    model: sec.model_extract,
  };
  const { error: saveErr } = await supabase.from("task_code_hints").upsert(row, { onConflict: "task_id" });
  if (saveErr) console.error("code hint save failed", saveErr);

  return NextResponse.json({ ...row, cached: false });
}
