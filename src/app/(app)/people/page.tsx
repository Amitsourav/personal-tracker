"use client";
import Link from "next/link";
import { useState } from "react";
import { useStore, isOpen } from "@/lib/store";
import { Avatar } from "@/components/ui";
import { Plus } from "lucide-react";
import { isOverdue } from "@/lib/dates";
import { PageHeader, PageBody } from "@/components/PageHeader";

export default function People() {
  const { people, tasks, addPerson } = useStore();
  const [name, setName] = useState("");
  const open = tasks.filter(t => t.review_state === "accepted" && isOpen(t.status));
  return (
    <div className="h-full flex flex-col">
      <PageHeader title="People" count={people.length}
        actions={
          <form className="flex gap-1.5" onSubmit={async e => { e.preventDefault(); if (name.trim()) { await addPerson({ name: name.trim() }); setName(""); } }}>
            <input id="new-person" className="field h-7 w-[180px] text-[12px]" placeholder="Add person" value={name} onChange={e => setName(e.target.value)} />
            <button className="btn sm"><Plus size={13} /></button>
          </form>
        } />
      <PageBody wide>
        {!people.length ? <div className="text-ink-3 text-[12.5px] max-w-[52ch]">People appear here automatically when you write <b>from:Name</b> in quick add, or when tasks are captured from their messages. Each person gets a page showing what you owe them and what they owe you.</div> : (
          <div className="bg-panel-2 rounded-xl overflow-hidden max-w-[980px]">
            <div className="grid grid-cols-[1fr_110px_110px_110px] px-3 h-8 items-center border-b border-line text-[11px] font-semibold text-ink-3 uppercase tracking-wide"><span>Name</span><span>I owe them</span><span>They owe me</span><span>Overdue</span></div>
            {people.map(p => {
              const owe = open.filter(t => t.person_id === p.id); const owed = open.filter(t => t.waiting_on_person_id === p.id); const od = owe.filter(t => isOverdue(t)).length;
              return <Link key={p.id} href={`/people/${p.id}`} className="grid grid-cols-[1fr_110px_110px_110px] px-3 h-10 items-center border-b border-line-2 row-hover text-[13px]">
                <span className="flex items-center gap-2 min-w-0"><Avatar name={p.name} size={22} /><span className="truncate">{p.name}</span>{p.company && <span className="text-ink-3 text-[11.5px] truncate">· {p.company}</span>}</span>
                <span className="tnum">{owe.length}</span><span className="tnum">{owed.length}</span><span className={od ? "text-p1 font-semibold tnum" : "text-ink-3 tnum"}>{od || "—"}</span>
              </Link>;
            })}
          </div>
        )}
      </PageBody>
    </div>
  );
}
