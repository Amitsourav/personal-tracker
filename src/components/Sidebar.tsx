"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Sun, CalendarDays, Inbox, Layers, Users, CheckCircle2, Settings, Plus, Search, Sparkles, FolderKanban, LayoutList, Moon, SunMedium, ChevronDown, ChevronRight, MoreHorizontal, Bookmark } from "lucide-react";
import { useStore, isOpen } from "@/lib/store";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "./ui";
import { isOverdue } from "@/lib/dates";

const COLORS = ["#3144C2", "#C8281B", "#C06600", "#1D7447", "#7B3FB8", "#0E7C86", "#8A94A6", "#B8236B"];

function Item({ href, icon: Icon, label, count, accent, onClose }: { href: string; icon: React.ComponentType<{ size?: number; className?: string }>; label: string; count?: number; accent?: boolean; onClose?: () => void }) {
  const path = usePathname();
  const active = path === href || path.startsWith(href + "/");
  return (
    <Link href={href} onClick={onClose} className={clsx("flex items-center gap-2 h-7 px-2 rounded-md text-[13px]", active ? "bg-selected text-ink font-medium" : "text-ink-2 hover:bg-hover hover:text-ink")}>
      <Icon size={15} className={clsx(active ? "text-accent" : "text-ink-3")} />
      <span className="flex-1 truncate">{label}</span>
      {!!count && <span className={clsx("text-[11px] tnum", accent ? "text-p1 font-semibold" : "text-ink-3")}>{count}</span>}
    </Link>
  );
}

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const path = usePathname();
  const router = useRouter();
  const { tasks, projects, views, addProject, updateProject, deleteProject, setCmdOpen, setQuickAddOpen, deleteView } = useStore();
  const [theme, setTheme] = useState<string>("system");
  const [projOpen, setProjOpen] = useState(true);
  const [newProj, setNewProj] = useState("");
  const [showNewProj, setShowNewProj] = useState(false);

  useEffect(() => { try { setTheme(localStorage.getItem("theme") ?? "system"); } catch {} }, []);
  function cycleTheme() {
    const next = theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
    setTheme(next);
    try { if (next === "system") { localStorage.removeItem("theme"); document.documentElement.removeAttribute("data-theme"); } else { localStorage.setItem("theme", next); document.documentElement.setAttribute("data-theme", next); } } catch {}
  }

  const now = new Date();
  const open = tasks.filter(t => t.review_state === "accepted" && isOpen(t.status));
  const startToday = new Date(now); startToday.setHours(0,0,0,0);
  const endToday = new Date(startToday); endToday.setDate(endToday.getDate() + 1);
  const todayCount = open.filter(t => t.due_at && new Date(t.due_at) < endToday).length;
  const overdue = open.filter(t => isOverdue(t)).length;
  const inboxCount = open.filter(t => t.status === "inbox").length;
  const reviewCount = tasks.filter(t => t.review_state === "suggested").length;
  const projCount = (id: string) => open.filter(t => t.project_id === id).length;

  return (
    <aside className="w-[232px] flex-none h-full flex flex-col bg-panel-2 border-r border-line">
      <div className="flex items-center gap-2 px-3 h-12">
        <div className="w-6 h-6 rounded-md bg-accent text-accent-ink grid place-items-center font-semibold text-[13px]">T</div>
        <div className="font-semibold text-[13.5px] flex-1">Tracker</div>
        <button className="btn ghost sm px-1.5" title="Theme" onClick={cycleTheme}>{theme === "dark" ? <Moon size={14}/> : theme === "light" ? <SunMedium size={14}/> : <Sun size={14}/>}</button>
      </div>
      <div className="px-2 grid gap-1">
        <button className="btn primary justify-start h-8" onClick={() => { setQuickAddOpen(true); onClose?.(); }}><Plus size={15}/> New task <span className="ml-auto opacity-70 text-[11px]">N</span></button>
        <button className="btn justify-start h-8 text-ink-2" onClick={() => { setCmdOpen(true); onClose?.(); }}><Search size={14}/> Search & commands <span className="ml-auto text-[11px] opacity-70">⌘K</span></button>
      </div>
      <nav className="px-2 mt-3 grid gap-0.5 overflow-y-auto flex-1 pb-3">
        <Item href="/today" icon={Sun} label="Today" count={todayCount} accent={overdue > 0} onClose={onClose} />
        <Item href="/upcoming" icon={CalendarDays} label="Upcoming" onClose={onClose} />
        <Item href="/inbox" icon={Inbox} label="Inbox" count={inboxCount} onClose={onClose} />
        <Item href="/review" icon={Sparkles} label="Review" count={reviewCount} accent onClose={onClose} />
        <Item href="/all" icon={Layers} label="All tasks" count={open.length} onClose={onClose} />
        <Item href="/people" icon={Users} label="People" onClose={onClose} />
        <Item href="/logbook" icon={CheckCircle2} label="Logbook" onClose={onClose} />

        {views.length > 0 && <div className="mt-3 px-2 text-[11px] font-semibold text-ink-3 uppercase tracking-wide flex items-center h-6">Views</div>}
        {views.map(v => (
          <div key={v.id} className="group flex items-center">
            <Item href={`/view/${v.id}`} icon={Bookmark} label={v.name} onClose={onClose} />
            <Popover align="right" trigger={<button className="btn ghost sm px-1 opacity-0 group-hover:opacity-100"><MoreHorizontal size={13}/></button>}>
              {(close) => <button className="menu-item text-danger" onClick={() => { deleteView(v.id); close(); }}>Delete view</button>}
            </Popover>
          </div>
        ))}

        <div className="mt-3 flex items-center h-6 px-1">
          <button className="flex items-center gap-1 text-[11px] font-semibold text-ink-3 uppercase tracking-wide" onClick={() => setProjOpen(!projOpen)}>
            {projOpen ? <ChevronDown size={12}/> : <ChevronRight size={12}/>} Projects
          </button>
          <button className="btn ghost sm px-1 ml-auto" title="New project" onClick={() => setShowNewProj(true)}><Plus size={13}/></button>
        </div>
        {showNewProj && (
          <form className="px-1 pb-1" onSubmit={async e => { e.preventDefault(); if (newProj.trim()) { const p = await addProject({ name: newProj.trim(), color: COLORS[projects.length % COLORS.length] }); setNewProj(""); setShowNewProj(false); if (p) router.push(`/project/${p.id}`); } }}>
            <input id="new-project" autoFocus className="field h-7" placeholder="Project name" value={newProj} onChange={e => setNewProj(e.target.value)} onBlur={() => { if (!newProj) setShowNewProj(false); }} />
          </form>
        )}
        {projOpen && projects.map(p => {
          const active = path === `/project/${p.id}`;
          return (
            <div key={p.id} className="group flex items-center">
              <Link href={`/project/${p.id}`} onClick={onClose} className={clsx("flex items-center gap-2 h-7 px-2 rounded-md text-[13px] flex-1 min-w-0", active ? "bg-selected text-ink font-medium" : "text-ink-2 hover:bg-hover hover:text-ink")}>
                <span className="w-[9px] h-[9px] rounded-[3px] flex-none" style={{ background: p.color }} />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-[11px] text-ink-3 tnum">{projCount(p.id) || ""}</span>
              </Link>
              <Popover align="right" trigger={<button className="btn ghost sm px-1 opacity-0 group-hover:opacity-100"><MoreHorizontal size={13}/></button>}>
                {(close) => (
                  <div className="grid gap-1">
                    <div className="flex gap-1 px-1 py-1">{COLORS.map(c => <button key={c} className="w-4 h-4 rounded-full border border-line" style={{ background: c, outline: p.color === c ? `2px solid ${c}` : undefined, outlineOffset: 1 }} onClick={() => updateProject(p.id, { color: c })} />)}</div>
                    <button className="menu-item" onClick={() => { const n = prompt("Rename project", p.name); if (n) updateProject(p.id, { name: n }); close(); }}>Rename</button>
                    <button className="menu-item text-danger" onClick={() => { if (confirm(`Archive “${p.name}”? Its tasks stay.`)) deleteProject(p.id); close(); }}>Archive</button>
                  </div>
                )}
              </Popover>
            </div>
          );
        })}
      </nav>
      <div className="px-2 pb-2 border-t border-line pt-2">
        <Item href="/settings" icon={Settings} label="Settings" onClose={onClose} />
      </div>
    </aside>
  );
}
export { FolderKanban, LayoutList };
