"use client";
import { useState } from "react";
import * as chrono from "chrono-node";
import { addDays, format, nextMonday, startOfDay } from "date-fns";
import clsx from "clsx";
import { Check, CalendarDays, CalendarClock, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { Popover, PriorityFlag, Avatar, Dot } from "./ui";
import { fmtDue } from "@/lib/dates";
import { STATUS_LABEL, STATUS_ORDER, PRIORITY_LABEL, type TaskStatus, type Task } from "@/lib/types";

export function DuePicker({ task, compact }: { task: Task; compact?: boolean }) {
  const updateTask = useStore(s => s.updateTask);
  const [text, setText] = useState("");
  const set = (d: Date | null, hasTime = false) => updateTask(task.id, { due_at: d ? d.toISOString() : null, due_has_time: hasTime });
  const now = new Date();
  const eod = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 0, 0); return x; };
  const presets: [string, () => Date][] = [
    ["Today", () => eod(now)], ["Tomorrow", () => eod(addDays(now, 1))], ["Next Monday", () => eod(nextMonday(now))], ["In a week", () => eod(addDays(now, 7))],
  ];
  const overdue = task.due_at && new Date(task.due_at) < startOfDay(now) && task.status !== "done";
  const trigger = task.due_at
    ? <button className={clsx("pill", overdue ? "bg-p1-soft text-p1" : new Date(task.due_at) < addDays(startOfDay(now), 1) ? "bg-accent-soft text-accent" : "bg-panel-2 text-ink-2 border border-line")}><CalendarDays size={11} /> {fmtDue(task.due_at, task.due_has_time)}</button>
    : <button className={clsx("pill text-ink-3 hover:bg-hover", compact && "opacity-0 group-hover:opacity-100")}><CalendarDays size={11} /> {compact ? "" : "Due"}</button>;
  return (
    <Popover trigger={trigger}>
      {(close) => (
        <div className="w-[240px]">
          <form onSubmit={e => { e.preventDefault(); const r = chrono.parse(text, now, { forwardDate: true })[0]; if (r) { const d = r.start.date(); const ht = r.start.isCertain("hour"); if (!ht) d.setHours(23, 59, 0, 0); set(d, ht); close(); } }}>
            <input id={`due-${task.id}`} autoFocus className="field mb-1" placeholder="e.g. fri 3pm, in 2 weeks, 25 sep" value={text} onChange={e => setText(e.target.value)} />
          </form>
          {presets.map(([l, f]) => <button key={l} className="menu-item" onClick={() => { set(f()); close(); }}>{l}<span className="ml-auto text-ink-3 text-[11px]">{format(f(), "EEE d")}</span></button>)}
          <div className="flex gap-1 px-1 py-1 border-t border-line mt-1">
            <input type="date" className="field h-7 text-[12px]" value={task.due_at ? format(new Date(task.due_at), "yyyy-MM-dd") : ""} onChange={e => { if (e.target.value) { const d = new Date(e.target.value + "T23:59:00"); set(d, false); } }} />
            <input type="time" className="field h-7 text-[12px] w-[96px]" value={task.due_at && task.due_has_time ? format(new Date(task.due_at), "HH:mm") : ""} onChange={e => { if (e.target.value) { const base = task.due_at ? new Date(task.due_at) : now; const [h, m] = e.target.value.split(":").map(Number); base.setHours(h, m, 0, 0); set(base, true); } }} />
          </div>
          {task.due_at && <button className="menu-item text-danger" onClick={() => { set(null); close(); }}><X size={12} /> Remove date</button>}
        </div>
      )}
    </Popover>
  );
}

/**
 * "Plan to do" — when Amit intends to get to this, as distinct from due_at,
 * which means somebody is waiting. Most of his backlog has no real deadline, and
 * dating it all as "due" would put the whole list overdue on the same day and
 * make the overdue count meaningless.
 */
