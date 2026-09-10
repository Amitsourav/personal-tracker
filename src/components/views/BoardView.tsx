"use client";
import { DndContext, PointerSensor, useSensor, useSensors, useDroppable, useDraggable, DragOverlay, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { useState } from "react";
import clsx from "clsx";
import { useStore } from "@/lib/store";
import type { Task } from "@/lib/types";
import { DuePicker, PriorityPicker, PersonPicker } from "../pickers";
import { PriorityFlag, Avatar } from "../ui";
import { fmtDue } from "@/lib/dates";
import { Plus } from "lucide-react";

export interface Column { key: string; label: string; color?: string; tasks: Task[] }

export function BoardView({ columns, onMove, onAdd }: { columns: Column[]; onMove: (taskId: string, colKey: string) => void; onAdd?: (colKey: string, title: string) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [active, setActive] = useState<Task | null>(null);
  const all = columns.flatMap(c => c.tasks);
  return (
    <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setActive(all.find(t => t.id === e.active.id) ?? null)} onDragEnd={(e: DragEndEvent) => { setActive(null); if (e.over) onMove(String(e.active.id), String(e.over.id)); }}>
      <div className="flex gap-3 overflow-x-auto pb-6 items-start min-h-[60vh]">
        {columns.map(c => <Col key={c.key} col={c} onAdd={onAdd} />)}
      </div>
      <DragOverlay>{active && <Card task={active} overlay />}</DragOverlay>
    </DndContext>
  );
}

function Col({ col, onAdd }: { col: Column; onAdd?: (k: string, t: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  return (
    <div ref={setNodeRef} className={clsx("w-[272px] flex-none rounded-lg bg-panel-2 border border-line flex flex-col max-h-[calc(100vh-150px)]", isOver && "border-accent")}>
      <div className="flex items-center gap-2 px-3 h-9 text-[12px] font-semibold text-ink-2">
        {col.color && <span className="w-[9px] h-[9px] rounded-[3px]" style={{ background: col.color }} />}{col.label}<span className="text-ink-3 font-normal tnum">{col.tasks.length}</span>
        {onAdd && <button className="btn ghost sm px-1 ml-auto" onClick={() => setAdding(true)}><Plus size={13} /></button>}
      </div>
      <div className="grid gap-1.5 px-2 pb-2 overflow-y-auto">
        {col.tasks.map(t => <Card key={t.id} task={t} />)}
        {adding && <form onSubmit={e => { e.preventDefault(); if (text.trim()) onAdd?.(col.key, text.trim()); setText(""); setAdding(false); }}>
          <input id={`board-add-${col.key}`} autoFocus className="field" placeholder="Task name" value={text} onChange={e => setText(e.target.value)} onBlur={() => { if (!text) setAdding(false); }} onKeyDown={e => { if (e.key === "Escape") setAdding(false); }} />
        </form>}
      </div>
    </div>
  );
}

function Card({ task, overlay }: { task: Task; overlay?: boolean }) {
  const { select, selectedId, projects, people, completeTask } = useStore();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  const p = projects.find(x => x.id === task.project_id);
  const person = people.find(x => x.id === task.person_id);
  const done = task.status === "done";
  return (
    <div ref={overlay ? undefined : setNodeRef} {...(overlay ? {} : { ...attributes, ...listeners })} onClick={() => select(task.id)}
      className={clsx("bg-panel border rounded-md p-2.5 grid gap-1.5 cursor-grab active:cursor-grabbing", selectedId === task.id ? "border-accent" : "border-line hover:border-ink-3/40", isDragging && !overlay && "opacity-30", overlay && "shadow-lg rotate-1")}>
      <div className="flex items-start gap-2">
        <button className={clsx("checkbox mt-0.5", done && "done", `p${task.priority}`)} onClick={e => { e.stopPropagation(); completeTask(task.id, !done); }} onPointerDown={e => e.stopPropagation()}>{done && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>}</button>
        <span className={clsx("text-[12.5px] leading-snug", done && "strike")}>{task.title}</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-ink-3" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
        <PriorityFlag p={task.priority} />
        {task.due_at && <DuePicker task={task} />}
        {p && <span className="pill text-ink-2"><span className="w-[7px] h-[7px] rounded-[2px]" style={{ background: p.color }} /> {p.name}</span>}
        {person && <span className="ml-auto"><Avatar name={person.name} size={16} /></span>}
      </div>
    </div>
  );
}
export { PersonPicker, PriorityPicker, fmtDue };
