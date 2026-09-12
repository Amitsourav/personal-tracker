"use client";
import { useState } from "react";
import clsx from "clsx";
import { useStore } from "@/lib/store";
import type { Task, SortSpec } from "@/lib/types";
import { DuePicker, PriorityPicker, StatusPicker, ProjectPicker, PersonPicker, TagPicker } from "../pickers";
import { ArrowUp, ArrowDown } from "lucide-react";
import { format } from "date-fns";
import { Empty } from "./ListView";

const COLS: { key: string; label: string; w: string; sortField?: keyof Task }[] = [
  { key: "title", label: "Task", w: "minmax(260px,1fr)", sortField: "title" },
  { key: "status", label: "Status", w: "120px", sortField: "status" },
  { key: "priority", label: "Priority", w: "96px", sortField: "priority" },
  { key: "due", label: "Due", w: "120px", sortField: "due_at" },
  { key: "project", label: "Project", w: "140px", sortField: "project_id" },
  { key: "from", label: "From", w: "130px" },
  { key: "waiting", label: "Waiting on", w: "130px" },
  { key: "tags", label: "Tags", w: "160px" },
  { key: "est", label: "Est.", w: "64px", sortField: "duration_min" },
  { key: "created", label: "Created", w: "90px", sortField: "created_at" },
];

export function TableView({ tasks, sort, setSort }: { tasks: Task[]; sort: SortSpec[]; setSort: (s: SortSpec[]) => void }) {
  const { selectedId, select, completeTask, updateTask, setFocus } = useStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const cur = sort[0];
  const toggleSort = (f?: keyof Task) => { if (!f) return; setSort(cur?.field === f ? (cur.dir === "asc" ? [{ field: f, dir: "desc" }] : []) : [{ field: f, dir: "asc" }]); };
  if (!tasks.length) return <Empty />;
  // 36px checkbox + the title column's 260px minimum + every fixed column.
  // Reserve less and the grid overflows its own scroll container, putting the
  // last column out of reach.
  const grid = COLS.map(c => c.w).join(" ");
  return (
    <div className="overflow-x-auto border border-line rounded-lg bg-panel pb-0">
      <div className="min-w-[1346px]">
        <div className="grid sticky top-0 bg-panel-2 border-b border-line text-[11px] font-semibold text-ink-3 uppercase tracking-wide z-10" style={{ gridTemplateColumns: `36px ${grid}` }}>
          <div />
          {COLS.map(c => <button key={c.key} className={clsx("h-8 px-2 text-left flex items-center gap-1 hover:text-ink", c.sortField && "cursor-pointer")} onClick={() => toggleSort(c.sortField)}>{c.label}{cur?.field === c.sortField && (cur.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</button>)}
        </div>
        {tasks.map(t => {
          const done = t.status === "done";
          return (
            <div key={t.id} className={clsx("grid items-center border-b border-line-2 text-[12.5px] group", selectedId === t.id ? "bg-selected" : "row-hover")} style={{ gridTemplateColumns: `36px ${grid}`, minHeight: 34 }} onClick={() => { select(t.id); setFocus(t.id); }}>
              <div className="grid place-items-center"><button className={clsx("checkbox", done && "done", `p${t.priority}`)} onClick={e => { e.stopPropagation(); completeTask(t.id, !done); }}>{done && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>}</button></div>
              <div className="px-2 min-w-0" onDoubleClick={e => { e.stopPropagation(); setEditing(t.id); setVal(t.title); }}>
                {editing === t.id
                  ? <input id={`edit-${t.id}`} autoFocus className="w-full bg-panel border border-accent rounded px-1 h-6 outline-none" value={val} onChange={e => setVal(e.target.value)} onBlur={() => { if (val.trim()) updateTask(t.id, { title: val.trim() }); setEditing(null); }} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null); }} onClick={e => e.stopPropagation()} />
                  : <span className={clsx("truncate block", done && "strike")}>{t.title}</span>}
              </div>
              <div className="px-1" onClick={e => e.stopPropagation()}><StatusPicker task={t} /></div>
              <div className="px-1" onClick={e => e.stopPropagation()}><PriorityPicker task={t} label /></div>
              <div className="px-1" onClick={e => e.stopPropagation()}><DuePicker task={t} /></div>
              <div className="px-1" onClick={e => e.stopPropagation()}><ProjectPicker task={t} /></div>
              <div className="px-1" onClick={e => e.stopPropagation()}><PersonPicker task={t} field="person_id" /></div>
              <div className="px-1" onClick={e => e.stopPropagation()}><PersonPicker task={t} field="waiting_on_person_id" /></div>
              <div className="px-1 overflow-hidden" onClick={e => e.stopPropagation()}><TagPicker task={t} /></div>
              <div className="px-2 tnum text-ink-2" onClick={e => e.stopPropagation()}><input className="w-12 bg-transparent outline-none" placeholder="—" value={t.duration_min ?? ""} onChange={e => updateTask(t.id, { duration_min: e.target.value ? Number(e.target.value) : null }, { silent: true })} /></div>
              <div className="px-2 text-ink-3 tnum">{format(new Date(t.created_at), "d MMM")}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
