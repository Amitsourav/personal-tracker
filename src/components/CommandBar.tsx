"use client";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useStore, isOpen } from "@/lib/store";
import { Modal, PriorityFlag } from "./ui";
import { Sun, CalendarDays, Inbox, Layers, Users, CheckCircle2, Settings, Plus, Sparkles, LayoutList, Moon } from "lucide-react";
import { fmtDue } from "@/lib/dates";

export function CommandBar() {
  const router = useRouter();
  const { cmdOpen, setCmdOpen, setQuickAddOpen, tasks, projects, select, completeTask, selectedId, focusId } = useStore();
  const go = (href: string) => { router.push(href); setCmdOpen(false); };
  const target = selectedId ?? focusId;
  const open = tasks.filter(t => t.review_state === "accepted" && isOpen(t.status));
  return (
    <Modal open={cmdOpen} onClose={() => setCmdOpen(false)} width={600}>
      <Command label="Commands" className="p-1">
        <Command.Input id="cmdk-input" autoFocus placeholder="Search tasks, jump to a view, run a command…" className="w-full h-10 px-3 bg-transparent outline-none text-[14px] border-b border-line" />
        <Command.List className="p-1">
          <Command.Empty className="p-4 text-ink-3 text-center">Nothing found.</Command.Empty>
          <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-ink-3 [&_[cmdk-group-heading]]:font-semibold">
            <Command.Item className="menu-item" onSelect={() => { setCmdOpen(false); setQuickAddOpen(true); }}><Plus size={14}/> New task <span className="ml-auto"><kbd>N</kbd></span></Command.Item>
            {target && <Command.Item className="menu-item" onSelect={() => { completeTask(target); setCmdOpen(false); }}><CheckCircle2 size={14}/> Complete selected task <span className="ml-auto"><kbd>X</kbd></span></Command.Item>}
            <Command.Item className="menu-item" onSelect={() => { const cur = document.documentElement.getAttribute("data-theme"); const next = cur === "dark" ? "light" : "dark"; document.documentElement.setAttribute("data-theme", next); try { localStorage.setItem("theme", next); } catch {} setCmdOpen(false); }}><Moon size={14}/> Toggle dark mode</Command.Item>
          </Command.Group>
          <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-ink-3 [&_[cmdk-group-heading]]:font-semibold">
            <Command.Item className="menu-item" onSelect={() => go("/today")}><Sun size={14}/> Today <span className="ml-auto"><kbd>G T</kbd></span></Command.Item>
            <Command.Item className="menu-item" onSelect={() => go("/upcoming")}><CalendarDays size={14}/> Upcoming <span className="ml-auto"><kbd>G U</kbd></span></Command.Item>
            <Command.Item className="menu-item" onSelect={() => go("/inbox")}><Inbox size={14}/> Inbox <span className="ml-auto"><kbd>G I</kbd></span></Command.Item>
            <Command.Item className="menu-item" onSelect={() => go("/review")}><Sparkles size={14}/> Review</Command.Item>
            <Command.Item className="menu-item" onSelect={() => go("/all")}><Layers size={14}/> All tasks <span className="ml-auto"><kbd>G A</kbd></span></Command.Item>
            <Command.Item className="menu-item" onSelect={() => go("/people")}><Users size={14}/> People</Command.Item>
            <Command.Item className="menu-item" onSelect={() => go("/logbook")}><CheckCircle2 size={14}/> Logbook</Command.Item>
            <Command.Item className="menu-item" onSelect={() => go("/settings")}><Settings size={14}/> Settings</Command.Item>
            {projects.map(p => <Command.Item key={p.id} className="menu-item" value={`project ${p.name}`} onSelect={() => go(`/project/${p.id}`)}><span className="w-[9px] h-[9px] rounded-[3px]" style={{ background: p.color }} /> {p.name}</Command.Item>)}
          </Command.Group>
          <Command.Group heading="Tasks" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-ink-3 [&_[cmdk-group-heading]]:font-semibold">
            {open.slice(0, 200).map(t => (
              <Command.Item key={t.id} className="menu-item" value={`task ${t.title}`} onSelect={() => { select(t.id); setCmdOpen(false); }}>
                <PriorityFlag p={t.priority} /> <span className="truncate">{t.title}</span>
                {t.due_at && <span className="ml-auto text-ink-3 text-[11px]">{fmtDue(t.due_at, t.due_has_time)}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </Modal>
  );
}
export { LayoutList };
