"use client";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useStore, applyFilter, sortTasks } from "@/lib/store";
import type { Layout, SortSpec, Task, TaskStatus, ViewFilter } from "@/lib/types";
import { STATUS_LABEL, STATUS_ORDER, PRIORITY_LABEL } from "@/lib/types";
import { ListView, type Group } from "./views/ListView";
import { TableView } from "./views/TableView";
import { BoardView } from "./views/BoardView";
import { CalendarView } from "./views/CalendarView";
import { Popover } from "./ui";
import { List, Table2, Kanban, CalendarDays, SlidersHorizontal, ArrowUpDown, Rows3, Search, Bookmark, Check, Eye, EyeOff, Plus } from "lucide-react";
import { dueBucket, effectiveDate } from "@/lib/dates";
import { parseQuickAdd } from "@/lib/quickadd";

export type GroupBy = "none" | "due" | "project" | "priority" | "status" | "person";

export interface WorkspaceProps {
  scopeKey: string;                 // for remembering layout per view
  title: string;
  subtitle?: string;
  baseFilter: ViewFilter;           // fixed for this view (e.g. project)
  defaultLayout?: Layout;
  defaultGroup?: GroupBy;
  defaultSort?: SortSpec[];
  defaultsForNew?: Partial<Task>;   // e.g. project_id when adding here
  showProject?: boolean;
  allowSaveView?: boolean;
  headerExtra?: React.ReactNode;
}

const LAYOUTS: { key: Layout; icon: React.ComponentType<{ size?: number }>; label: string }[] = [
  { key: "list", icon: List, label: "List" }, { key: "table", icon: Table2, label: "Table" }, { key: "board", icon: Kanban, label: "Board" }, { key: "calendar", icon: CalendarDays, label: "Calendar" },
];
const SORTS: { label: string; value: SortSpec[] }[] = [
  { label: "Manual", value: [] }, { label: "Due date", value: [{ field: "due_at", dir: "asc" }] }, { label: "Priority", value: [{ field: "priority", dir: "asc" }] },
  { label: "Newest", value: [{ field: "created_at", dir: "desc" }] }, { label: "Oldest", value: [{ field: "created_at", dir: "asc" }] }, { label: "Title", value: [{ field: "title", dir: "asc" }] },
];