export function PlannedPicker({ task, compact }: { task: Task; compact?: boolean }) {
  const updateTask = useStore(s => s.updateTask);
  const [text, setText] = useState("");
  const set = (d: Date | null) => updateTask(task.id, { start_at: d ? d.toISOString() : null });
  const now = new Date();
  const at9 = (d: Date) => { const x = new Date(d); x.setHours(9, 0, 0, 0); return x; };
  const presets: [string, () => Date][] = [
    ["Today", () => at9(now)], ["Tomorrow", () => at9(addDays(now, 1))],
    ["Next Monday", () => at9(nextMonday(now))], ["In a week", () => at9(addDays(now, 7))],
  ];
  // Deliberately never styled as overdue: a planned date that has slipped is not
  // a broken promise, it is a day that went differently.
  const trigger = task.start_at
    ? <button className="pill bg-panel-2 text-ink-2 border border-line"><CalendarClock size={11} /> Plan {format(new Date(task.start_at), "d MMM")}</button>
    : <button className={clsx("pill text-ink-3 hover:bg-hover", compact && "opacity-0 group-hover:opacity-100")}><CalendarClock size={11} /> {compact ? "" : "Plan"}</button>;
  return (
    <Popover trigger={trigger}>
      {(close) => (
        <div className="w-[240px]">
          <form onSubmit={e => { e.preventDefault(); const r = chrono.parse(text, now, { forwardDate: true })[0]; if (r) { set(at9(r.start.date())); close(); } }}>
            <input id={`plan-${task.id}`} autoFocus className="field mb-1" placeholder="e.g. monday, in 3 days, 25 sep" value={text} onChange={e => setText(e.target.value)} />
          </form>
          {presets.map(([l, f]) => <button key={l} className="menu-item" onClick={() => { set(f()); close(); }}>{l}<span className="ml-auto text-ink-3 text-[11px]">{format(f(), "EEE d")}</span></button>)}
          <div className="flex gap-1 px-1 py-1 border-t border-line mt-1">
            <input type="date" className="field h-7 text-[12px]" value={task.start_at ? format(new Date(task.start_at), "yyyy-MM-dd") : ""} onChange={e => { if (e.target.value) set(new Date(e.target.value + "T09:00:00")); }} />
          </div>
          {task.start_at && <button className="menu-item text-danger" onClick={() => { set(null); close(); }}><X size={12} /> Remove</button>}
        </div>
      )}
    </Popover>
  );
}

export function PriorityPicker({ task, label }: { task: Task; label?: boolean }) {
  const updateTask = useStore(s => s.updateTask);
  return (
    <Popover trigger={<button className={clsx("pill hover:bg-hover", label ? "text-ink-2" : "px-1")} title="Priority"><PriorityFlag p={task.priority} />{label && PRIORITY_LABEL[task.priority]}</button>}>
      {(close) => <>{[1, 2, 3, 4].map(p => <button key={p} className="menu-item" data-active={task.priority === p} onClick={() => { updateTask(task.id, { priority: p as 1|2|3|4 }); close(); }}><PriorityFlag p={p} /> {PRIORITY_LABEL[p]}<span className="ml-auto"><kbd>{p}</kbd></span></button>)}</>}
    </Popover>
  );
}

export function StatusPicker({ task }: { task: Task }) {
  const { updateTask, completeTask } = useStore();
  const colors: Record<TaskStatus, string> = { inbox: "var(--ink-3)", todo: "var(--ink-2)", in_progress: "var(--accent)", waiting: "var(--p2)", done: "var(--ok)", cancelled: "var(--ink-3)" };
  return (
    <Popover trigger={<button className="pill border border-line bg-panel-2 text-ink-2 hover:bg-hover"><Dot color={colors[task.status]} /> {STATUS_LABEL[task.status]}</button>}>
      {(close) => <>{STATUS_ORDER.map(s => <button key={s} className="menu-item" data-active={task.status === s} onClick={() => { if (s === "done") completeTask(task.id); else updateTask(task.id, { status: s, completed_at: null }); close(); }}><Dot color={colors[s]} /> {STATUS_LABEL[s]}</button>)}</>}
    </Popover>
  );
}

export function ProjectPicker({ task, compact }: { task: Task; compact?: boolean }) {
  const { projects, updateTask } = useStore();
  const p = projects.find(x => x.id === task.project_id);
  return (
    <Popover trigger={p ? <button className="pill text-ink-2 hover:bg-hover"><span className="w-[8px] h-[8px] rounded-[2px]" style={{ background: p.color }} /> {p.name}</button> : <button className={clsx("pill text-ink-3 hover:bg-hover", compact && "opacity-0 group-hover:opacity-100")}>{compact ? "#" : "No project"}</button>}>
      {(close) => (
        <div className="max-h-[260px] overflow-auto">
          <button className="menu-item" onClick={() => { updateTask(task.id, { project_id: null }); close(); }}>No project</button>
          {projects.map(x => <button key={x.id} className="menu-item" data-active={x.id === task.project_id} onClick={() => { updateTask(task.id, { project_id: x.id }); close(); }}><span className="w-[8px] h-[8px] rounded-[2px]" style={{ background: x.color }} /> {x.name}{x.id === task.project_id && <Check size={12} className="ml-auto" />}</button>)}
        </div>
      )}
    </Popover>
  );
}

