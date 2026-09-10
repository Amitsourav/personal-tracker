"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import type { TaskEvent, Task } from "@/lib/types";
import { DuePicker, PriorityPicker, StatusPicker, ProjectPicker, PersonPicker, TagPicker } from "./pickers";
import { Popover } from "./ui";
import { X, Trash2, Plus, Repeat, Timer, Link2, Sparkles, ChevronRight, ExternalLink } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import clsx from "clsx";

const RECUR_OPTS: [string, string | null][] = [["No repeat", null], ["Daily", "FREQ=DAILY"], ["Weekdays", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"], ["Weekly", "FREQ=WEEKLY"], ["Every 2 weeks", "FREQ=WEEKLY;INTERVAL=2"], ["Monthly", "FREQ=MONTHLY"], ["Yearly", "FREQ=YEARLY"]];
const recurLabel = (r: string | null) => RECUR_OPTS.find(o => o[1] === r)?.[0] ?? (r ? r.toLowerCase() : "No repeat");

export function TaskDetail() {
  const { selectedId, select, tasks, updateTask, deleteTask, completeTask, addTask } = useStore();
  const task = tasks.find(t => t.id === selectedId);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [newSub, setNewSub] = useState("");
  const subtasks = tasks.filter(t => t.parent_id === selectedId).sort((a, b) => a.sort_order - b.sort_order);
  const parent = task?.parent_id ? tasks.find(t => t.id === task.parent_id) : null;

  useEffect(() => { if (task) { setTitle(task.title); setDesc(task.description ?? ""); } }, [task?.id, task?.title, task?.description]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selectedId) return;
    createClient().from("task_events").select("*").eq("task_id", selectedId).order("created_at", { ascending: false }).limit(50).then(({ data }) => setEvents((data ?? []) as TaskEvent[]));
  }, [selectedId, task?.updated_at]);

  if (!task) return null;
  const done = task.status === "done";

  return (
    <aside className="w-full md:w-[400px] lg:w-[440px] flex-none h-full flex flex-col bg-panel border-l border-line fade-in">
      <div className="flex items-center gap-1 h-11 px-3 border-b border-line">
        {parent && <button className="text-[12px] text-ink-3 hover:text-ink flex items-center gap-1 truncate max-w-[200px]" onClick={() => select(parent.id)}>{parent.title} <ChevronRight size={12} /></button>}
        <div className="ml-auto flex items-center gap-1">
          <button className="btn ghost sm" onClick={() => deleteTask(task.id)} title="Delete"><Trash2 size={14} /></button>
          <button className="btn ghost sm" onClick={() => select(null)} title="Close (Esc)"><X size={15} /></button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 grid gap-3">
          <div className="flex items-start gap-2.5">
            <button className={clsx("checkbox mt-1", done && "done", `p${task.priority}`)} onClick={() => completeTask(task.id, !done)}>{done && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>}</button>
            <textarea id="detail-title" className={clsx("flex-1 bg-transparent outline-none text-[16px] font-semibold leading-snug resize-none", done && "strike")} rows={Math.min(4, Math.ceil(title.length / 36) || 1)}
              value={title} onChange={e => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title !== task.title) updateTask(task.id, { title: title.trim() }); }} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }} />
          </div>
          <div className="grid grid-cols-[92px_1fr] gap-y-2 gap-x-2 items-center text-[12.5px]">
            <span className="text-ink-3">Status</span><div><StatusPicker task={task} /></div>
            <span className="text-ink-3">Priority</span><div><PriorityPicker task={task} label /></div>
            <span className="text-ink-3">Due</span><div><DuePicker task={task} /></div>
            <span className="text-ink-3">Project</span><div><ProjectPicker task={task} /></div>
            <span className="text-ink-3">Tags</span><div><TagPicker task={task} /></div>
            <span className="text-ink-3">From</span><div><PersonPicker task={task} field="person_id" /></div>
            <span className="text-ink-3">Waiting on</span><div><PersonPicker task={task} field="waiting_on_person_id" /></div>
            <span className="text-ink-3">Estimate</span>
            <div className="flex items-center gap-1"><Timer size={12} className="text-ink-3" />
              <input id="detail-duration" className="bg-transparent outline-none w-16 tnum" placeholder="— min" value={task.duration_min ?? ""} onChange={e => updateTask(task.id, { duration_min: e.target.value ? Number(e.target.value) : null }, { silent: true })} /><span className="text-ink-3">min</span></div>
            <span className="text-ink-3">Repeat</span>
            <div><Popover trigger={<button className="pill text-ink-2 hover:bg-hover"><Repeat size={11} /> {recurLabel(task.recurrence)}</button>}>
              {(close) => <>{RECUR_OPTS.map(([l, r]) => <button key={l} className="menu-item" data-active={task.recurrence === r} onClick={() => { updateTask(task.id, { recurrence: r, recurrence_anchor: r ? (task.due_at ?? new Date().toISOString()) : null }); close(); }}>{l}</button>)}</>}
            </Popover></div>
          </div>

          <textarea id="detail-desc" className="w-full bg-panel-2 rounded-lg p-2.5 outline-none text-[13px] resize-none min-h-[72px] border border-transparent focus:border-line" placeholder="Notes…" value={desc}
            onChange={e => setDesc(e.target.value)} onBlur={() => { if (desc !== (task.description ?? "")) updateTask(task.id, { description: desc || null }); }} />

          {(task.source_kind !== "manual" || task.source_quote) && (
            <div className="rounded-lg border border-line p-2.5 text-[12px]">
              <div className="flex items-center gap-1.5 text-ink-3 mb-1"><Sparkles size={12} /> From {task.source_kind}{task.confidence != null && ` · ${Math.round(task.confidence * 100)}% confident`}
                {task.source_link && <a className="ml-auto text-accent flex items-center gap-1" href={task.source_link} target="_blank" rel="noreferrer">Open <ExternalLink size={11} /></a>}</div>
              {task.source_quote && <blockquote className="text-ink-2 border-l-2 border-line pl-2 italic">“{task.source_quote}”</blockquote>}
            </div>
          )}

          <div>
            <div className="text-[11px] font-semibold text-ink-3 uppercase tracking-wide mb-1 flex items-center">Subtasks <span className="ml-1 tnum font-normal">{subtasks.filter(s => s.status === "done").length}/{subtasks.length}</span></div>
            <div className="grid">
              {subtasks.map(s => <SubRow key={s.id} t={s} />)}
              <form className="flex items-center gap-2 h-7 px-1" onSubmit={async e => { e.preventDefault(); if (!newSub.trim()) return; await addTask({ title: newSub.trim(), parent_id: task.id, project_id: task.project_id, status: "todo" }); setNewSub(""); }}>
                <Plus size={13} className="text-ink-3" /><input id="new-subtask" className="bg-transparent outline-none flex-1 text-[13px]" placeholder="Add subtask" value={newSub} onChange={e => setNewSub(e.target.value)} />
              </form>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold text-ink-3 uppercase tracking-wide mb-1">Activity</div>
            <div className="grid gap-1.5 text-[12px]">
              {events.map(ev => (
                <div key={ev.id} className="flex gap-2">
                  <span className={clsx("mt-[5px] w-[6px] h-[6px] rounded-full flex-none", ev.actor === "ai" ? "bg-accent" : "bg-ink-3")} />
                  <div className="flex-1 min-w-0"><span className="text-ink-2">{describe(ev)}</span> <span className="text-ink-3" title={format(new Date(ev.created_at), "d MMM yyyy, h:mm a")}>· {formatDistanceToNow(new Date(ev.created_at), { addSuffix: true })}</span></div>
                </div>
              ))}
              {!events.length && <div className="text-ink-3">No activity yet.</div>}
            </div>
          </div>
          <div className="text-[11px] text-ink-3 flex items-center gap-1"><Link2 size={11} /> Created {format(new Date(task.created_at), "d MMM yyyy")}</div>
        </div>
      </div>
    </aside>
  );
}

