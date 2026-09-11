"use client";
import { useMemo, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { useStore } from "@/lib/store";
import type { Task } from "@/lib/types";
import { TaskRow } from "./TaskRow";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import clsx from "clsx";

export interface Group { key: string; label: string; color?: string; tasks: Task[]; hint?: string }

export function ListView({ groups, showProject, sortable, onQuickAdd }: { groups: Group[]; showProject?: boolean; sortable?: boolean; onQuickAdd?: (groupKey: string, title: string) => void }) {
  const { updateTask, tasks } = useStore();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [text, setText] = useState("");
  const childrenOf = useMemo(() => { const m: Record<string, Task[]> = {}; for (const t of tasks) if (t.parent_id) (m[t.parent_id] ??= []).push(t); return m; }, [tasks]);

  function onDragEnd(e: DragEndEvent, g: Group) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = g.tasks.map(t => t.id);
    const from = ids.indexOf(String(active.id)), to = ids.indexOf(String(over.id));
    const moved = arrayMove(g.tasks, from, to);
    // assign new sort orders (spread)
    moved.forEach((t, i) => { if (t.sort_order !== i) updateTask(t.id, { sort_order: i }, { silent: true }); });
  }

  if (!groups.some(g => g.tasks.length)) return <Empty />;
  return (
    <div className="grid gap-6 pb-24 max-w-[980px]">
      {groups.map(g => g.tasks.length > 0 || onQuickAdd ? (
        <section key={g.key}>
          <header className="flex items-center gap-2 h-7 px-1 mb-0.5">
            <button className="flex items-center gap-1 text-[12px] font-semibold text-ink-2 hover:text-ink" onClick={() => setCollapsed(c => ({ ...c, [g.key]: !c[g.key] }))}>
              {collapsed[g.key] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              {g.color && <span className="w-[9px] h-[9px] rounded-[3px]" style={{ background: g.color }} />}
              {g.label} <span className="text-ink-3 font-normal tnum">{g.tasks.length}</span>
            </button>
            {g.hint && <span className="text-[11px] text-ink-3">{g.hint}</span>}
            {onQuickAdd && <button className="btn ghost sm px-1 ml-auto opacity-60 hover:opacity-100" onClick={() => setAdding(g.key)}><Plus size={13} /></button>}
          </header>
          {!collapsed[g.key] && (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={e => onDragEnd(e, g)}>
              <SortableContext items={g.tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                <div className="grid">
                  {g.tasks.map(t => (
                    <div key={t.id}>
                      <TaskRow task={t} showProject={showProject} sortable={sortable} />
                      {(childrenOf[t.id] ?? []).filter(c => c.status !== "done" && c.status !== "cancelled").map(c => <TaskRow key={c.id} task={c} showProject={false} depth={1} />)}
                    </div>
                  ))}
                  {adding === g.key && (
                    <form className="flex items-center gap-2 h-8 px-2" onSubmit={e => { e.preventDefault(); if (text.trim()) onQuickAdd?.(g.key, text.trim()); setText(""); }}>
                      <span className="checkbox opacity-40" /><input id={`add-${g.key}`} autoFocus className="bg-transparent outline-none flex-1 text-[13px]" placeholder="Task name — ↵ to add, Esc to close" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Escape") { setAdding(null); setText(""); } }} onBlur={() => { if (!text) setAdding(null); }} />
                    </form>
                  )}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </section>
      ) : null)}
    </div>
  );
}

export function Empty({ text = "Nothing here yet", sub = "Press N to add a task, or let Gmail and WhatsApp bring them in." }: { text?: string; sub?: string }) {
  return <div className={clsx("grid place-items-center py-24 text-center")}><div><div className="text-[14px] font-medium text-ink-2">{text}</div><div className="text-[12px] text-ink-3 mt-1">{sub}</div></div></div>;
}
