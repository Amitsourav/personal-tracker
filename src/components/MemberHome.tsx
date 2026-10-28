"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore, isOpen } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { STATUS_LABEL, type TaskStatus } from "@/lib/types";
import { format, formatDistanceToNow } from "date-fns";
import { ChevronDown, ChevronRight, Eye, LogOut, MessageCircleQuestion, Plus, RefreshCw, Send } from "lucide-react";
import clsx from "clsx";
import { Attachments } from "./Attachments";

type MTask = {
  id: string; title: string; description: string | null; status: TaskStatus; priority: number;
  due_at: string | null; due_has_time: boolean; created_at: string; updated_at: string; completed_at: string | null;
  done: boolean; project_name: string | null; owner_name: string; comment_count: number;
  open_request: { kind: "status_request" | "review_request"; body: string | null; created_at: string } | null;
};
type MComment = { id: string; kind: string; body: string | null; created_at: string; mine: boolean; author: string };

const WORKING: TaskStatus[] = ["todo", "in_progress", "waiting"];

/**
 * What a team member sees. Deliberately not the owner's app with things hidden:
 * a separate, small screen that can only show what member_tasks() returns, so
 * nothing of Amit's can leak through a page someone forgot to lock down.
 */
export function MemberHome() {
  const { membership } = useStore();
  const router = useRouter();
  const [tasks, setTasks] = useState<MTask[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const owner = membership[0]?.owner_name ?? "your manager";

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc("member_tasks");
    if (error) { useStore.getState().toast("Couldn't load tasks: " + error.message); return; }
    setTasks((data ?? []) as MTask[]);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener("focus", load);
    return () => { clearInterval(t); window.removeEventListener("focus", load); };
  }, [load]);

  const all = tasks ?? [];
  const asked = all.filter(t => !t.done && t.open_request);
  const working = all.filter(t => !t.done && !t.open_request && t.status !== "in_review");
  const review = all.filter(t => !t.done && t.status === "in_review");
  const closed = all.filter(t => t.done);

  return (
    <div className="h-dvh overflow-y-auto bg-bg">
      <header className="sticky top-0 z-10 bg-bg/90 backdrop-blur border-b border-line">
        <div className="max-w-[760px] mx-auto flex items-center gap-2 px-4 h-14">
          <div className="w-6 h-6 rounded-md bg-accent text-accent-ink grid place-items-center font-semibold text-[13px]">T</div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[14px] leading-tight">Your tasks</div>
            <div className="text-[11.5px] text-ink-3 truncate">from {owner}</div>
          </div>
          <button className="btn ghost sm" onClick={load} title="Refresh"><RefreshCw size={14} /></button>
          <button className="btn ghost sm" title="Sign out" onClick={async () => { await createClient().auth.signOut(); router.push("/login"); }}><LogOut size={14} /></button>
        </div>
      </header>

      <main className="max-w-[760px] mx-auto px-4 py-5 grid gap-6">
        {tasks === null && <div className="text-ink-3 text-[12.5px]">Loading…</div>}
        {tasks && !all.length && <div className="text-ink-3 text-[13px]">Nothing assigned to you yet. When {owner} gives you a task you&apos;ll get an email, and it will appear here.</div>}

        <Group title={`${owner.split(" ")[0]} is waiting for your reply`} tasks={asked} accent openId={openId} setOpenId={setOpenId} reload={load} />
        <Group title="To do" tasks={working} openId={openId} setOpenId={setOpenId} reload={load} />
        <Group title="Sent for review" hint={`Waiting for ${owner.split(" ")[0]} to approve`} tasks={review} openId={openId} setOpenId={setOpenId} reload={load} />
        <Group title="Closed in the last two weeks" tasks={closed} muted openId={openId} setOpenId={setOpenId} reload={load} />

        <OwnTasks />
      </main>
    </div>
  );
}

