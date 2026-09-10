"use client";
import { useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, useDroppable, useDraggable, type DragEndEvent } from "@dnd-kit/core";
import { addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek, isToday } from "date-fns";
import clsx from "clsx";
import { useStore } from "@/lib/store";
import type { Task } from "@/lib/types";
import { PriorityFlag } from "../ui";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

export function CalendarView({ tasks, onAdd }: { tasks: Task[]; onAdd?: (date: Date, title: string) => void }) {
  const { updateTask, select, selectedId, projects, completeTask } = useStore();
  const [mode, setMode] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState(new Date());
  const [adding, setAdding] = useState<string | null>(null);
  const [text, setText] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const start = mode === "month" ? startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }) : startOfWeek(cursor, { weekStartsOn: 1 });
  const end = mode === "month" ? endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }) : endOfWeek(cursor, { weekStartsOn: 1 });
  const days: Date[] = []; for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  const byDay = (d: Date) => tasks.filter(t => t.due_at && isSameDay(new Date(t.due_at), d)).sort((a, b) => a.priority - b.priority);
  const undated = tasks.filter(t => !t.due_at);

  function onDragEnd(e: DragEndEvent) {
    if (!e.over) return;
    const t = tasks.find(x => x.id === e.active.id); if (!t) return;
    const target = new Date(String(e.over.id));
    const old = t.due_at ? new Date(t.due_at) : null;
    if (old && t.due_has_time) target.setHours(old.getHours(), old.getMinutes(), 0, 0); else target.setHours(23, 59, 0, 0);
    updateTask(t.id, { due_at: target.toISOString() });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex items-center gap-2 mb-2">
        <button className="btn sm" onClick={() => setCursor(new Date())}>Today</button>
        <button className="btn ghost sm px-1" onClick={() => setCursor(mode === "month" ? addMonths(cursor, -1) : addWeeks(cursor, -1))}><ChevronLeft size={14} /></button>
        <button className="btn ghost sm px-1" onClick={() => setCursor(mode === "month" ? addMonths(cursor, 1) : addWeeks(cursor, 1))}><ChevronRight size={14} /></button>
        <div className="font-semibold text-[14px]">{mode === "month" ? format(cursor, "MMMM yyyy") : `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`}</div>
        <div className="ml-auto flex border border-line rounded-md overflow-hidden">
          {(["month", "week"] as const).map(m => <button key={m} className={clsx("h-7 px-2.5 text-[12px] capitalize", mode === m ? "bg-selected font-medium" : "hover:bg-hover text-ink-2")} onClick={() => setMode(m)}>{m}</button>)}
        </div>
      </div>
      <div className="border border-line rounded-lg overflow-hidden bg-panel">
        <div className="grid grid-cols-7 bg-panel-2 border-b border-line text-[11px] font-semibold text-ink-3 uppercase tracking-wide">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => <div key={d} className="px-2 h-7 flex items-center">{d}</div>)}
        </div>
        <div className={clsx("grid grid-cols-7", mode === "week" ? "auto-rows-[minmax(360px,1fr)]" : "auto-rows-[minmax(112px,1fr)]")}>
          {days.map(d => <Day key={d.toISOString()} d={d} tasks={byDay(d)} dim={mode === "month" && !isSameMonth(d, cursor)} adding={adding} setAdding={setAdding} text={text} setText={setText} onAdd={onAdd} />)}
        </div>
      </div>
      {undated.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] font-semibold text-ink-3 uppercase tracking-wide mb-1">No date · drag onto a day</div>
          <div className="flex flex-wrap gap-1.5">{undated.map(t => <Chip key={t.id} task={t} />)}</div>
        </div>
      )}
      <div className="hidden">{selectedId}{projects.length}{String(completeTask)}{String(select)}</div>
    </DndContext>
  );
}

function Day({ d, tasks, dim, adding, setAdding, text, setText, onAdd }: { d: Date; tasks: Task[]; dim: boolean; adding: string | null; setAdding: (k: string | null) => void; text: string; setText: (t: string) => void; onAdd?: (date: Date, title: string) => void }) {
  const key = d.toISOString();
  const { setNodeRef, isOver } = useDroppable({ id: key });
  const today = isToday(d);
  return (
    <div ref={setNodeRef} className={clsx("border-b border-r border-line-2 p-1 flex flex-col gap-0.5 group min-w-0", isOver && "bg-accent-soft", dim && "bg-panel-2/60")}>
      <div className="flex items-center h-5 px-1">
        <span className={clsx("text-[11.5px] tnum w-5 h-5 grid place-items-center rounded-full", today ? "bg-accent text-accent-ink font-semibold" : dim ? "text-ink-3" : "text-ink-2")}>{format(d, "d")}</span>
        {onAdd && <button className="ml-auto btn ghost sm px-1 opacity-0 group-hover:opacity-100" onClick={() => setAdding(key)}><Plus size={12} /></button>}
      </div>
      {tasks.map(t => <Chip key={t.id} task={t} />)}
      {adding === key && <form onSubmit={e => { e.preventDefault(); if (text.trim()) onAdd?.(d, text.trim()); setText(""); setAdding(null); }}>
        <input id={`cal-add-${key}`} autoFocus className="field h-6 text-[11.5px]" placeholder="Task" value={text} onChange={e => setText(e.target.value)} onBlur={() => { if (!text) setAdding(null); }} onKeyDown={e => { if (e.key === "Escape") setAdding(null); }} />
      </form>}
    </div>
  );
}

function Chip({ task }: { task: Task }) {
  const { select, selectedId, projects } = useStore();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  const p = projects.find(x => x.id === task.project_id);
  const done = task.status === "done";
  return (
    <button ref={setNodeRef} {...attributes} {...listeners} onClick={() => select(task.id)}
      className={clsx("flex items-center gap-1 text-left text-[11.5px] px-1.5 h-[22px] rounded border truncate w-full", selectedId === task.id ? "border-accent bg-accent-soft" : "border-line-2 bg-panel hover:bg-hover", isDragging && "opacity-40", done && "strike")}
      style={{ borderLeftColor: p?.color, borderLeftWidth: p ? 3 : undefined }}>
      <PriorityFlag p={task.priority} /><span className="truncate">{task.due_has_time && <span className="text-ink-3 tnum mr-1">{format(new Date(task.due_at!), "H:mm")}</span>}{task.title}</span>
    </button>
  );
}
