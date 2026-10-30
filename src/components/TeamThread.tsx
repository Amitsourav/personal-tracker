"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { teamEmail, initials } from "@/lib/team";
import type { Task, TaskComment, TeamMember } from "@/lib/types";
import { Popover } from "./ui";
import { formatDistanceToNow } from "date-fns";
import { Check, CornerUpLeft, MessageCircleQuestion, Eye, Send, UserRound, UserPlus, Users, X } from "lucide-react";
import clsx from "clsx";

/**
 * Who a task is handed to. Assigning emails them; un-assigning does not.
 *
 * Compact is the one on every task row: initials when someone has it, a faint
 * "assign" icon when nobody does — visible without hovering, because handing
 * work out from the list is the point, and phones have no hover.
 */
export function AssigneePicker({ task, compact }: { task: Task; compact?: boolean }) {
  const { team, updateTask } = useStore();
  const who = team.find(m => m.id === task.assignee_id);
  const lead = team.find(m => m.id === task.lead_id);
  const via = lead ? ` (via ${lead.name.split(" ")[0]})` : "";
  async function assign(m: TeamMember | null) {
    // Amit assigning directly takes it out of any lead's chain.
    await updateTask(task.id, { assignee_id: m?.id ?? null, lead_id: null, review_stage: null });
    if (m) {
      useStore.getState().toast(`Assigned to ${m.name}`);
      await teamEmail("assigned", { taskId: task.id });
    }
  }
  // No team yet: an empty assign button on every row would only be clutter.
  if (compact && !team.length && !who) return null;
  const trigger = compact
    ? who
      ? <button className="w-5 h-5 rounded-full bg-p3-soft text-p3 grid place-items-center text-[9.5px] font-semibold flex-none hover:ring-2 hover:ring-p3/30" title={`Assigned to ${who.name}${via} — click to change`}>{initials(who.name)}</button>
      : <button className="w-5 h-5 rounded-full grid place-items-center text-ink-3 opacity-50 hover:opacity-100 hover:bg-hover flex-none" title="Assign to someone"><UserPlus size={12} /></button>
    : <button className="pill text-ink-2 hover:bg-hover">
        {who ? <><span className="w-4 h-4 rounded-full bg-p3-soft text-p3 grid place-items-center text-[8.5px] font-semibold">{initials(who.name)}</span>{who.name}{via && <span className="text-ink-3">{via}</span>}</> : <><UserRound size={11} /> Me</>}
      </button>;
  return (
    <Popover trigger={trigger}>
      {(close) => <>
        <button className="menu-item" data-active={!who} onClick={() => { assign(null); close(); }}><UserRound size={12} /> Me</button>
        {team.map(m => (
          <button key={m.id} className="menu-item" data-active={who?.id === m.id} onClick={() => { assign(m); close(); }}>
            <span className="w-4 h-4 rounded-full bg-p3-soft text-p3 grid place-items-center text-[8.5px] font-semibold">{initials(m.name)}</span>
            {m.name}{!m.joined_at && <span className="ml-auto text-[10.5px] text-ink-3">invited</span>}
          </button>
        ))}
        {!team.length && <Link href="/team" className="menu-item text-ink-3" onClick={close}>Add people on the Team page →</Link>}
      </>}
    </Popover>
  );
}

const LABEL: Record<TaskComment["kind"], string> = {
  comment: "", status_request: "asked for an update", review_request: "asked for a review",
  submitted: "sent this for review", approved: "approved it", returned: "sent it back", status: "moved it to", reminder: "", attachment: "attached",
  delegated: "handed this to", lead_approved: "approved it and sent it to you", created: "created this for",
};
const STATUS_WORD: Record<string, string> = { todo: "To do", in_progress: "In progress", waiting: "Waiting" };

/**
 * The conversation with whoever the task is assigned to, and the three things
 * Amit does with it: ask where it is, ask for their opinion, and — once they
 * send it back — approve it or return it.
 */