function Group({ title, hint, tasks, accent, muted, openId, setOpenId, reload }: {
  title: string; hint?: string; tasks: MTask[]; accent?: boolean; muted?: boolean;
  openId: string | null; setOpenId: (id: string | null) => void; reload: () => Promise<void>;
}) {
  if (!tasks.length) return null;
  return (
    <section className="grid gap-1.5">
      <h2 className={clsx("text-[12px] font-semibold", accent ? "text-p1" : "text-ink-2")}>{title} <span className="font-normal text-ink-3 tnum">{tasks.length}</span>{hint && <span className="font-normal text-ink-3"> · {hint}</span>}</h2>
      {tasks.map(t => <Card key={t.id} t={t} muted={muted} open={openId === t.id} toggle={() => setOpenId(openId === t.id ? null : t.id)} reload={reload} />)}
    </section>
  );
}

function Card({ t, open, muted, toggle, reload }: { t: MTask; open: boolean; muted?: boolean; toggle: () => void; reload: () => Promise<void> }) {
  const [comments, setComments] = useState<MComment[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const overdue = !t.done && t.due_at && new Date(t.due_at) < new Date();

  const loadComments = useCallback(async () => {
    const { data } = await createClient().rpc("member_comments", { p_task: t.id });
    setComments((data ?? []) as MComment[]);
  }, [t.id]);
  useEffect(() => { if (open) loadComments(); }, [open, loadComments, t.updated_at]);

  async function act(action: "comment" | "status" | "submit", status?: TaskStatus) {
    if (action === "comment" && !text.trim()) return;
    setBusy(true);
    const { error } = await createClient().rpc("member_act", { p_task: t.id, p_action: action, p_body: text.trim() || null, p_status: status ?? null });
    setBusy(false);
    if (error) { useStore.getState().toast(error.message); return; }
    setText("");
    useStore.getState().toast(action === "submit" ? "Sent for review" : action === "status" ? `Moved to ${STATUS_LABEL[status!]}` : "Sent");
    await Promise.all([reload(), loadComments()]);
  }

  return (
    <div className={clsx("rounded-xl border bg-panel", t.open_request && !t.done ? "border-p1/40" : "border-line", muted && "opacity-70")}>
      <button className="w-full flex items-start gap-2.5 p-3 text-left" onClick={toggle}>
        {open ? <ChevronDown size={15} className="mt-0.5 text-ink-3 flex-none" /> : <ChevronRight size={15} className="mt-0.5 text-ink-3 flex-none" />}
        <div className="flex-1 min-w-0">
          <div className={clsx("text-[13.5px] font-medium leading-snug", t.done && "strike")}>{t.title}</div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11.5px] text-ink-3">
            <span className={clsx("pill", t.status === "in_review" ? "bg-p3-soft text-p3" : "bg-panel-2")}>{STATUS_LABEL[t.status]}</span>
            {t.due_at && <span className={clsx(overdue && "text-p1 font-medium")}>Due {format(new Date(t.due_at), t.due_has_time ? "d MMM, h:mm a" : "EEE d MMM")}</span>}
            {t.priority <= 2 && <span className={t.priority === 1 ? "text-p1" : "text-p2"}>{t.priority === 1 ? "Urgent" : "High priority"}</span>}
            {t.project_name && <span>{t.project_name}</span>}
            {t.comment_count > 0 && <span>{t.comment_count} message{t.comment_count === 1 ? "" : "s"}</span>}
          </div>
          {t.open_request && !t.done && (
            <div className="mt-1.5 text-[12px] text-p1 flex items-start gap-1">
              {t.open_request.kind === "status_request" ? <MessageCircleQuestion size={12} className="mt-0.5 flex-none" /> : <Eye size={12} className="mt-0.5 flex-none" />}
              <span>{t.open_request.kind === "status_request" ? "Asked for an update" : "Asked for your review"} {formatDistanceToNow(new Date(t.open_request.created_at), { addSuffix: true })}{t.open_request.body ? `: “${t.open_request.body}”` : ""}</span>
            </div>
          )}
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 pl-9 grid gap-3">
          {t.description && <div className="text-[13px] text-ink-2 whitespace-pre-wrap break-words bg-panel-2 rounded-lg p-2.5">{t.description}</div>}
          {t.done ? null : <Attachments taskId={t.id} mode="member" />}

          {comments.length > 0 && (
            <div className="grid gap-1.5">
              {comments.map(c => c.kind === "reminder" ? (
                <div key={c.id} className="text-[11.5px] text-ink-3">Reminder emailed to you ({c.body}) · {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</div>
              ) : c.kind === "status" ? (
                <div key={c.id} className="text-[11.5px] text-ink-3">{c.mine ? "You" : c.author} moved it to {STATUS_LABEL[c.body as TaskStatus] ?? c.body} · {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</div>
              ) : (
                <div key={c.id} className={clsx("rounded-lg px-2.5 py-1.5 text-[12.5px]", c.mine ? "bg-panel-2" : "bg-selected")}>
                  <div className="text-[11px] text-ink-3 mb-0.5"><span className="font-medium text-ink-2">{c.mine ? "You" : c.author}</span>{KIND[c.kind] && ` ${KIND[c.kind]}`} · {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</div>
                  {c.body && <div className="whitespace-pre-wrap break-words">{c.kind === "attachment" ? `📎 ${c.body}` : c.body}</div>}
                </div>
              ))}
            </div>
          )}

          {!t.done && (
            <>
              <textarea className="w-full bg-panel-2 rounded-lg p-2.5 outline-none text-[13px] resize-none min-h-[64px] border border-transparent focus:border-line"
                placeholder={t.open_request ? "Write your reply…" : "Add an update or a question…"} value={text} onChange={e => setText(e.target.value)} />
              <div className="flex flex-wrap items-center gap-1.5">
                <button className="btn sm primary" disabled={busy || !text.trim()} onClick={() => act("comment")}><Send size={13} /> Send</button>
                {t.status !== "in_review" && <button className="btn sm" disabled={busy} onClick={() => act("submit")} title="Tells them it's ready. Anything typed above goes with it."><Eye size={13} /> Done — send for review</button>}
                <div className="ml-auto flex gap-1">
                  {WORKING.map(s => (
                    <button key={s} className={clsx("btn sm", t.status === s && "primary")} disabled={busy || t.status === s} onClick={() => act("status", s)}>{STATUS_LABEL[s]}</button>
                  ))}
                </div>
              </div>
              <div className="text-[11px] text-ink-3">Only {t.owner_name.split(" ")[0]} can close a task. When you&apos;re finished, send it for review.</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const KIND: Record<string, string> = {
  comment: "", status_request: "asked for an update", review_request: "asked for your review",
  submitted: "sent this for review", approved: "approved it", returned: "sent it back", attachment: "attached",
};

/** Their own to-dos. Stored under their own account; nobody else can see them. */
function OwnTasks() {
  const { tasks, addTask, completeTask } = useStore();
  const [title, setTitle] = useState("");
  // Fixed at mount: something ticked off stays visible (and undoable) for the visit.
  const [since] = useState(() => Date.now() - 86_400_000);
  const mine = tasks.filter(t => !t.parent_id && (isOpen(t.status) || (t.completed_at && new Date(t.completed_at).getTime() > since)));
  return (
    <section className="grid gap-1.5">
      <h2 className="text-[12px] font-semibold text-ink-2">My own to-dos <span className="font-normal text-ink-3">· only you can see these</span></h2>
      <form className="flex items-center gap-2 h-9 px-3 rounded-xl border border-line bg-panel" onSubmit={async e => { e.preventDefault(); if (!title.trim()) return; await addTask({ title: title.trim() }); setTitle(""); }}>
        <Plus size={14} className="text-ink-3" />
        <input className="flex-1 bg-transparent outline-none text-[13px]" placeholder="Add a to-do for yourself" value={title} onChange={e => setTitle(e.target.value)} />
      </form>
      {mine.map(t => {
        const done = t.status === "done";
        return (
          <div key={t.id} className="flex items-center gap-2.5 h-9 px-3 rounded-lg row-hover">
            <button className={clsx("checkbox", done && "done", `p${t.priority}`)} onClick={() => completeTask(t.id, !done)} aria-label={done ? "Reopen" : "Complete"}>
              {done && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>}
            </button>
            <span className={clsx("flex-1 truncate text-[13px]", done && "strike")}>{t.title}</span>
          </div>
        );
      })}
    </section>
  );
}