export function Workspace(p: WorkspaceProps) {
  const { tasks, taskTags, projects, tags, people, addTask, updateTask, addView, toast } = useStore();
  const [layout, setLayout] = useState<Layout>(p.defaultLayout ?? "list");
  const [group, setGroup] = useState<GroupBy>(p.defaultGroup ?? "none");
  const [sort, setSort] = useState<SortSpec[]>(p.defaultSort ?? []);
  const [filter, setFilter] = useState<ViewFilter>({});
  const [showDone, setShowDone] = useState(false);
  const [search, setSearch] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // remember per-scope prefs
  useEffect(() => {
    try { const raw = localStorage.getItem(`ws:${p.scopeKey}`); if (raw) { const s = JSON.parse(raw); if (s.layout) setLayout(s.layout); if (s.group) setGroup(s.group); if (s.sort) setSort(s.sort); if (s.showDone != null) setShowDone(s.showDone); } } catch {}
    setHydrated(true);
  }, [p.scopeKey]);
  useEffect(() => { if (hydrated) try { localStorage.setItem(`ws:${p.scopeKey}`, JSON.stringify({ layout, group, sort, showDone })); } catch {} }, [layout, group, sort, showDone, hydrated, p.scopeKey]);

  const merged: ViewFilter = { ...p.baseFilter, ...filter, search: search || undefined, include_done: showDone || p.baseFilter.include_done };
  const visible = useMemo(() => sortTasks(applyFilter(tasks.filter(t => !t.parent_id || p.baseFilter.status?.includes("done")), taskTags, merged), sort), [tasks, taskTags, merged, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups: Group[] = useMemo(() => {
    if (group === "none") return [{ key: "all", label: p.title, tasks: visible }];
    const m = new Map<string, Group>();
    const push = (key: string, label: string, t: Task, color?: string, hint?: string) => { if (!m.has(key)) m.set(key, { key, label, color, tasks: [], hint }); m.get(key)!.tasks.push(t); };
    for (const t of visible) {
      if (group === "due") { const b = dueBucket(effectiveDate(t)); push(b, { overdue: "Overdue", today: "Today", tomorrow: "Tomorrow", week: "This week", later: "Later", none: "No date" }[b], t); }
      else if (group === "project") { const pr = projects.find(x => x.id === t.project_id); push(pr?.id ?? "none", pr?.name ?? "No project", t, pr?.color); }
      else if (group === "priority") push(String(t.priority), PRIORITY_LABEL[t.priority], t);
      else if (group === "status") push(t.status, STATUS_LABEL[t.status], t);
      else if (group === "person") { const pe = people.find(x => x.id === t.person_id); push(pe?.id ?? "none", pe?.name ?? "No one", t); }
    }
    const order = group === "due" ? ["overdue", "today", "tomorrow", "week", "later", "none"] : group === "priority" ? ["1", "2", "3", "4"] : group === "status" ? STATUS_ORDER : null;
    const arr = [...m.values()];
    return order ? arr.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : arr.sort((a, b) => a.label.localeCompare(b.label));
  }, [visible, group, projects, people, p.title]);

  async function quickAdd(groupKey: string, text: string) {
    const parsed = parseQuickAdd(text, { projects, tags, people });
    const extra: Partial<Task> = { ...p.defaultsForNew };
    if (group === "project" && groupKey !== "none") extra.project_id = groupKey;
    if (group === "priority") extra.priority = Number(groupKey) as 1|2|3|4;
    if (group === "status") extra.status = groupKey as TaskStatus;
    if (group === "person" && groupKey !== "none") extra.person_id = groupKey;
    if (group === "due" && !parsed.due_at) { const d = new Date(); d.setHours(23, 59, 0, 0); if (groupKey === "tomorrow") d.setDate(d.getDate() + 1); if (groupKey === "week") d.setDate(d.getDate() + 3); if (["today", "tomorrow", "week"].includes(groupKey)) extra.due_at = d.toISOString(); }
    await addTask({ title: parsed.title || text, priority: parsed.priority, due_at: parsed.due_at, due_has_time: parsed.due_has_time, project_id: parsed.project?.id ?? null, duration_min: parsed.duration_min, recurrence: parsed.recurrence, ...extra }, parsed.tags.map(t => t.id));
  }

  const boardCols = useMemo(() => {
    const by = group === "none" || group === "due" ? "status" : group;
    if (by === "status") return STATUS_ORDER.filter(s => showDone || (s !== "done" && s !== "cancelled")).map(s => ({ key: s, label: STATUS_LABEL[s], tasks: visible.filter(t => t.status === s) }));
    if (by === "priority") return [1, 2, 3, 4].map(n => ({ key: String(n), label: PRIORITY_LABEL[n], tasks: visible.filter(t => t.priority === n) }));
    if (by === "project") return [...projects.map(pr => ({ key: pr.id, label: pr.name, color: pr.color, tasks: visible.filter(t => t.project_id === pr.id) })), { key: "none", label: "No project", tasks: visible.filter(t => !t.project_id) }];
    return [...people.map(pe => ({ key: pe.id, label: pe.name, tasks: visible.filter(t => t.person_id === pe.id) })), { key: "none", label: "No one", tasks: visible.filter(t => !t.person_id) }];
  }, [visible, group, projects, people, showDone]);

  function boardMove(taskId: string, col: string) {
    const by = group === "none" || group === "due" ? "status" : group;
    if (by === "status") { if (col === "done") useStore.getState().completeTask(taskId); else updateTask(taskId, { status: col as TaskStatus, completed_at: null }); }
    else if (by === "priority") updateTask(taskId, { priority: Number(col) as 1|2|3|4 });
    else if (by === "project") updateTask(taskId, { project_id: col === "none" ? null : col });
    else updateTask(taskId, { person_id: col === "none" ? null : col });
  }

  const activeFilters = (filter.priority?.length ?? 0) + (filter.project_id?.length ?? 0) + (filter.tag_id?.length ?? 0) + (filter.status?.length ?? 0) + (filter.person_id?.length ?? 0) + (filter.due ? 1 : 0);
  const toggleIn = <T,>(arr: T[] | undefined, v: T) => { const a = arr ?? []; return a.includes(v) ? a.filter(x => x !== v) : [...a, v]; };

  return (
    <div className="h-full flex flex-col min-w-0">
      <header className="flex items-center gap-2 px-4 h-12 border-b border-line flex-none">
        <div className="min-w-0">
          <h1 className="font-semibold text-[15px] leading-tight truncate">{p.title}</h1>
          {p.subtitle && <div className="text-[11px] text-ink-3 truncate">{p.subtitle}</div>}
        </div>
        <span className="text-[11px] text-ink-3 tnum">{visible.length}</span>
        {p.headerExtra}
        <div className="ml-auto flex items-center gap-1">
          <div className="hidden md:flex items-center gap-1 border border-line rounded-md h-7 px-1.5 w-[180px] focus-within:border-accent"><Search size={13} className="text-ink-3" /><input id={`search-${p.scopeKey}`} className="bg-transparent outline-none flex-1 text-[12px] min-w-0" placeholder="Filter tasks…" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <div className="flex border border-line rounded-md overflow-hidden">
            {LAYOUTS.map(l => <button key={l.key} title={l.label} className={clsx("h-7 w-8 grid place-items-center", layout === l.key ? "bg-selected text-accent" : "text-ink-3 hover:bg-hover hover:text-ink")} onClick={() => setLayout(l.key)}><l.icon size={14} /></button>)}
          </div>
          <Popover align="right" trigger={<button className={clsx("btn sm", group !== "none" && "text-accent border-accent")}><Rows3 size={13} /> <span className="hidden sm:inline">{group === "none" ? "Group" : `By ${group}`}</span></button>}>
            {(close) => <>{(["none", "due", "project", "priority", "status", "person"] as GroupBy[]).map(g => <button key={g} className="menu-item capitalize" data-active={group === g} onClick={() => { setGroup(g); close(); }}>{g === "none" ? "No grouping" : g}{group === g && <Check size={12} className="ml-auto" />}</button>)}</>}
          </Popover>
          <Popover align="right" trigger={<button className={clsx("btn sm", sort.length > 0 && "text-accent border-accent")}><ArrowUpDown size={13} /> <span className="hidden sm:inline">{SORTS.find(s => JSON.stringify(s.value) === JSON.stringify(sort))?.label ?? "Sorted"}</span></button>}>
            {(close) => <>{SORTS.map(s => <button key={s.label} className="menu-item" data-active={JSON.stringify(s.value) === JSON.stringify(sort)} onClick={() => { setSort(s.value); close(); }}>{s.label}</button>)}</>}
          </Popover>
          <Popover align="right" trigger={<button className={clsx("btn sm", activeFilters > 0 && "text-accent border-accent")}><SlidersHorizontal size={13} /> <span className="hidden sm:inline">Filter</span>{activeFilters > 0 && <span className="tnum">{activeFilters}</span>}</button>}>
            {() => (
              <div className="w-[260px] max-h-[70vh] overflow-auto text-[12px]">
                <Sec label="Priority">{[1, 2, 3, 4].map(n => <Chk key={n} on={!!filter.priority?.includes(n)} onClick={() => setFilter(f => ({ ...f, priority: toggleIn(f.priority, n) }))}>{PRIORITY_LABEL[n]}</Chk>)}</Sec>
                <Sec label="Status">{STATUS_ORDER.map(s => <Chk key={s} on={!!filter.status?.includes(s)} onClick={() => setFilter(f => ({ ...f, status: toggleIn(f.status, s) }))}>{STATUS_LABEL[s]}</Chk>)}</Sec>
                <Sec label="Due">{(["overdue", "today", "week", "none"] as const).map(d => <Chk key={d} on={filter.due === d} onClick={() => setFilter(f => ({ ...f, due: f.due === d ? undefined : d }))}>{{ overdue: "Overdue", today: "Due today", week: "Due this week", none: "No date" }[d]}</Chk>)}</Sec>
                {!p.baseFilter.project_id && projects.length > 0 && <Sec label="Project">{projects.map(pr => <Chk key={pr.id} on={!!filter.project_id?.includes(pr.id)} onClick={() => setFilter(f => ({ ...f, project_id: toggleIn(f.project_id, pr.id) }))}><span className="w-[8px] h-[8px] rounded-[2px]" style={{ background: pr.color }} />{pr.name}</Chk>)}</Sec>}
                {tags.length > 0 && <Sec label="Tag">{tags.map(t => <Chk key={t.id} on={!!filter.tag_id?.includes(t.id)} onClick={() => setFilter(f => ({ ...f, tag_id: toggleIn(f.tag_id, t.id) }))}><span className="w-[8px] h-[8px] rounded-full" style={{ background: t.color }} />{t.name}</Chk>)}</Sec>}
                {people.length > 0 && <Sec label="Person">{people.map(pe => <Chk key={pe.id} on={!!filter.person_id?.includes(pe.id)} onClick={() => setFilter(f => ({ ...f, person_id: toggleIn(f.person_id, pe.id) }))}>{pe.name}</Chk>)}</Sec>}
                {activeFilters > 0 && <button className="menu-item text-danger mt-1" onClick={() => setFilter({})}>Clear filters</button>}
              </div>
            )}
          </Popover>
          <button className={clsx("btn sm", showDone && "text-accent border-accent")} title="Show completed" onClick={() => setShowDone(!showDone)}>{showDone ? <Eye size={13} /> : <EyeOff size={13} />}</button>
          {p.allowSaveView !== false && <button className="btn sm" title="Save as view" onClick={async () => { const name = prompt("View name"); if (name) { await addView({ name, layout, filter: merged, sort, group_by: group }); toast("View saved"); } }}><Bookmark size={13} /></button>}
          <button className="btn primary sm md:hidden" onClick={() => useStore.getState().setQuickAddOpen(true)}><Plus size={13} /></button>
        </div>
      </header>
      <div className="flex-1 overflow-auto px-3 md:px-4 py-3">
        {layout === "list" && <ListView groups={groups} showProject={p.showProject !== false} sortable={sort.length === 0} onQuickAdd={quickAdd} />}
        {layout === "table" && <TableView tasks={visible} sort={sort} setSort={setSort} />}
        {layout === "board" && <BoardView columns={boardCols} onMove={boardMove} onAdd={(k, t) => quickAdd(k, t)} />}
        {layout === "calendar" && <CalendarView tasks={visible} onAdd={(d, t) => { const parsed = parseQuickAdd(t, { projects, tags, people }); const due = new Date(d); due.setHours(23, 59, 0, 0); addTask({ title: parsed.title || t, priority: parsed.priority, due_at: due.toISOString(), ...p.defaultsForNew }); }} />}
      </div>
    </div>
  );
}

function Sec({ label, children }: { label: string; children: React.ReactNode }) { return <div className="mb-1"><div className="px-2 pt-1.5 pb-0.5 text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">{label}</div>{children}</div>; }
function Chk({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className="menu-item" onClick={onClick}><span className={clsx("checkbox !w-[13px] !h-[13px]", on && "done")}>{on && <svg width="9" height="9" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>}</span>{children}</button>;
}
