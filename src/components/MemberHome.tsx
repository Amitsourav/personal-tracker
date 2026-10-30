"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore, isOpen } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { pokeOutbox, initials } from "@/lib/team";
import { STATUS_LABEL, type TaskStatus } from "@/lib/types";
import { format, formatDistanceToNow } from "date-fns";
import { Check, ChevronDown, ChevronRight, CornerUpLeft, Eye, Forward, Kanban, List, LogOut, MessageCircleQuestion, Plus, RefreshCw, Send, UserPlus, Users, X } from "lucide-react";
import clsx from "clsx";
import { Attachments } from "./Attachments";

type Req = { kind: "status_request" | "review_request"; body: string | null; created_at: string };
type MTask = {
  id: string; title: string; description: string | null; status: TaskStatus; priority: number;
  due_at: string | null; due_has_time: boolean; created_at: string; updated_at: string; completed_at: string | null;
  done: boolean; project_name: string | null; owner_name: string; comment_count: number;
  review_stage: "lead" | "owner" | null; lead_name: string | null; can_delegate: boolean;
  parts_total: number; parts_done: number; parent_title: string | null;
  open_request: Req | null;
};
type LTask = {
  id: string; title: string; description: string | null; status: TaskStatus; priority: number;
  due_at: string | null; due_has_time: boolean; created_at: string; updated_at: string; completed_at: string | null;
  done: boolean; needs_me: boolean; review_stage: "lead" | "owner" | null;
  assignee_id: string | null; assignee_name: string | null; owner_name: string;
  last_comment: { kind: string; body: string | null; created_at: string; by_me: boolean } | null;
};
type Mate = { id: string; name: string; is_lead: boolean; joined: boolean; me: boolean };
type MComment = { id: string; kind: string; body: string | null; created_at: string; mine: boolean; author: string };

const WORKING: TaskStatus[] = ["todo", "in_progress", "waiting"];

/**
 * What a team member sees. Deliberately not the owner's app with things hidden:
 * a separate, small screen that can only show what the member_* and lead_*
 * functions return, so nothing of Amit's can leak through a page someone
 * forgot to lock down.
 *
 * A lead gets three more things on the same screen: what they handed out
 * (with their review step), a way to create tasks for the team, and a way to
 * add people.
 */
