// Supabase Edge Function: the tracker, as an MCP server.
//
// Every AI tool keeps its context inside its own app, so the same project gets
// re-explained to Cursor, then to Claude Code, then to ChatGPT. That is the
// documented gap of 2026 and the reason this exists: the tracker holds the one
// thing those tools cannot know — what the client actually asked for, in the
// words they used, and which of them is still waiting.
//
// Sitting here rather than in the Next app because this needs the service key
// to resolve a bearer token to a user, and the web app deliberately ships no
// server secrets. verify_jwt is off; the token is checked below.
//
// Read-mostly by design. It can create a task, because noting one down without
// leaving the editor is the point; it cannot complete, edit or delete one.
// Nothing an editor does by accident should be able to destroy work.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PROTOCOL = "2025-06-18";

type Rpc = { jsonrpc: "2.0"; id?: number | string | null; method: string; params?: Record<string, unknown> };

const TOOLS = [
  {
    name: "search_tasks",
    description:
      "Search the user's open tasks. Use this to find out what he is supposed to be doing, " +
      "or whether something is already tracked before suggesting he write it down again.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to match in the title or description. Omit for everything open." },
        status: { type: "string", enum: ["open", "done", "all"], description: "Defaults to open." },
        limit: { type: "integer", description: "Default 20, maximum 50." },
      },
    },
  },
  {
    name: "get_task",
    description:
      "Everything known about one task: what was asked, who asked, the exact sentence they wrote, " +
      "which repository and files it belongs to, any diagnosis, and the estimate.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The task's id." },
        title: { type: "string", description: "Or part of its title, if the id is not known." },
      },
    },
  },
  {
    name: "what_was_asked",
    description:
      "The original messages behind the work — the actual email or WhatsApp text, from whom and when. " +
      "Use this when a task's title is too short to act on, or to check what a client literally said " +
      "before assuming what they meant.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to match in the message body, subject or sender." },
        limit: { type: "integer", description: "Default 5, maximum 20." },
      },
      required: ["query"],
    },
  },
  {
    name: "tasks_for_repo",
    description:
      "Open tasks that have been traced to a repository, with the files each one points at. " +
      "Use this when opening a project to see what is outstanding in it.",
    inputSchema: {
      type: "object",
      properties: { repo: { type: "string", description: 'Full name, e.g. "Amitsourav/CRM_UI".' } },
      required: ["repo"],
    },
  },
  {
    name: "add_task",
    description:
      "Write down something that needs doing, without leaving the editor. It goes straight onto his " +
      "list. Only for work he has actually decided on — not speculative suggestions.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short and imperative." },
        details: { type: "string" },
        due: { type: "string", description: "ISO 8601 date or datetime, if there is a real deadline." },
      },
      required: ["title"],
    },
  },
];

