"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore, isOpen } from "@/lib/store";
import { Sidebar } from "./Sidebar";
import { TaskDetail } from "./TaskDetail";
import { QuickAdd } from "./QuickAdd";
import { CommandBar } from "./CommandBar";
import { Toasts } from "./Toasts";
import { Menu } from "lucide-react";
import clsx from "clsx";

export function Shell({ children }: { children: React.ReactNode }) {
  const { ready, load, selectedId, select, setCmdOpen, setQuickAddOpen, focusId, setFocus, completeTask, updateTask, deleteTask, tasks, cmdOpen, quickAddOpen } = useStore();
  const [nav, setNav] = useState(false);
  const router = useRouter();
  useEffect(() => { load(); }, [load]);

  // keyboard shortcuts
  useEffect(() => {
    let pendingG = false; let gTimer: ReturnType<typeof setTimeout>;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdOpen(!cmdOpen); return; }
      if (typing || cmdOpen || quickAddOpen) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = focusId ?? selectedId;
      const t = target ? tasks.find(x => x.id === target) : undefined;
      if (pendingG) { pendingG = false; const map: Record<string, string> = { t: "/today", u: "/upcoming", i: "/inbox", a: "/all", p: "/people", l: "/logbook", r: "/review", s: "/settings" }; if (map[e.key]) { e.preventDefault(); router.push(map[e.key]); } return; }
      switch (e.key) {
        case "n": e.preventDefault(); setQuickAddOpen(true); break;
        case "/": e.preventDefault(); setCmdOpen(true); break;
        case "g": pendingG = true; clearTimeout(gTimer); gTimer = setTimeout(() => { pendingG = false; }, 800); break;
        case "Escape": select(null); break;
        case "j": case "ArrowDown": { e.preventDefault(); const rows = [...document.querySelectorAll<HTMLElement>("[data-task]")]; const i = rows.findIndex(r => r.dataset.task === focusId); const next = rows[Math.min(rows.length - 1, i + 1)]; if (next) { setFocus(next.dataset.task!); next.scrollIntoView({ block: "nearest" }); if (selectedId) select(next.dataset.task!); } break; }
        case "k": case "ArrowUp": { e.preventDefault(); const rows = [...document.querySelectorAll<HTMLElement>("[data-task]")]; const i = rows.findIndex(r => r.dataset.task === focusId); const prev = rows[Math.max(0, i - 1)]; if (prev) { setFocus(prev.dataset.task!); prev.scrollIntoView({ block: "nearest" }); if (selectedId) select(prev.dataset.task!); } break; }
        case "Enter": if (t) { e.preventDefault(); select(t.id); } break;
        case "x": case " ": if (t) { e.preventDefault(); completeTask(t.id, isOpen(t.status)); } break;
        case "1": case "2": case "3": case "4": if (t) { e.preventDefault(); updateTask(t.id, { priority: Number(e.key) as 1|2|3|4 }); } break;
        case "t": if (t) { e.preventDefault(); const d = new Date(); d.setHours(23, 59, 0, 0); updateTask(t.id, { due_at: d.toISOString(), due_has_time: false }); } break;
        case "m": if (t) { e.preventDefault(); const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(23, 59, 0, 0); updateTask(t.id, { due_at: d.toISOString(), due_has_time: false }); } break;
        case "w": if (t) { e.preventDefault(); const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(23, 59, 0, 0); updateTask(t.id, { due_at: d.toISOString(), due_has_time: false }); } break;
        case "Backspace": case "Delete": if (t && selectedId === t.id) { e.preventDefault(); deleteTask(t.id); } break;
        case "?": e.preventDefault(); alert("Shortcuts\n\nN  new task\n⌘K or /  search & commands\nJ / K  move down / up\n↵  open task   Esc  close\nX or Space  complete\n1–4  priority\nT / M / W  due today / tomorrow / next week\n⌫  delete selected\nG then T/U/I/A/P/L  go to Today/Upcoming/Inbox/All/People/Logbook"); break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusId, selectedId, tasks, cmdOpen, quickAddOpen, router, select, setCmdOpen, setQuickAddOpen, setFocus, completeTask, updateTask, deleteTask]);

  return (
    <div className="h-dvh flex overflow-hidden">
      <div className={clsx("md:static fixed inset-y-0 left-0 z-40 transition-transform md:translate-x-0", nav ? "translate-x-0" : "-translate-x-full")}><Sidebar onClose={() => setNav(false)} /></div>
      {nav && <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setNav(false)} />}
      <main className="flex-1 min-w-0 h-full flex flex-col bg-bg relative">
        <button className="md:hidden absolute left-2 top-2.5 z-20 btn ghost sm px-1.5" onClick={() => setNav(true)} aria-label="Menu"><Menu size={16} /></button>
        <div className={clsx("flex-1 min-h-0 md:pl-0 pl-0", "[&>div>header]:pl-12 md:[&>div>header]:pl-4")}>
          {ready ? children : <div className="grid place-items-center h-full text-ink-3 text-[12px]">Loading…</div>}
        </div>
      </main>
      {selectedId && (
        <>
          <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => select(null)} />
          <div className="fixed md:static inset-y-0 right-0 z-40 w-[min(100vw,440px)] md:w-auto"><TaskDetail /></div>
        </>
      )}
      <QuickAdd />
      <CommandBar />
      <Toasts />
    </div>
  );
}
