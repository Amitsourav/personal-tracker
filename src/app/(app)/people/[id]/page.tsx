"use client";
import { use, useState, useEffect } from "react";
import { useStore, isOpen } from "@/lib/store";
import { Avatar } from "@/components/ui";
import { ListView, Empty } from "@/components/views/ListView";
import { STATUS_LABEL } from "@/lib/types";

export default function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { people, tasks, updatePerson, addTask } = useStore();
  const p = people.find(x => x.id === id);
  const [notes, setNotes] = useState("");
  useEffect(() => { setNotes(p?.notes ?? ""); }, [p?.id, p?.notes]);
  if (!p) return <Empty text="Person not found" />;
  const mine = tasks.filter(t => t.review_state === "accepted" && !t.parent_id);
  const owe = mine.filter(t => t.person_id === p.id && isOpen(t.status));
  const owed = mine.filter(t => t.waiting_on_person_id === p.id && isOpen(t.status));
  const done = mine.filter(t => (t.person_id === p.id || t.waiting_on_person_id === p.id) && !isOpen(t.status)).slice(0, 20);
  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-3 px-4 h-12 border-b border-line"><Avatar name={p.name} size={24} /><h1 className="font-semibold text-[15px]">{p.name}</h1><span className="text-[11px] text-ink-3">Trust: {p.trust_level === "auto_accept" ? "auto-accept tasks" : p.trust_level === "ignore" ? "ignored" : "review first"}</span>
        <select className="ml-auto field h-7 w-auto text-[12px]" value={p.trust_level} onChange={e => updatePerson(p.id, { trust_level: e.target.value })}><option value="review">Review their tasks first</option><option value="auto_accept">Auto-accept their tasks</option><option value="ignore">Ignore their messages</option></select>
      </header>
      <div className="flex-1 overflow-auto p-4 grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="grid gap-5 min-w-0">
          <section><h2 className="text-[12px] font-semibold text-ink-2 mb-1">I owe {p.name} <span className="text-ink-3 font-normal tnum">{owe.length}</span></h2>
            {owe.length ? <ListView groups={[{ key: "owe", label: "", tasks: owe }]} /> : <div className="text-ink-3 text-[12px]">Nothing pending.</div>}</section>
          <section><h2 className="text-[12px] font-semibold text-ink-2 mb-1">{p.name} owes me <span className="text-ink-3 font-normal tnum">{owed.length}</span></h2>
            {owed.length ? <ListView groups={[{ key: "owed", label: "", tasks: owed }]} /> : <div className="text-ink-3 text-[12px]">Nothing you&apos;re waiting on.</div>}
            <button className="btn sm mt-2" onClick={() => addTask({ title: `Follow up with ${p.name}`, waiting_on_person_id: p.id, status: "waiting" })}>+ Add something you&apos;re waiting on</button></section>
          {done.length > 0 && <section><h2 className="text-[12px] font-semibold text-ink-2 mb-1">Recently closed</h2><div className="grid gap-0.5 text-[12.5px]">{done.map(t => <div key={t.id} className="flex gap-2 h-7 items-center px-2 text-ink-3"><span className="strike text-ink-2 truncate">{t.title}</span><span className="ml-auto text-[11px]">{STATUS_LABEL[t.status]}</span></div>)}</div></section>}
        </div>
        <aside className="grid gap-3 content-start bg-panel border border-line rounded-lg p-3">
          <F label="Company" value={p.company} onSave={v => updatePerson(p.id, { company: v })} /><F label="Role" value={p.role} onSave={v => updatePerson(p.id, { role: v })} />
          <label className="grid gap-0.5 text-[11px] text-ink-3">Emails<input className="bg-transparent outline-none text-[13px] text-ink border-b border-transparent focus:border-line" placeholder="comma separated" defaultValue={p.emails.join(", ")} onBlur={e => updatePerson(p.id, { emails: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} /></label>
          <label className="grid gap-0.5 text-[11px] text-ink-3">Phones / WhatsApp<input className="bg-transparent outline-none text-[13px] text-ink border-b border-transparent focus:border-line" placeholder="+91…" defaultValue={p.phones.join(", ")} onBlur={e => updatePerson(p.id, { phones: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} /></label>
          <label className="grid gap-0.5 text-[11px] text-ink-3">Notes<textarea className="bg-panel-2 rounded p-2 outline-none text-[12.5px] text-ink min-h-[80px] resize-none" value={notes} onChange={e => setNotes(e.target.value)} onBlur={() => updatePerson(p.id, { notes: notes || null })} /></label>
        </aside>
      </div>
    </div>
  );
}

function F({ label, value, onSave }: { label: string; value: string | null; onSave: (v: string | null) => void }) {
  return <label className="grid gap-0.5 text-[11px] text-ink-3">{label}<input className="bg-transparent outline-none text-[13px] text-ink border-b border-transparent focus:border-line" placeholder="—" defaultValue={value ?? ""} onBlur={e => onSave(e.target.value || null)} /></label>;
}