export function PersonPicker({ task, field, compact }: { task: Task; field: "person_id" | "waiting_on_person_id"; compact?: boolean }) {
  const { people, updateTask, addPerson } = useStore();
  const [q, setQ] = useState("");
  const p = people.find(x => x.id === task[field]);
  const label = field === "person_id" ? "From" : "Waiting on";
  return (
    <Popover trigger={p ? <button className="pill text-ink-2 hover:bg-hover"><Avatar name={p.name} size={14} /> {p.name}</button> : <button className={clsx("pill text-ink-3 hover:bg-hover", compact && "opacity-0 group-hover:opacity-100")}>{compact ? "@" : label}</button>}>
      {(close) => (
        <div className="w-[220px]">
          <form onSubmit={async e => { e.preventDefault(); if (!q.trim()) return; const np = await addPerson({ name: q.trim() }); if (np) updateTask(task.id, { [field]: np.id }); close(); }}>
            <input id={`person-${field}-${task.id}`} autoFocus className="field mb-1" placeholder="Search or add person…" value={q} onChange={e => setQ(e.target.value)} />
          </form>
          <div className="max-h-[220px] overflow-auto">
            {p && <button className="menu-item text-danger" onClick={() => { updateTask(task.id, { [field]: null }); close(); }}><X size={12} /> Clear</button>}
            {people.filter(x => x.name.toLowerCase().includes(q.toLowerCase())).map(x => <button key={x.id} className="menu-item" data-active={x.id === task[field]} onClick={() => { updateTask(task.id, { [field]: x.id }); close(); }}><Avatar name={x.name} size={16} /> {x.name}</button>)}
            {q.trim() && !people.some(x => x.name.toLowerCase() === q.trim().toLowerCase()) && <div className="px-2 py-1 text-[11px] text-ink-3">↵ to add “{q.trim()}”</div>}
          </div>
        </div>
      )}
    </Popover>
  );
}

export function TagPicker({ task, compact }: { task: Task; compact?: boolean }) {
  const { tags, taskTags, setTaskTags, addTag } = useStore();
  const [q, setQ] = useState("");
  const mine = taskTags.filter(tt => tt.task_id === task.id).map(tt => tt.tag_id);
  const toggle = (id: string) => setTaskTags(task.id, mine.includes(id) ? mine.filter(x => x !== id) : [...mine, id]);
  const myTags = tags.filter(t => mine.includes(t.id));
  return (
    <Popover trigger={
      <button className={clsx("flex items-center gap-1 rounded hover:bg-hover px-0.5", !myTags.length && compact && "opacity-0 group-hover:opacity-100")}>
        {myTags.length ? myTags.map(t => <span key={t.id} className="pill" style={{ background: t.color + "22", color: t.color }}>{t.name}</span>) : <span className="pill text-ink-3">{compact ? "@" : "Tags"}</span>}
      </button>}>
      {(close) => (
        <div className="w-[200px]">
          <form onSubmit={async e => { e.preventDefault(); if (!q.trim()) return; const t = await addTag(q.trim()); if (t) toggle(t.id); setQ(""); }}>
            <input id={`tag-${task.id}`} autoFocus className="field mb-1" placeholder="Search or add tag…" value={q} onChange={e => setQ(e.target.value)} />
          </form>
          <div className="max-h-[220px] overflow-auto">
            {tags.filter(t => t.name.toLowerCase().includes(q.toLowerCase())).map(t => <button key={t.id} className="menu-item" onClick={() => toggle(t.id)}><Dot color={t.color} /> {t.name}{mine.includes(t.id) && <Check size={12} className="ml-auto" />}</button>)}
          </div>
          <button className="menu-item text-ink-3 text-[11px]" onClick={close}>Done</button>
        </div>
      )}
    </Popover>
  );
}