function SubRow({ t }: { t: Task }) {
  const { completeTask, select } = useStore();
  const done = t.status === "done";
  return (
    <div className="flex items-center gap-2 h-7 px-1 rounded row-hover group cursor-pointer" onClick={() => select(t.id)}>
      <button className={clsx("checkbox", done && "done", `p${t.priority}`)} onClick={e => { e.stopPropagation(); completeTask(t.id, !done); }}>{done && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>}</button>
      <span className={clsx("flex-1 truncate text-[13px]", done && "strike")}>{t.title}</span>
    </div>
  );
}

function describe(ev: TaskEvent): string {
  const who = ev.actor === "ai" ? "AI" : "You";
  const ch = ev.changes ?? {};
  switch (ev.kind) {
    case "created": return `${who} created this task`;
    case "ai_suggested": return "AI suggested this task";
    case "ai_accepted": return "You accepted the suggestion";
    case "ai_rejected": return "You rejected the suggestion";
    case "completed": return `${who} completed it`;
    case "reopened": return `${who} reopened it`;
    case "deleted": return `${who} deleted it`;
    case "rescheduled": { const d = (ch.due_at?.to ?? ch.scheduled_at?.to) as string | null; return d ? `${who} rescheduled to ${format(new Date(d), "d MMM")}` : `${who} removed the date`; }
    default: { const keys = Object.keys(ch).filter(k => k !== "updated_at"); return `${who} changed ${keys.map(k => k.replace(/_id$/, "").replace(/_/g, " ")).join(", ") || "the task"}`; }
  }
}
