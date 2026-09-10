"use client";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { parseQuickAdd } from "@/lib/quickadd";
import { Modal, PriorityFlag } from "./ui";
import { fmtDue } from "@/lib/dates";
import { PRIORITY_LABEL } from "@/lib/types";
import { CalendarDays, Hash, AtSign, User, Timer, Repeat } from "lucide-react";
import { usePathname } from "next/navigation";

export function QuickAdd() {
  const { quickAddOpen, setQuickAddOpen, projects, tags, people, addTask, addTag, addPerson, addProject, toast } = useStore();
  const path = usePathname();
  const [text, setText] = useState("");
  const [desc, setDesc] = useState("");
  const [showDesc, setShowDesc] = useState(false);
  const parsed = useMemo(() => parseQuickAdd(text, { projects, tags, people }), [text, projects, tags, people]);
  useEffect(() => { if (quickAddOpen) { setText(""); setDesc(""); setShowDesc(false); } }, [quickAddOpen]);

  const currentProject = path.startsWith("/project/") ? projects.find(p => p.id === path.split("/")[2]) : undefined;

  async function submit(keepOpen = false) {
    if (!parsed.title) return;
    let project = parsed.project ?? currentProject;
    if (!project && parsed.projectName) project = (await addProject({ name: parsed.projectName })) ?? undefined;
    let person = parsed.person;
    if (!person && parsed.personName) person = (await addPerson({ name: parsed.personName })) ?? undefined;
    const tagIds = [...parsed.tags.map(t => t.id)];
    for (const n of parsed.newTags) { const t = await addTag(n); if (t) tagIds.push(t.id); }
    const task = await addTask({
      title: parsed.title, description: desc || null, priority: parsed.priority, due_at: parsed.due_at, due_has_time: parsed.due_has_time,
      project_id: project?.id ?? null, person_id: person?.id ?? null, duration_min: parsed.duration_min, recurrence: parsed.recurrence,
      recurrence_anchor: parsed.recurrence ? (parsed.due_at ?? new Date().toISOString()) : null,
      status: path === "/inbox" ? "inbox" : "todo",
    }, tagIds);
    if (task) toast(`Added “${task.title}”`);
    setText(""); setDesc("");
    if (!keepOpen) setQuickAddOpen(false);
  }

  const chips = [
    parsed.due_at && { icon: CalendarDays, text: fmtDue(parsed.due_at, parsed.due_has_time) },
    parsed.priority !== 4 && { icon: () => <PriorityFlag p={parsed.priority} />, text: PRIORITY_LABEL[parsed.priority] },
    (parsed.project ?? currentProject ?? parsed.projectName) && { icon: Hash, text: parsed.project?.name ?? currentProject?.name ?? `${parsed.projectName} (new)` },
    ...parsed.tags.map(t => ({ icon: AtSign, text: t.name })), ...parsed.newTags.map(t => ({ icon: AtSign, text: `${t} (new)` })),
    (parsed.person ?? parsed.personName) && { icon: User, text: parsed.person?.name ?? `${parsed.personName} (new)` },
    parsed.duration_min && { icon: Timer, text: `${parsed.duration_min} min` },
    parsed.recurrence && { icon: Repeat, text: parsed.recurrence.replace("FREQ=", "").toLowerCase() },
  ].filter(Boolean) as { icon: React.ComponentType<{ size?: number }>; text: string }[];

  return (
    <Modal open={quickAddOpen} onClose={() => setQuickAddOpen(false)} width={640}>
      <form onSubmit={e => { e.preventDefault(); submit(e.nativeEvent instanceof KeyboardEvent ? false : false); }} className="p-3">
        <input id="quick-add" autoFocus className="w-full text-[15px] h-9 px-1 bg-transparent outline-none" placeholder="Task name — e.g. “Send Q3 deck to Rohit kal tak p1 #clientX @deck ~45m”"
          value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submit(e.metaKey || e.ctrlKey || e.shiftKey); } if (e.key === "Tab" && !showDesc) { e.preventDefault(); setShowDesc(true); } }} />
        {showDesc && <textarea id="quick-add-desc" className="w-full mt-1 px-1 py-1 bg-transparent outline-none text-[13px] text-ink-2 resize-none" rows={2} placeholder="Notes" value={desc} onChange={e => setDesc(e.target.value)} />}
        <div className="flex flex-wrap items-center gap-1.5 mt-1 min-h-[22px]">
          {chips.length ? chips.map((c, i) => <span key={i} className="pill bg-accent-soft text-accent"><c.icon size={11} /> {c.text}</span>)
            : <span className="text-[11.5px] text-ink-3">Try: <b>tomorrow 5pm</b>, <b>kal tak</b>, <b>every monday</b>, <b>p1</b>, <b>#project</b>, <b>@tag</b>, <b>from:Name</b>, <b>~30m</b></span>}
        </div>
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line">
          {!showDesc && <button type="button" className="btn ghost sm" onClick={() => setShowDesc(true)}>Add notes <kbd>Tab</kbd></button>}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-ink-3"><kbd>⇧↵</kbd> add another</span>
            <button type="button" className="btn sm" onClick={() => setQuickAddOpen(false)}>Cancel</button>
            <button type="submit" className="btn primary sm" disabled={!parsed.title}>Add task <kbd className="!bg-transparent !border-white/30 !text-inherit">↵</kbd></button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
