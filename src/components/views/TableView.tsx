"use client";
import { useState } from "react";
import clsx from "clsx";
import { useStore } from "@/lib/store";
import type { Task, SortSpec } from "@/lib/types";
import { DuePicker, PriorityPicker, StatusPicker, ProjectPicker, PersonPicker, TagPicker } from "../pickers";
import { ArrowUp, ArrowDown } from "lucide-react";
import { format } from "date-fns";
import { Empty } from "./ListView";

/**
 * The spreadsheet view.
 *
 * Built on a real <table> with table-layout: fixed, not a CSS grid.
 *
 * It was a grid of absolutely-sized rows inside a horizontal scroller inside
 * the page's vertical scroller, with a sticky header on top. That nesting asks
 * the browser to size a grid whose own `1fr` column depends on a width that
 * depends on the grid — and Chrome killed the tab rather than resolve it. It
 * crashed with five rows on screen, so it was never about how much was in it.
 *
 * A fixed table layout resolves every column from the <colgroup> in one pass
 * and never consults the contents, which removes the cycle outright. It is also
 * the semantically correct element for this, which is worth something on its
 * own.
 */
const COLS: { key: string; label: string; w: number | null; sortField?: keyof Task }[] = [
  { key: "title", label: "Task", w: null, sortField: "title" },   // null = takes the remainder
  { key: "status", label: "Status", w: 120, sortField: "status" },
  { key: "priority", label: "Priority", w: 96, sortField: "priority" },
  { key: "due", label: "Due", w: 120, sortField: "due_at" },
  { key: "project", label: "Project", w: 140, sortField: "project_id" },
  { key: "from", label: "From", w: 130 },
  { key: "waiting", label: "Waiting on", w: 130 },
  { key: "tags", label: "Tags", w: 160 },
  { key: "est", label: "Est.", w: 64, sortField: "duration_min" },
  { key: "created", label: "Created", w: 90, sortField: "created_at" },
];

// 36px checkbox + 260px minimum for the title + every fixed column.
const MIN_W = 36 + 260 + COLS.reduce((n, c) => n + (c.w ?? 0), 0);

export function TableView({ tasks, sort, setSort }: { tasks: Task[]; sort: SortSpec[]; setSort: (s: SortSpec[]) => void }) {
  const { selectedId, select, completeTask, updateTask, setFocus } = useStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const cur = sort[0];
  const toggleSort = (f?: keyof Task) => {
    if (!f) return;
    setSort(cur?.field === f ? (cur.dir === "asc" ? [{ field: f, dir: "desc" }] : []) : [{ field: f, dir: "asc" }]);
  };
  if (!tasks.length) return <Empty />;

  return (
    <div className="overflow-x-auto border border-line rounded-lg bg-panel">
      <table className="w-full border-collapse" style={{ tableLayout: "fixed", minWidth: MIN_W }}>
        <colgroup>
          <col style={{ width: 36 }} />
          {COLS.map(c => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}
        </colgroup>
        <thead>
          <tr className="bg-panel-2 text-[11px] font-semibold text-ink-3 uppercase tracking-wide">
            <th className="border-b border-line" />
            {COLS.map(c => (
              <th key={c.key} className="border-b border-line p-0 text-left font-semibold">
                <button
                  className={clsx("h-8 px-2 w-full flex items-center gap-1 hover:text-ink", c.sortField && "cursor-pointer")}
                  onClick={() => toggleSort(c.sortField)}>
                  {c.label}
                  {cur?.field === c.sortField && (cur.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.map(t => {
            const done = t.status === "done";
            return (
              <tr key={t.id}
                className={clsx("border-b border-line-2 text-[12.5px] group", selectedId === t.id ? "bg-selected" : "row-hover")}
                onClick={() => { select(t.id); setFocus(t.id); }}>
                <td className="h-[34px] text-center align-middle">
                  <button className={clsx("checkbox", done && "done", `p${t.priority}`)}
                    onClick={e => { e.stopPropagation(); completeTask(t.id, !done); }}
                    aria-label={done ? "Reopen" : "Complete"}>
                    {done && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>}
                  </button>
                </td>

                <td className="px-2 align-middle overflow-hidden"
                  onDoubleClick={e => { e.stopPropagation(); setEditing(t.id); setVal(t.title); }}>
                  {editing === t.id
                    ? <input id={`edit-${t.id}`} autoFocus className="w-full bg-panel border border-accent rounded px-1 h-6 outline-none"
                        value={val} onChange={e => setVal(e.target.value)}
                        onBlur={() => { if (val.trim()) updateTask(t.id, { title: val.trim() }); setEditing(null); }}
                        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null); }}
                        onClick={e => e.stopPropagation()} />
                    : <span className={clsx("truncate block", done && "strike")}>{t.title}</span>}
                </td>

                <td className="px-1 align-middle" onClick={e => e.stopPropagation()}><StatusPicker task={t} /></td>
                <td className="px-1 align-middle" onClick={e => e.stopPropagation()}><PriorityPicker task={t} label /></td>
                <td className="px-1 align-middle" onClick={e => e.stopPropagation()}><DuePicker task={t} /></td>
                <td className="px-1 align-middle" onClick={e => e.stopPropagation()}><ProjectPicker task={t} /></td>
                <td className="px-1 align-middle" onClick={e => e.stopPropagation()}><PersonPicker task={t} field="person_id" /></td>
                <td className="px-1 align-middle" onClick={e => e.stopPropagation()}><PersonPicker task={t} field="waiting_on_person_id" /></td>
                <td className="px-1 align-middle overflow-hidden" onClick={e => e.stopPropagation()}><TagPicker task={t} /></td>

                <td className="px-2 align-middle tnum text-ink-2" onClick={e => e.stopPropagation()}>
                  <input className="w-12 bg-transparent outline-none" placeholder="—" value={t.duration_min ?? ""}
                    onChange={e => updateTask(t.id, { duration_min: e.target.value ? Number(e.target.value) : null }, { silent: true })} />
                </td>
                <td className="px-2 align-middle text-ink-3 tnum">{format(new Date(t.created_at), "d MMM")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
