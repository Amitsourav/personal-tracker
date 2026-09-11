"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useStore, isOpen } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { Avatar, PriorityFlag } from "@/components/ui";
import { fmtDue } from "@/lib/dates";
import type { Person, Task } from "@/lib/types";

type Attendee = { email?: string; name?: string; response?: string };
type Msg = { id: string; subject: string | null; sent_at: string; channel: string; link: string | null; person_id: string | null; is_outgoing: boolean };

/**
 * What to know before walking into a meeting.
 *
 * Matches the attendees to people already known, then shows what is open with
 * each of them and when they were last in touch. Computed locally: this is a
 * lookup, not a judgement, and it needs to be right rather than eloquent.
 */
export function MeetingPrep({ attendees, organizer }: { attendees: Attendee[]; organizer: string | null }) {
  const { people, tasks } = useStore();
  const [messages, setMessages] = useState<Msg[]>([]);
  const sb = createClient();

  // Everyone on the invite except Amit, matched against people he already has.
  const emails = [...new Set([...(attendees ?? []).map(a => a.email), organizer]
    .filter(Boolean).map(e => (e as string).toLowerCase()))];
  const matched = emails
    .map(e => people.find(p => p.emails.map(x => x.toLowerCase()).includes(e)))
    .filter((p): p is Person => !!p);
  const unknown = emails.filter(e => !people.some(p => p.emails.map(x => x.toLowerCase()).includes(e)));

  useEffect(() => {
    const ids = matched.map(p => p.id);
    if (!ids.length) { setMessages([]); return; }
    sb.from("messages")
      .select("id,subject,sent_at,channel,link,person_id,is_outgoing")
      .in("person_id", ids).order("sent_at", { ascending: false }).limit(6)
      .then(({ data }) => setMessages((data ?? []) as Msg[]));
  }, [matched.map(p => p.id).join(","), sb]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = tasks.filter(t => t.review_state === "accepted" && isOpen(t.status) && !t.parent_id);

  if (!matched.length && !unknown.length) {
    return <div className="text-[12px] text-ink-3 px-3 py-2">No attendees on this event.</div>;
  }

  return (
    <div className="px-3 py-2.5 grid gap-3 bg-panel-2 border-t border-line-2">
      {matched.map(p => {
        const owe = open.filter(t => t.person_id === p.id);
        const owed = open.filter(t => t.waiting_on_person_id === p.id);
        const last = messages.find(m => m.person_id === p.id);
        return (
          <div key={p.id} className="grid gap-1.5">
            <div className="flex items-center gap-2 text-[13px]">
              <Avatar name={p.name} size={18} />
              <Link href={`/people/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
              {p.company && <span className="text-ink-3 text-[11.5px]">· {p.company}</span>}
              {last && (
                <span className="text-ink-3 text-[11.5px] ml-auto">
                  last {last.is_outgoing ? "sent" : "heard"}{" "}
                  {new Date(last.sent_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </span>
              )}
            </div>

            {!owe.length && !owed.length ? (
              <div className="text-[12px] text-ink-3 pl-[26px]">Nothing open with them.</div>
            ) : (
              <div className="pl-[26px] grid gap-1">
                {owe.map(t => (
                  <Row key={t.id} task={t} tag="you owe" tone="text-warn" />
                ))}
                {owed.map(t => (
                  <Row key={t.id} task={t} tag="they owe" tone="text-accent" />
                ))}
              </div>
            )}

            {last?.subject && (
              <div className="pl-[26px] text-[11.5px] text-ink-3 truncate">
                Last thread: {last.link
                  ? <a className="text-accent" href={last.link} target="_blank" rel="noreferrer">{last.subject}</a>
                  : last.subject}
              </div>
            )}
          </div>
        );
      })}

      {unknown.length > 0 && (
        <div className="text-[11.5px] text-ink-3">
          Also invited, not in your people list: {unknown.slice(0, 4).join(", ")}
          {unknown.length > 4 && ` +${unknown.length - 4}`}
        </div>
      )}
    </div>
  );
}

function Row({ task, tag, tone }: { task: Task; tag: string; tone: string }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px] min-w-0">
      <PriorityFlag p={task.priority} />
      <span className="truncate">{task.title}</span>
      <span className={`text-[11px] ${tone} shrink-0`}>{tag}</span>
      {task.due_at && <span className="text-[11px] text-ink-3 shrink-0 ml-auto">{fmtDue(task.due_at, task.due_has_time)}</span>}
    </div>
  );
}