export function TeamThread({ task }: { task: Task }) {
  const { team, userId, completeTask, updateTask } = useStore();
  const who = team.find(m => m.id === task.assignee_id);
  const [rows, setRows] = useState<TaskComment[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await createClient().from("task_comments").select("*").eq("task_id", task.id).order("created_at");
    setRows((data ?? []) as TaskComment[]);
  }, [task.id]);

  useEffect(() => {
    load();
    const sb = createClient();
    const ch = sb.channel(`thread-${task.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_comments", filter: `task_id=eq.${task.id}` }, load)
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [task.id, load]);

  // Opening the task is reading it.
  useEffect(() => {
    if (!userId || !rows.some(r => !r.seen_at && r.author_id !== userId)) return;
    createClient().from("task_comments").update({ seen_at: new Date().toISOString() })
      .eq("task_id", task.id).neq("author_id", userId).is("seen_at", null)
      .then(() => window.dispatchEvent(new Event("team-seen")));
  }, [rows, task.id, userId]);

  if (!who && !rows.length) return null;

  async function post(kind: TaskComment["kind"], body: string | null) {
    const { error } = await createClient().from("task_comments")
      .insert({ task_id: task.id, owner_id: userId, author_id: userId, kind, body });
    if (error) { useStore.getState().toast("Couldn't save: " + error.message); return false; }
    await load();
    return true;
  }

  async function act(kind: "comment" | "status_request" | "review_request" | "approved" | "returned") {
    const body = text.trim() || null;
    if (kind === "comment" && !body) return;
    if (kind === "returned" && !body) { useStore.getState().toast("Write what needs changing first"); return; }
    setBusy(true);
    if (await post(kind, body)) {
      setText("");
      if (kind === "approved") await completeTask(task.id);
      if (kind === "returned") await updateTask(task.id, { status: "in_progress", review_stage: null });
      if (kind === "status_request" || kind === "review_request" || kind === "returned") {
        const ok = (await teamEmail(kind, { taskId: task.id, note: body ?? undefined })).ok;
        if (ok) useStore.getState().toast(`Emailed ${who?.name ?? "them"}`);
      }
    }
    setBusy(false);
  }

  const name = (c: TaskComment) => c.author_id === userId ? "You" : (who?.member_id === c.author_id ? who.name : team.find(m => m.member_id === c.author_id)?.name ?? "Team member");
  const openRequest = [...rows].reverse().find(r => (r.kind === "status_request" || r.kind === "review_request") && !r.resolved_at);
  const inReview = task.status === "in_review";
  const taskLead = team.find(m => m.id === task.lead_id);

  return (
    <div className="rounded-xl border border-line p-3 grid gap-2.5">
      <div className="text-[11px] font-semibold text-ink-3 uppercase tracking-wide flex items-center gap-1.5">
        Team {who && <span className="normal-case font-normal tracking-normal">· with {who.name}{!who.member_id && " (hasn't signed in yet)"}</span>}
      </div>

      {inReview && (
        <div className="rounded-lg bg-p3-soft text-p3 px-2.5 py-2 text-[12.5px] flex items-center gap-2">
          <Eye size={13} className="flex-none" />
          <span className="flex-1">{task.review_stage === "lead" && taskLead
            ? `${who?.name ?? "They"} sent this to ${taskLead.name} for review — waiting on ${taskLead.name.split(" ")[0]}. You can still decide yourself.`
            : `${who?.name ?? "They"} sent this for your review${taskLead ? `, approved by ${taskLead.name.split(" ")[0]}` : ""}.`}</span>
        </div>
      )}
      {openRequest && !inReview && (
        <div className="text-[12px] text-ink-3">Waiting for {who?.name ?? "them"} to reply to your {openRequest.kind === "status_request" ? "update request" : "review request"} · {formatDistanceToNow(new Date(openRequest.created_at), { addSuffix: true })}</div>
      )}

      {rows.length > 0 && (
        <div className="grid gap-2 max-h-[320px] overflow-y-auto">
          {rows.map(c => (
            <div key={c.id} className="text-[12.5px]">
              {c.kind === "reminder" ? (
                <div className="text-ink-3 text-[11.5px]">Automatic reminder emailed ({c.body}) · {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</div>
              ) : c.kind === "delegated" || c.kind === "created" ? (
                <div className="text-ink-3 text-[11.5px]">{name(c)} {LABEL[c.kind]} {c.body} · {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</div>
              ) : c.kind === "status" ? (
                <div className="text-ink-3 text-[11.5px]">{name(c)} moved it to {STATUS_WORD[c.body ?? ""] ?? c.body} · {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</div>
              ) : (
                <div className={clsx("rounded-lg px-2.5 py-1.5", c.author_id === userId ? "bg-panel-2" : "bg-selected")}>
                  <div className="text-[11px] text-ink-3 mb-0.5">
                    <span className="font-medium text-ink-2">{name(c)}</span>{LABEL[c.kind] && ` ${LABEL[c.kind]}`} · {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                  </div>
                  {c.body && <div className={clsx("whitespace-pre-wrap break-words", c.kind === "attachment" && "font-medium")}>{c.kind === "attachment" ? `📎 ${c.body}` : c.body}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {who && (
        <>
          <textarea className="w-full bg-panel-2 rounded-lg p-2 outline-none text-[13px] resize-none min-h-[52px] border border-transparent focus:border-line"
            placeholder={inReview ? "Feedback (needed to send it back)…" : `Message ${who.name.split(" ")[0]}…`}
            value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); act("comment"); } }} />
          <div className="flex flex-wrap gap-1.5">
            {inReview ? (
              <>
                <button className="btn sm primary" disabled={busy} onClick={() => act("approved")}><Check size={13} /> Approve & close</button>
                <button className="btn sm" disabled={busy} onClick={() => act("returned")}><CornerUpLeft size={13} /> Send back</button>
              </>
            ) : (
              <>
                <button className="btn sm" disabled={busy} onClick={() => act("status_request")} title="Emails them asking for an update"><MessageCircleQuestion size={13} /> Ask for update</button>
                <button className="btn sm" disabled={busy} onClick={() => act("review_request")} title="Emails them asking for their opinion"><Eye size={13} /> Ask to review</button>
              </>
            )}
            <button className="btn sm ml-auto" disabled={busy || !text.trim()} onClick={() => act("comment")} title="⌘↵"><Send size={13} /> Send</button>
          </div>
          <div className="text-[11px] text-ink-3">“Ask for update”, “Ask to review” and “Send back” also email {who.email}. Anything typed above goes with it.</div>
        </>
      )}
      {!who && <div className="text-[11.5px] text-ink-3 flex items-center gap-1"><X size={11} /> No longer assigned to anyone.</div>}
    </div>
  );
}

/**
 * One piece of work, several people: a part (sub-task) per person, each with
 * the original's notes, date and priority. The original stays with Amit and
 * shows progress; every part is assigned, emailed and reviewed on its own.
 */
export function SplitBetween({ task }: { task: Task }) {
  const { team, addTask } = useStore();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  if (!team.length || task.parent_id) return null;
  const toggle = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  async function split(close: () => void) {
    const people = team.filter(m => picked.includes(m.id));
    if (people.length < 2) return;
    setBusy(true);
    let n = 0;
    for (const [i, m] of people.entries()) {
      const part = await addTask({
        title: `${task.title} — ${m.name}`, parent_id: task.id, description: task.description,
        due_at: task.due_at, due_has_time: task.due_has_time, priority: task.priority, project_id: task.project_id,
        status: "todo", assignee_id: m.id, sort_order: i,
      });
      if (part) { n++; await teamEmail("assigned", { taskId: part.id }); }
    }
    setBusy(false);
    setPicked([]);
    close();
    useStore.getState().toast(`Split into ${n} parts — each person has been emailed`);
  }

  return (
    <Popover trigger={<button className="pill text-ink-3 hover:bg-hover" title="Give each person their own part of this task"><Users size={11} /> Split</button>}>
      {(close) => (
        <div className="w-[250px] grid gap-1">
          <div className="px-2 pt-1 text-[11.5px] text-ink-3">Each person gets their own part, with this task&apos;s notes and due date.</div>
          {team.map(m => (
            <button key={m.id} className="menu-item" onClick={() => toggle(m.id)}>
              <span className={clsx("checkbox !w-[13px] !h-[13px]", picked.includes(m.id) && "done")}>{picked.includes(m.id) && <Check size={9} />}</span>
              {m.name}
            </button>
          ))}
          <button className="btn sm primary m-1" disabled={busy || picked.length < 2} onClick={() => split(close)}>
            {busy ? "Creating…" : picked.length < 2 ? "Choose 2 or more" : `Create ${picked.length} parts`}
          </button>
        </div>
      )}
    </Popover>
  );
}