Deno.serve(async (req) => {
  if (req.method === "GET") {
    // A browser or a health check. Says what this is without leaking anything.
    return json({ name: "tracker", protocol: PROTOCOL, transport: "streamable-http", tools: TOOLS.map(t => t.name) });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const token = req.headers.get("Authorization")?.replace(/^Bearer /i, "").trim() ?? "";
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: uid } = token ? await db.rpc("user_by_mcp_token", { tok: token }) : { data: null };

  let msg: Rpc;
  try { msg = await req.json(); } catch { return rpcError(null, -32700, "Parse error"); }

  // A notification has no id and expects no reply.
  if (msg.method?.startsWith("notifications/")) return new Response(null, { status: 202 });

  if (msg.method === "initialize") {
    // Answered before the token is checked, so a misconfigured client gets a
    // clear failure on its first real call instead of an opaque handshake error.
    return rpcOk(msg.id, {
      protocolVersion: PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: "tracker", version: "1.0.0" },
      instructions:
        "Amit's task tracker. It knows what clients and colleagues have actually asked him for, " +
        "in their own words, and which of it is still outstanding. Prefer what_was_asked over " +
        "guessing what a short task title means.",
    });
  }

  if (!uid) return rpcError(msg.id ?? null, -32001, "Unauthorized — check the Tracker token in your MCP config");

  if (msg.method === "tools/list") return rpcOk(msg.id, { tools: TOOLS });

  if (msg.method === "tools/call") {
    const name = (msg.params?.name ?? "") as string;
    const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
    try {
      const text = await call(db, uid as string, name, args);
      return rpcOk(msg.id, { content: [{ type: "text", text }] });
    } catch (e) {
      console.error("mcp tool failed", name, e);
      return rpcOk(msg.id, { content: [{ type: "text", text: `Failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
    }
  }

  return rpcError(msg.id ?? null, -32601, `Unknown method: ${msg.method}`);
});

async function call(db: SupabaseClient, uid: string, name: string, a: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "search_tasks": {
      const limit = Math.min(Number(a.limit ?? 20), 50);
      let q = db.from("tasks")
        .select("id,title,description,status,priority,due_at,start_at,person_id,source_kind")
        .eq("user_id", uid).is("deleted_at", null).eq("review_state", "accepted")
        .order("priority").order("due_at", { nullsFirst: false }).limit(limit);
      const status = String(a.status ?? "open");
      if (status === "open") q = q.not("status", "in", "(done,cancelled)");
      else if (status === "done") q = q.eq("status", "done");
      if (a.query) q = q.or(`title.ilike.%${esc(String(a.query))}%,description.ilike.%${esc(String(a.query))}%`);
      const { data, error } = await q;
      if (error) throw error;
      if (!data?.length) return "No matching tasks.";
      const people = await names(db, uid);
      return data.map(t =>
        `• ${t.title}  [${t.id}]\n  ${t.status} · P${t.priority}` +
        `${t.due_at ? ` · due ${t.due_at.slice(0, 10)}` : ""}` +
        `${t.start_at ? ` · planned ${t.start_at.slice(0, 10)}` : ""}` +
        `${t.person_id && people[t.person_id] ? ` · from ${people[t.person_id]}` : ""}` +
        `${t.description ? `\n  ${String(t.description).replace(/\s+/g, " ").slice(0, 200)}` : ""}`
      ).join("\n");
    }

    case "get_task": {
      let q = db.from("tasks").select("*").eq("user_id", uid).is("deleted_at", null);
      q = a.task_id ? q.eq("id", String(a.task_id)) : q.ilike("title", `%${esc(String(a.title ?? ""))}%`);
      const { data: rows } = await q.limit(1);
      const t = rows?.[0];
      if (!t) return "No such task.";

      const [{ data: hint }, people] = await Promise.all([
        db.from("task_code_hints").select("*").eq("task_id", t.id).maybeSingle(),
        names(db, uid),
      ]);

      const out = [
        `${t.title}`,
        `id: ${t.id}`,
        `status: ${t.status} · priority ${t.priority}${t.due_at ? ` · due ${t.due_at.slice(0, 10)}` : ""}`,
        t.person_id && people[t.person_id] ? `asked by: ${people[t.person_id]}` : "",
        t.description ? `\ndetails:\n${t.description}` : "",
        // The most valuable line in this whole server: their words, not ours.
        t.source_quote ? `\nexactly as asked:\n"${t.source_quote}"` : "",
      ];

      if (hint?.repo) {
        out.push(`\nrepository: ${hint.repo}`);
        for (const f of (hint.files as { path: string; why: string }[] ?? [])) out.push(`  ${f.path} — ${f.why}`);
        const d = hint.diagnosis as { cause?: string; check_first?: string; unknowns?: string } | null;
        if (d?.cause) out.push(`\nlikely cause: ${d.cause}\ncheck first: ${d.check_first}\nnot known: ${d.unknowns}`);
        const e = hint.estimate as { low?: number; high?: number } | null;
        if (e?.low) out.push(`\nestimated: ${e.low}-${e.high} minutes`);
        if (hint.maybe_done) out.push(`\nNOTE: may already be done — ${(hint.done_commit as { message?: string })?.message ?? ""}`);
      }
      return out.filter(Boolean).join("\n");
    }

    case "what_was_asked": {
      const limit = Math.min(Number(a.limit ?? 5), 20);
      const term = esc(String(a.query ?? ""));
      const { data } = await db.from("messages")
        .select("sender_name,sender_handle,subject,body,sent_at,channel")
        .eq("user_id", uid).is("skipped_reason", null).not("body", "is", null)
        .or(`body.ilike.%${term}%,subject.ilike.%${term}%,sender_name.ilike.%${term}%`)
        .order("sent_at", { ascending: false }).limit(limit);
      if (!data?.length) return "Nothing matching in the captured messages. Note that message bodies are deleted after 30 days.";
      return data.map(m =>
        `[${m.channel}] ${m.sender_name ?? m.sender_handle ?? "unknown"} · ${m.sent_at.slice(0, 16).replace("T", " ")}` +
        `${m.subject ? `\nsubject: ${m.subject}` : ""}\n${String(m.body).replace(/\n{3,}/g, "\n\n").slice(0, 1200)}`
      ).join("\n\n---\n\n");
    }

    case "tasks_for_repo": {
      const repo = String(a.repo ?? "");
      const { data } = await db.from("task_code_hints")
        .select("task_id,files,tasks!inner(id,title,status,priority,due_at,deleted_at,review_state)")
        .eq("user_id", uid).eq("repo", repo);
      const rows = (data ?? []).filter((r: { tasks: { status: string; deleted_at: string | null; review_state: string } }) =>
        r.tasks && !r.tasks.deleted_at && r.tasks.review_state === "accepted"
        && r.tasks.status !== "done" && r.tasks.status !== "cancelled");
      if (!rows.length) return `Nothing open traced to ${repo}.`;
      return rows.map((r: { tasks: { id: string; title: string; priority: number; due_at: string | null }; files: { path: string }[] }) =>
        `• ${r.tasks.title}  [${r.tasks.id}]\n  P${r.tasks.priority}${r.tasks.due_at ? ` · due ${r.tasks.due_at.slice(0, 10)}` : ""}` +
        `\n  ${(r.files ?? []).map(f => f.path).join("\n  ")}`
      ).join("\n");
    }

    case "add_task": {
      const title = String(a.title ?? "").trim();
      if (!title) return "A title is required.";
      const { data, error } = await db.from("tasks").insert({
        user_id: uid, title: title.slice(0, 200),
        description: a.details ? String(a.details) : null,
        status: "todo", priority: 3,
        due_at: a.due ? new Date(String(a.due)).toISOString() : null,
        source_kind: "manual",
        ai_meta: { via: "mcp" },
      }).select("id").single();
      if (error) throw error;
      return `Added: ${title}  [${data.id}]`;
    }
  }
  throw new Error(`Unknown tool: ${name}`);
}

/** Person ids to names, so tasks can say who asked without a join per row. */
async function names(db: SupabaseClient, uid: string) {
  const { data } = await db.from("people").select("id,name").eq("user_id", uid);
  return Object.fromEntries((data ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
}

/** PostgREST's or() takes a comma-separated filter list; commas in user input break it. */
const esc = (s: string) => s.replace(/[,()%]/g, " ").trim().slice(0, 100);

function rpcOk(id: unknown, result: unknown) {
  return json({ jsonrpc: "2.0", id: id ?? null, result });
}
function rpcError(id: unknown, code: number, message: string) {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
