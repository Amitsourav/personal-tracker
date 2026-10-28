"use client";
import { useEffect, useMemo, useState } from "react";
import { useStore, isOpen } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { initials } from "@/lib/team";
import type { TaskComment, TeamMember } from "@/lib/types";
import { format } from "date-fns";
import { Sunrise } from "lucide-react";
import clsx from "clsx";

type Activity = Pick<TaskComment, "task_id" | "author_id" | "kind" | "created_at">;

/**
 * The stand-up nobody has to attend: per person, what moved since the last
 * working day began, what is overdue, and who has gone quiet.
 *
 * "Since the last working day" rather than "yesterday", because on a Monday
 * yesterday was Sunday and the honest answer would always be "nothing".
 * Computed here from what is already stored — no model, no cost, always exact.
 */
export function TeamSummary() {
  const { team, tasks, profile } = useStore();
  const [rows, setRows] = useState<Activity[] | null>(null);
  const [now] = useState(() => new Date());

  const since = useMemo(() => {
    const work = profile?.work_days ?? [1, 2, 3, 4, 5, 6];
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    for (let i = 0; i < 7; i++) { d.setDate(d.getDate() - 1); if (work.includes(d.getDay())) break; }
    return d;
  }, [now, profile?.work_days]);
  const startToday = useMemo(() => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }, [now]);

  const memberIds = team.map(m => m.member_id).filter(Boolean) as string[];
  const key = memberIds.join(",");
  useEffect(() => {
    if (!memberIds.length) { setRows([]); return; }
    // The latest 500 things the team said or did is plenty to find each
    // person's last activity and everything since the last working day.
    createClient().from("task_comments").select("task_id, author_id, kind, created_at")
      .in("author_id", memberIds).order("created_at", { ascending: false }).limit(500)
      .then(({ data }) => setRows((data ?? []) as Activity[]));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!team.length || rows === null) return null;

  const lines = team.map(m => summarise(m, tasks.filter(t => t.assignee_id === m.id && t.review_state === "accepted"), rows, since, startToday, now));
  const anything = lines.some(l => l.finished || l.submitted || l.replies || l.moved || l.overdue || l.quiet);

  return (
    <section className="rounded-xl bg-panel-2 p-4 grid gap-2.5">
      <div className="flex items-center gap-1.5">
        <Sunrise size={14} className="text-p2" />
        <h2 className="font-semibold text-[13px]">Team summary</h2>
        <span className="text-[11.5px] text-ink-3">since {format(since, "EEEE")} morning</span>
      </div>
      {!anything && <div className="text-[12.5px] text-ink-3">Nothing moved and nothing is overdue.</div>}
      <div className="grid gap-1.5">
        {lines.map(l => (
          <div key={l.m.id} className="flex items-start gap-2.5 text-[12.5px]">
            <span className="w-6 h-6 rounded-full bg-p3-soft text-p3 grid place-items-center text-[10px] font-semibold flex-none">{initials(l.m.name)}</span>
            <div className="flex-1 min-w-0 pt-0.5">
              <span className="font-medium">{l.m.name.split(" ")[0]}</span>
              <span className="text-ink-2"> — {l.parts.length ? l.parts.join(", ") : "no activity"}</span>
              {l.overdue > 0 && <span className="text-p1 font-medium"> · {l.overdue} overdue</span>}
              {l.quiet && <span className={clsx("ml-1 pill", "bg-p2-soft text-p2")}>{l.quiet}</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function summarise(m: TeamMember, theirs: ReturnType<typeof useStore.getState>["tasks"], rows: Activity[], since: Date, startToday: Date, now: Date) {
  const mine = m.member_id ? rows.filter(r => r.author_id === m.member_id) : [];
  const recent = mine.filter(r => new Date(r.created_at) >= since);
  const finished = theirs.filter(t => t.status === "done" && t.completed_at && new Date(t.completed_at) >= since).length;
  const submitted = new Set(recent.filter(r => r.kind === "submitted").map(r => r.task_id)).size;
  const replies = recent.filter(r => r.kind === "comment").length;
  const moved = new Set(recent.filter(r => r.kind === "status").map(r => r.task_id)).size;
  const open = theirs.filter(t => isOpen(t.status));
  const overdue = open.filter(t => t.status !== "in_review" && t.due_at && new Date(t.due_at) < startToday).length;

  // Quiet only matters when they are holding something.
  let quiet: string | null = null;
  const waitingOnThem = open.filter(t => t.status !== "in_review");
  if (waitingOnThem.length) {
    if (!m.member_id) quiet = "hasn't signed in yet";
    else {
      const last = mine[0] ? new Date(mine[0].created_at) : (m.joined_at ? new Date(m.joined_at) : null);
      const days = last ? Math.floor((now.getTime() - last.getTime()) / 86_400_000) : null;
      if (days === null || days >= 2) quiet = days === null ? "no updates yet" : `no update in ${days} days`;
    }
  }

  const parts: string[] = [];
  if (finished) parts.push(`${finished} approved & closed`);
  if (submitted) parts.push(`sent ${submitted} for review`);
  if (moved) parts.push(`moved ${moved} task${moved === 1 ? "" : "s"}`);
  if (replies) parts.push(`${replies} repl${replies === 1 ? "y" : "ies"}`);
  if (!parts.length && open.length) parts.push(`${open.length} open`);
  return { m, finished, submitted, replies, moved, overdue, quiet, parts };
}
