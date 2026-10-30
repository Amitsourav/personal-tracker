"use client";
import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { useStore } from "@/lib/store";
import { initials } from "@/lib/team";
import { Workspace } from "@/components/Workspace";
import { ArrowLeft } from "lucide-react";

/**
 * Everything handed out, as one board: To do → In progress → Waiting →
 * In review. The person chips narrow it to one employee without opening a
 * filter menu, because "what is Ravi holding" is the question asked most.
 */
export default function TeamBoard() {
  const { team } = useStore();
  const [who, setWho] = useState<string | null>(null);
  const member = team.find(m => m.id === who);
  return (
    <Workspace
      scopeKey="team-board"
      title="Team board"
      subtitle={member ? `${member.name}'s tasks` : "Everything you've assigned"}
      baseFilter={who ? { assigned: true, assignee_id: [who] } : { assigned: true }}
      defaultLayout="board"
      defaultGroup="status"
      defaultsForNew={who ? { assignee_id: who } : undefined}
      allowSaveView={false}
      includeSubtasks
      headerExtra={
        <div className="hidden sm:flex items-center gap-1 ml-2 min-w-0 overflow-x-auto">
          <Link href="/team" className="btn ghost sm text-ink-3" title="Back to Team"><ArrowLeft size={13} /></Link>
          <button className={clsx("pill", !who ? "bg-selected text-ink font-medium" : "text-ink-3 hover:bg-hover")} onClick={() => setWho(null)}>Everyone</button>
          {team.map(m => (
            <button key={m.id} className={clsx("pill flex-none", who === m.id ? "bg-selected text-ink font-medium" : "text-ink-3 hover:bg-hover")} onClick={() => setWho(who === m.id ? null : m.id)}>
              <span className="w-4 h-4 rounded-full bg-p3-soft text-p3 grid place-items-center text-[8.5px] font-semibold">{initials(m.name)}</span>{m.name.split(" ")[0]}
            </button>
          ))}
        </div>
      }
    />
  );
}
