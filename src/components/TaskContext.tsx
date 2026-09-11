"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, ExternalLink, Mail, MessageSquare } from "lucide-react";
import type { Task } from "@/lib/types";

type Msg = {
  id: string; channel: string; external_id: string; thread_id: string | null;
  sender_name: string | null; sender_handle: string | null; is_outgoing: boolean;
  subject: string | null; body: string | null; sent_at: string; link: string | null;
};

/**
 * The conversation a task came out of.
 *
 * A task like "send the revised pricing sheet" is a summary; what was actually
 * said around it lives in a thread the user would otherwise have to go hunting
 * for in Gmail or WhatsApp. Message bodies are purged after 30 days, so this
 * shows what is still held rather than pretending to be a full archive.
 */
export function TaskContext({ task }: { task: Task }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = createClient();
      setMsgs(null);
      if (!task.source_ref && !task.person_id) { setMsgs([]); return; }

      // The message this task came from, which also tells us which thread to pull.
      const { data: src } = task.source_ref
        ? await sb.from("messages").select("*").eq("external_id", task.source_ref).maybeSingle()
        : { data: null };

      const seen = new Map<string, Msg>();
      if (src) seen.set(src.id, src as Msg);

      // Same thread first: it is the conversation, not merely the same person.
      if (src?.thread_id) {
        const { data } = await sb.from("messages").select("*")
          .eq("thread_id", src.thread_id).order("sent_at", { ascending: false }).limit(10);
        for (const m of data ?? []) seen.set(m.id, m as Msg);
      }
      // Then anything else recent with the same person, for surrounding context.
      if (task.person_id) {
        const { data } = await sb.from("messages").select("*")
          .eq("person_id", task.person_id).order("sent_at", { ascending: false }).limit(6);
        for (const m of data ?? []) seen.set(m.id, m as Msg);
      }

      if (!cancelled) {
        setMsgs([...seen.values()].sort((a, b) => b.sent_at.localeCompare(a.sent_at)).slice(0, 12));
      }
    })();
    return () => { cancelled = true; };
  }, [task.id, task.source_ref, task.person_id]);

  if (msgs === null) return <Shell><span className="text-ink-3">Loading context…</span></Shell>;
  if (!msgs.length) return null;

  return (
    <Shell count={msgs.length}>
      <div className="grid gap-1">
        {msgs.map(m => {
          const isSource = m.external_id === task.source_ref;
          const expanded = open === m.id;
          return (
            <div key={m.id} className={`rounded border ${isSource ? "border-accent/40 bg-accent-soft/30" : "border-line-2"}`}>
              <button className="w-full flex items-start gap-1.5 px-2 py-1.5 text-left"
                onClick={() => setOpen(expanded ? null : m.id)}>
                {expanded ? <ChevronDown size={12} className="text-ink-3 mt-0.5 flex-none" /> : <ChevronRight size={12} className="text-ink-3 mt-0.5 flex-none" />}
                {m.channel === "whatsapp" ? <MessageSquare size={11} className="text-ink-3 mt-0.5 flex-none" /> : <Mail size={11} className="text-ink-3 mt-0.5 flex-none" />}
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-ink-2">
                      {m.is_outgoing ? "You" : (m.sender_name || m.sender_handle || "Unknown")}
                    </span>
                    {isSource && <span className="pill text-[10px] bg-accent-soft text-accent shrink-0">this task</span>}
                    <span className="text-ink-3 text-[11px] ml-auto shrink-0">{format(new Date(m.sent_at), "d MMM")}</span>
                  </span>
                  {m.subject && <span className="block truncate text-ink-3 text-[11px]">{m.subject}</span>}
                </span>
              </button>
              {expanded && (
                <div className="px-2 pb-2 pl-[38px] grid gap-1.5">
                  {m.body ? (
                    <p className="text-[12px] text-ink-2 whitespace-pre-wrap leading-relaxed max-h-[220px] overflow-auto">{m.body}</p>
                  ) : (
                    <p className="text-[11.5px] text-ink-3 italic">
                      Body no longer stored — message text is deleted after 30 days.
                    </p>
                  )}
                  {m.link && (
                    <a className="text-[11px] text-accent flex items-center gap-1 w-fit" href={m.link} target="_blank" rel="noreferrer">
                      Open original <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

function Shell({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-ink-3 uppercase tracking-wide mb-1 flex items-center gap-1">
        Context {count ? <span className="tnum font-normal">{count}</span> : null}
      </div>
      <div className="text-[12px]">{children}</div>
    </div>
  );
}