export function MemberHome() {
  const { membership } = useStore();
  const router = useRouter();
  const me = membership[0];
  const isLead = !!me?.is_lead;
  const owner = me?.owner_name ?? "your manager";
  const ownerFirst = owner.split(" ")[0];
  const [tasks, setTasks] = useState<MTask[] | null>(null);
  const [handed, setHanded] = useState<LTask[]>([]);
  const [mates, setMates] = useState<Mate[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"task" | "person" | null>(null);
  const [view, setView] = useState<"list" | "board">("list");

  const load = useCallback(async () => {
    const sb = createClient();
    const [mine, lead, team] = await Promise.all([
      sb.rpc("member_tasks"),
      isLead ? sb.rpc("lead_tasks") : Promise.resolve({ data: [], error: null }),
      isLead ? sb.rpc("lead_team") : Promise.resolve({ data: [], error: null }),
    ]);
    if (mine.error) { useStore.getState().toast("Couldn't load tasks: " + mine.error.message); return; }
    setTasks((mine.data ?? []) as MTask[]);
    setHanded((lead.data ?? []) as LTask[]);
    setMates((team.data ?? []) as Mate[]);
  }, [isLead]);

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
  const toReview = handed.filter(t => t.needs_me);
  const handedOpen = handed.filter(t => !t.done && !t.needs_me);
  const handedDone = handed.filter(t => t.done);
  const props = { openId, setOpenId, reload: load, mates, ownerFirst };

  return (
    <div className="h-dvh overflow-y-auto bg-bg">
      <header className="sticky top-0 z-10 bg-bg/90 backdrop-blur border-b border-line">
        <div className="max-w-[820px] mx-auto flex items-center gap-2 px-4 h-14">
          <div className="w-6 h-6 rounded-md bg-accent text-accent-ink grid place-items-center font-semibold text-[13px]">T</div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[14px] leading-tight">Your tasks {isLead && <span className="pill bg-p3-soft text-p3 ml-1 align-middle">Lead</span>}</div>
            <div className="text-[11.5px] text-ink-3 truncate">{owner}&apos;s team</div>
          </div>
          {isLead && <>
            <button className="btn sm primary" onClick={() => setPanel(panel === "task" ? null : "task")}><Plus size={13} /> <span className="hidden sm:inline">New task</span></button>
            <button className="btn sm" onClick={() => setPanel(panel === "person" ? null : "person")} title="Add someone to the team"><UserPlus size={13} /></button>
          </>}
          <button className="btn ghost sm" onClick={load} title="Refresh"><RefreshCw size={14} /></button>
          <button className="btn ghost sm" title="Sign out" onClick={async () => { await createClient().auth.signOut(); router.push("/login"); }}><LogOut size={14} /></button>
        </div>
      </header>

      <main className="max-w-[820px] mx-auto px-4 py-5 grid gap-6">
        {panel === "task" && me && <NewTask ownerId={me.owner_id} mates={mates} done={() => { setPanel(null); load(); }} />}
        {panel === "person" && me && <AddPerson ownerId={me.owner_id} ownerFirst={ownerFirst} done={() => { setPanel(null); load(); }} />}

        {tasks === null && <div className="text-ink-3 text-[12.5px]">Loading…</div>}
        {tasks && !all.length && !handed.length && <div className="text-ink-3 text-[13px]">Nothing assigned to you yet. When {owner} gives you a task you&apos;ll get an email, and it will appear here.</div>}

        {toReview.length > 0 && (
          <section className="grid gap-1.5">
            <h2 className="text-[12px] font-semibold text-p1">Waiting for your review <span className="font-normal text-ink-3 tnum">{toReview.length}</span></h2>
            {toReview.map(t => <LeadCard key={t.id} t={t} {...props} />)}
          </section>
        )}

        <Group title={`${ownerFirst} is waiting for your reply`} tasks={asked} accent {...props} />
        <Group title="To do" tasks={working} {...props} />
        <Group title="Sent for review" hint="waiting for approval" tasks={review} {...props} />

        {isLead && (handedOpen.length > 0 || handedDone.length > 0) && (
          <section className="grid gap-1.5">
            <div className="flex items-center gap-2">
              <h2 className="text-[12px] font-semibold text-ink-2">Handed out by you <span className="font-normal text-ink-3 tnum">{handedOpen.length}</span></h2>
              <div className="ml-auto flex border border-line rounded-md overflow-hidden">
                <button className={clsx("h-6 w-7 grid place-items-center", view === "list" ? "bg-selected text-accent" : "text-ink-3")} onClick={() => setView("list")} title="List"><List size={13} /></button>
                <button className={clsx("h-6 w-7 grid place-items-center", view === "board" ? "bg-selected text-accent" : "text-ink-3")} onClick={() => setView("board")} title="Board"><Kanban size={13} /></button>
              </div>
            </div>
            {view === "list"
              ? handedOpen.map(t => <LeadCard key={t.id} t={t} {...props} />)
              : <LeadBoard tasks={[...handedOpen, ...toReview]} open={id => { setView("list"); setOpenId(id); }} />}
          </section>
        )}

        <Group title="Closed in the last two weeks" tasks={closed} muted {...props} />
        {isLead && handedDone.length > 0 && view === "list" && (
          <section className="grid gap-1.5">
            <h2 className="text-[12px] font-semibold text-ink-2">Handed out — closed <span className="font-normal text-ink-3 tnum">{handedDone.length}</span></h2>
            {handedDone.map(t => <LeadCard key={t.id} t={t} muted {...props} />)}
          </section>
        )}

        <OwnTasks />
      </main>
    </div>
  );
}

type Shared = { openId: string | null; setOpenId: (id: string | null) => void; reload: () => Promise<void>; mates: Mate[]; ownerFirst: string };

function Group({ title, hint, tasks, accent, muted, ...p }: { title: string; hint?: string; tasks: MTask[]; accent?: boolean; muted?: boolean } & Shared) {
  if (!tasks.length) return null;
  return (
    <section className="grid gap-1.5">
      <h2 className={clsx("text-[12px] font-semibold", accent ? "text-p1" : "text-ink-2")}>{title} <span className="font-normal text-ink-3 tnum">{tasks.length}</span>{hint && <span className="font-normal text-ink-3"> · {hint}</span>}</h2>
      {tasks.map(t => <Card key={t.id} t={t} muted={muted} {...p} />)}
    </section>
  );
}

/** A task the signed-in person is doing. */
function Card({ t, muted, openId, setOpenId, reload, mates, ownerFirst }: { t: MTask; muted?: boolean } & Shared) {
  const open = openId === t.id;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const overdue = !t.done && t.due_at && new Date(t.due_at) < new Date();
  const reviewer = t.lead_name ?? ownerFirst;

  async function act(action: "comment" | "status" | "submit", status?: TaskStatus) {
    if (action === "comment" && !text.trim()) return;
    setBusy(true);
    const { error } = await createClient().rpc("member_act", { p_task: t.id, p_action: action, p_body: text.trim() || null, p_status: status ?? null });
    setBusy(false);
    if (error) { useStore.getState().toast(error.message); return; }
    if (action === "submit") pokeOutbox();
    setText("");
    useStore.getState().toast(action === "submit" ? `Sent to ${reviewer} for review` : action === "status" ? `Moved to ${STATUS_LABEL[status!]}` : "Sent");
    await reload();
  }

  return (
    <div className={clsx("rounded-xl border bg-panel", t.open_request && !t.done ? "border-p1/40" : "border-line", muted && "opacity-70")}>
      <button className="w-full flex items-start gap-2.5 p-3 text-left" onClick={() => setOpenId(open ? null : t.id)}>
        {open ? <ChevronDown size={15} className="mt-0.5 text-ink-3 flex-none" /> : <ChevronRight size={15} className="mt-0.5 text-ink-3 flex-none" />}
        <div className="flex-1 min-w-0">
          <div className={clsx("text-[13.5px] font-medium leading-snug", t.done && "strike")}>{t.title}</div>
          <Meta status={t.status} due_at={t.due_at} due_has_time={t.due_has_time} overdue={!!overdue} priority={t.priority}
            extra={[t.lead_name ? `from ${t.lead_name}` : null, t.parts_total > 0 ? `${t.parts_done}/${t.parts_total} parts done` : null, t.project_name, t.comment_count > 0 ? `${t.comment_count} message${t.comment_count === 1 ? "" : "s"}` : null]} />
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
          {!t.done && <Attachments taskId={t.id} mode="member" />}
          <Thread taskId={t.id} stamp={t.updated_at} />
          {!t.done && (
            <>
              <textarea className="w-full bg-panel-2 rounded-lg p-2.5 outline-none text-[13px] resize-none min-h-[64px] border border-transparent focus:border-line"
                placeholder={t.open_request ? "Write your reply…" : "Add an update or a question…"} value={text} onChange={e => setText(e.target.value)} />
              <div className="flex flex-wrap items-center gap-1.5">
                <button className="btn sm primary" disabled={busy || !text.trim()} onClick={() => act("comment")}><Send size={13} /> Send</button>
                {t.status !== "in_review" && <button className="btn sm" disabled={busy} onClick={() => act("submit")} title="Anything typed above goes with it"><Eye size={13} /> Done — send to {reviewer}</button>}
                {t.can_delegate && <PassOn taskId={t.id} mates={mates} reload={reload} />}
                {t.can_delegate && !t.parent_title && t.parts_total === 0 && <SplitOn taskId={t.id} mates={mates} reload={reload} />}
                <div className="ml-auto flex gap-1">
                  {WORKING.map(s => (
                    <button key={s} className={clsx("btn sm", t.status === s && "primary")} disabled={busy || t.status === s} onClick={() => act("status", s)}>{STATUS_LABEL[s]}</button>
                  ))}
                </div>
              </div>
              <div className="text-[11px] text-ink-3">Only {ownerFirst} can close a task. When you&apos;re finished, send it {t.lead_name ? `to ${t.lead_name} ` : ""}for review.</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A task a lead handed to someone else. */
function LeadCard({ t, muted, openId, setOpenId, reload, mates, ownerFirst }: { t: LTask; muted?: boolean } & Shared) {
  const open = openId === t.id;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const overdue = !t.done && t.due_at && new Date(t.due_at) < new Date();
  const who = t.assignee_name?.split(" ")[0] ?? "them";

  async function act(action: "comment" | "status_request" | "approve" | "return") {
    const body = text.trim() || null;
    if (action === "comment" && !body) return;
    if (action === "return" && !body) { useStore.getState().toast("Write what needs changing first"); return; }
    setBusy(true);
    const sb = createClient();
    const { error } = action === "comment"
      ? await sb.rpc("member_act", { p_task: t.id, p_action: "comment", p_body: body })
      : await sb.rpc("lead_act", { p_task: t.id, p_action: action, p_body: body });
    setBusy(false);
    if (error) { useStore.getState().toast(error.message); return; }
    if (action !== "comment" && action !== "approve") pokeOutbox();
    setText("");
    useStore.getState().toast({ comment: "Sent", status_request: `Asked ${who} for an update`, approve: `Approved — sent to ${ownerFirst}`, return: `Sent back to ${who}` }[action]);
    await reload();
  }

  return (
    <div className={clsx("rounded-xl border bg-panel", t.needs_me ? "border-p1/40" : "border-line", muted && "opacity-70")}>
      <button className="w-full flex items-start gap-2.5 p-3 text-left" onClick={() => setOpenId(open ? null : t.id)}>
        {open ? <ChevronDown size={15} className="mt-0.5 text-ink-3 flex-none" /> : <ChevronRight size={15} className="mt-0.5 text-ink-3 flex-none" />}
        {t.assignee_name && <span className="w-6 h-6 rounded-full bg-p3-soft text-p3 grid place-items-center text-[10px] font-semibold flex-none" title={t.assignee_name}>{initials(t.assignee_name)}</span>}
        <div className="flex-1 min-w-0">
          <div className={clsx("text-[13.5px] font-medium leading-snug", t.done && "strike")}>{t.title}</div>
          <Meta status={t.status} due_at={t.due_at} due_has_time={t.due_has_time} overdue={!!overdue} priority={t.priority}
            stageNote={t.status === "in_review" ? (t.review_stage === "lead" ? "waiting for you" : `with ${ownerFirst}`) : null}
            extra={[t.assignee_name ? `with ${t.assignee_name}` : null,
              t.last_comment && !t.last_comment.by_me ? `${who} replied ${formatDistanceToNow(new Date(t.last_comment.created_at), { addSuffix: true })}` : null]} />
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 pl-9 grid gap-3">
          {t.description && <div className="text-[13px] text-ink-2 whitespace-pre-wrap break-words bg-panel-2 rounded-lg p-2.5">{t.description}</div>}
          {!t.done && <Attachments taskId={t.id} mode="member" />}
          <Thread taskId={t.id} stamp={t.updated_at} />
          {!t.done && (
            <>
              {t.needs_me && <div className="rounded-lg bg-p3-soft text-p3 px-2.5 py-2 text-[12.5px] flex items-center gap-2"><Eye size={13} /> {who} sent this to you for review. Approving sends it to {ownerFirst} for the final OK.</div>}
              <textarea className="w-full bg-panel-2 rounded-lg p-2.5 outline-none text-[13px] resize-none min-h-[56px] border border-transparent focus:border-line"
                placeholder={t.needs_me ? "Feedback (needed to send it back)…" : `Message ${who}…`} value={text} onChange={e => setText(e.target.value)} />
              <div className="flex flex-wrap items-center gap-1.5">
                {t.needs_me ? <>
                  <button className="btn sm primary" disabled={busy} onClick={() => act("approve")}><Check size={13} /> Approve — send to {ownerFirst}</button>
                  <button className="btn sm" disabled={busy} onClick={() => act("return")}><CornerUpLeft size={13} /> Send back</button>
                </> : t.status !== "in_review" && (
                  <button className="btn sm" disabled={busy} onClick={() => act("status_request")}><MessageCircleQuestion size={13} /> Ask for update</button>
                )}
                <PassOn taskId={t.id} mates={mates} reload={reload} current={t.assignee_id} label="Reassign" />
                <button className="btn sm ml-auto" disabled={busy || !text.trim()} onClick={() => act("comment")}><Send size={13} /> Send</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Meta({ status, due_at, due_has_time, overdue, priority, extra, stageNote }: {
  status: TaskStatus; due_at: string | null; due_has_time: boolean; overdue: boolean; priority: number; extra: (string | null)[]; stageNote?: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11.5px] text-ink-3">
      <span className={clsx("pill", status === "in_review" ? "bg-p3-soft text-p3" : "bg-panel-2")}>{STATUS_LABEL[status]}{stageNote ? ` · ${stageNote}` : ""}</span>
      {due_at && <span className={clsx(overdue && "text-p1 font-medium")}>Due {format(new Date(due_at), due_has_time ? "d MMM, h:mm a" : "EEE d MMM")}</span>}
      {priority <= 2 && <span className={priority === 1 ? "text-p1" : "text-p2"}>{priority === 1 ? "Urgent" : "High priority"}</span>}
      {extra.filter(Boolean).map((x, i) => <span key={i}>{x}</span>)}
    </div>
  );
}

const KIND: Record<string, string> = {
  comment: "", status_request: "asked for an update", review_request: "asked for your review",
  submitted: "sent this for review", approved: "approved it", returned: "sent it back", attachment: "attached",
  lead_approved: "approved it and sent it up", delegated: "handed this to", created: "created this for",
};

function Thread({ taskId, stamp }: { taskId: string; stamp: string }) {
  const [comments, setComments] = useState<MComment[]>([]);
  useEffect(() => {
    createClient().rpc("member_comments", { p_task: taskId }).then(({ data }) => setComments((data ?? []) as MComment[]));
  }, [taskId, stamp]);
  if (!comments.length) return null;
  const ago = (c: MComment) => formatDistanceToNow(new Date(c.created_at), { addSuffix: true });
  return (
    <div className="grid gap-1.5">
      {comments.map(c => c.kind === "reminder" ? (
        <div key={c.id} className="text-[11.5px] text-ink-3">Reminder emailed ({c.body}) · {ago(c)}</div>
      ) : c.kind === "status" ? (
        <div key={c.id} className="text-[11.5px] text-ink-3">{c.mine ? "You" : c.author} moved it to {STATUS_LABEL[c.body as TaskStatus] ?? c.body} · {ago(c)}</div>
      ) : c.kind === "delegated" || c.kind === "created" ? (
        <div key={c.id} className="text-[11.5px] text-ink-3">{c.mine ? "You" : c.author} {KIND[c.kind]} {c.body} · {ago(c)}</div>
      ) : (
        <div key={c.id} className={clsx("rounded-lg px-2.5 py-1.5 text-[12.5px]", c.mine ? "bg-panel-2" : "bg-selected")}>
          <div className="text-[11px] text-ink-3 mb-0.5"><span className="font-medium text-ink-2">{c.mine ? "You" : c.author}</span>{KIND[c.kind] && ` ${KIND[c.kind]}`} · {ago(c)}</div>
          {c.body && <div className="whitespace-pre-wrap break-words">{c.kind === "attachment" ? `📎 ${c.body}` : c.body}</div>}
        </div>
      ))}
    </div>
  );
}

/** Hand a task to someone else on the team (leads only). */
function PassOn({ taskId, mates, reload, current, label = "Pass on" }: { taskId: string; mates: Mate[]; reload: () => Promise<void>; current?: string | null; label?: string }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!mates.length) return null;
  async function go() {
    if (!to) return;
    setBusy(true);
    const { error } = await createClient().rpc("lead_assign", { p_task: taskId, p_to: to, p_note: note.trim() || null });
    setBusy(false);
    if (error) { useStore.getState().toast(error.message); return; }
    pokeOutbox();
    const m = mates.find(x => x.id === to);
    useStore.getState().toast(m?.me ? "Taken back" : `Handed to ${m?.name}`);
    setOpen(false); setTo(""); setNote("");
    await reload();
  }
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)}><Forward size={13} /> {label}</button>;
  return (
    <div className="w-full grid gap-1.5 rounded-lg border border-line p-2">
      <div className="flex items-center gap-1.5">
        <select className="field h-7 flex-1" value={to} onChange={e => setTo(e.target.value)}>
          <option value="">Choose who…</option>
          {mates.filter(m => m.id !== current).map(m => <option key={m.id} value={m.id}>{m.me ? "Me (take it back)" : m.name}{!m.joined ? " — not signed in yet" : ""}</option>)}
        </select>
        <button className="btn ghost sm px-1" onClick={() => setOpen(false)}><X size={13} /></button>
      </div>
      <input className="field h-7" placeholder="Note for them (optional)" value={note} onChange={e => setNote(e.target.value)} />
      <button className="btn sm primary justify-self-start" disabled={busy || !to} onClick={go}><Forward size={13} /> Hand over</button>
    </div>
  );
}

/** Split a task into one part per person (leads only). */
function SplitOn({ taskId, mates, reload }: { taskId: string; mates: Mate[]; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (mates.length < 2) return null;
  const toggle = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  async function go() {
    setBusy(true);
    const { data, error } = await createClient().rpc("lead_split", { p_task: taskId, p_members: picked, p_note: note.trim() || null });
    setBusy(false);
    if (error) { useStore.getState().toast(error.message); return; }
    pokeOutbox();
    useStore.getState().toast(`Split into ${data} parts — each person has been emailed`);
    setOpen(false); setPicked([]); setNote("");
    await reload();
  }
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)} title="Give each person their own part"><Users size={13} /> Split</button>;
  return (
    <div className="w-full grid gap-1.5 rounded-lg border border-line p-2">
      <div className="flex items-center text-[12px] text-ink-2">Each person gets their own part of this task, with its notes and due date.
        <button className="btn ghost sm px-1 ml-auto" onClick={() => setOpen(false)}><X size={13} /></button></div>
      <div className="flex flex-wrap gap-1">
        {mates.map(m => (
          <button key={m.id} className={clsx("pill", picked.includes(m.id) ? "bg-selected text-ink font-medium" : "text-ink-3 border border-line")} onClick={() => toggle(m.id)}>
            {picked.includes(m.id) && <Check size={10} />}{m.me ? "Me" : m.name}
          </button>
        ))}
      </div>
      <input className="field h-7" placeholder="Note for everyone (optional)" value={note} onChange={e => setNote(e.target.value)} />
      <button className="btn sm primary justify-self-start" disabled={busy || picked.length < 2} onClick={go}>
        <Users size={13} /> {picked.length < 2 ? "Choose 2 or more" : `Create ${picked.length} parts`}
      </button>
    </div>
  );
}

/** A lead's board of what they handed out. Read-only: open a card to act on it. */
function LeadBoard({ tasks, open }: { tasks: LTask[]; open: (id: string) => void }) {
  const cols: TaskStatus[] = ["todo", "in_progress", "waiting", "in_review"];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {cols.map(c => {
        const list = tasks.filter(t => (c === "todo" ? (t.status === "todo" || t.status === "inbox") : t.status === c));
        return (
          <div key={c} className="rounded-xl bg-panel-2 p-2 grid gap-1.5 content-start min-h-[120px]">
            <div className="text-[11px] font-semibold text-ink-3 uppercase tracking-wide px-0.5">{STATUS_LABEL[c]} <span className="tnum font-normal">{list.length}</span></div>
            {list.map(t => (
              <button key={t.id} onClick={() => open(t.id)} className={clsx("text-left rounded-lg border bg-panel p-2 grid gap-1", t.needs_me ? "border-p1/40" : "border-line hover:border-ink-3/40")}>
                <span className="text-[12.5px] leading-snug">{t.title}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
                  {t.assignee_name && <span className="w-4 h-4 rounded-full bg-p3-soft text-p3 grid place-items-center text-[8.5px] font-semibold">{initials(t.assignee_name)}</span>}
                  {t.assignee_name?.split(" ")[0]}
                  {t.due_at && <span className={clsx("ml-auto", new Date(t.due_at) < new Date() && "text-p1")}>{format(new Date(t.due_at), "d MMM")}</span>}
                </span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function NewTask({ ownerId, mates, done }: { ownerId: string; mates: Mate[]; done: () => void }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState(4);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    // A date with no time means "by the end of that day", as everywhere else here.
    const dueAt = due ? new Date(`${due}T23:59:00`).toISOString() : null;
    const { error } = await createClient().rpc("lead_create_task", {
      p_owner: ownerId, p_title: title.trim(), p_description: desc.trim() || null, p_due: dueAt, p_priority: priority, p_to: to || null,
    });
    setBusy(false);
    if (error) { useStore.getState().toast(error.message); return; }
    if (to) pokeOutbox();
    useStore.getState().toast(to ? `Task created for ${mates.find(m => m.id === to)?.name}` : "Task created");
    done();
  }
  return (
    <form onSubmit={save} className="rounded-xl border border-line bg-panel p-4 grid gap-2">
      <div className="font-semibold text-[13px]">New task for the team</div>
      <input autoFocus className="field" placeholder="What needs doing?" value={title} onChange={e => setTitle(e.target.value)} />
      <textarea className="field min-h-[60px] py-2" placeholder="Details (optional)" value={desc} onChange={e => setDesc(e.target.value)} />
      <div className="grid sm:grid-cols-3 gap-2">
        <select className="field" value={to} onChange={e => setTo(e.target.value)}>
          <option value="">Assign to: me</option>
          {mates.filter(m => !m.me).map(m => <option key={m.id} value={m.id}>Assign to: {m.name}</option>)}
        </select>
        <input type="date" className="field" value={due} onChange={e => setDue(e.target.value)} title="Due date" />
        <select className="field" value={priority} onChange={e => setPriority(Number(e.target.value))}>
          <option value={1}>Urgent</option><option value={2}>High</option><option value={3}>Medium</option><option value={4}>No priority</option>
        </select>
      </div>
      <div className="flex gap-2"><button className="btn primary sm" disabled={busy || !title.trim()}>{busy ? "Creating…" : "Create task"}</button><button type="button" className="btn sm" onClick={done}>Cancel</button></div>
    </form>
  );
}

function AddPerson({ ownerId, ownerFirst, done }: { ownerId: string; ownerFirst: string; done: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await createClient().rpc("lead_invite", { p_owner: ownerId, p_name: name, p_email: email });
    setBusy(false);
    if (error) { useStore.getState().toast(error.message); return; }
    pokeOutbox();
    useStore.getState().toast(`Invite emailed to ${email}`);
    done();
  }
  return (
    <form onSubmit={save} className="rounded-xl border border-line bg-panel p-4 grid gap-2">
      <div className="font-semibold text-[13px]">Add someone to {ownerFirst}&apos;s team</div>
      <div className="grid sm:grid-cols-[1fr_1.4fr_auto] gap-2">
        <input autoFocus className="field" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
        <input type="email" className="field" placeholder="Their email" value={email} onChange={e => setEmail(e.target.value)} />
        <button className="btn primary" disabled={busy}>{busy ? "Adding…" : "Add & invite"}</button>
      </div>
      <div className="text-[11.5px] text-ink-3">They&apos;ll get an email to sign in. {ownerFirst} will see them on the team too.</div>
    </form>
  );
}

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
