"use client";
import clsx from "clsx";
import { useStore } from "@/lib/store";
import type { Task } from "@/lib/types";
import { DuePicker, PriorityPicker, ProjectPicker, PersonPicker, TagPicker } from "../pickers";
import { Repeat, CornerDownRight, MessageSquareText } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export function TaskRow({ task, showProject = true, sortable = false, depth = 0 }: { task: Task; showProject?: boolean; sortable?: boolean; depth?: number }) {
  const { selectedId, focusId, select, setFocus, completeTask, tasks } = useStore();
  const done = task.status === "done";
  const selected = selectedId === task.id;
  const focused = focusId === task.id;
  const subs = tasks.filter(t => t.parent_id === task.id);
  const subDone = subs.filter(s => s.status === "done").length;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: !sortable });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      data-task={task.id}
      className={clsx("group flex items-center gap-2.5 h-9 pr-2 rounded-lg cursor-default select-none border border-transparent", selected ? "bg-selected" : focused ? "bg-hover border-line" : "row-hover")}
      onClick={() => { select(task.id); setFocus(task.id); }} onMouseEnter={() => setFocus(task.id)}>
      <div style={{ width: 8 + depth * 18 }} className="flex-none" />
      {depth > 0 && <CornerDownRight size={12} className="text-ink-3 -ml-1" />}
      <button className={clsx("checkbox", done && "done", `p${task.priority}`)} onClick={e => { e.stopPropagation(); completeTask(task.id, !done); }} aria-label={done ? "Reopen" : "Complete"}>
        {done && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>}
      </button>
      <span className={clsx("flex-1 min-w-0 truncate text-[13px]", done && "strike", task.status === "waiting" && "text-ink-2")}>{task.title}</span>
      {task.verification === "self" && (
        <span className="pill bg-p2-soft text-p2 flex-none" title="You marked this done — nobody has confirmed they got it">unconfirmed</span>
      )}
      {task.description && <MessageSquareText size={12} className="text-ink-3 flex-none" />}
      {task.recurrence && <Repeat size={12} className="text-ink-3 flex-none" />}
      {subs.length > 0 && <span className="text-[11px] text-ink-3 tnum flex-none">{subDone}/{subs.length}</span>}
      <div className="hidden sm:flex items-center gap-1 flex-none" onClick={e => e.stopPropagation()}>
        <TagPicker task={task} compact />
        {task.person_id && <PersonPicker task={task} field="person_id" compact />}
        {task.waiting_on_person_id && <span className="pill bg-p2-soft text-p2">waiting</span>}
        {showProject && <ProjectPicker task={task} compact />}
        <DuePicker task={task} compact />
        <PriorityPicker task={task} subtle />
      </div>
      <div className="sm:hidden flex items-center gap-1 flex-none" onClick={e => e.stopPropagation()}>
        <DuePicker task={task} compact />
        <PriorityPicker task={task} subtle />
      </div>
    </div>
  );
}
