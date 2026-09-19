"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import type { Task } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import {
  Info, Handshake, HelpCircle, GitBranch, CalendarClock,
  TriangleAlert, Sparkles, Check, ExternalLink, MessageSquare, Mail, Plus,
} from "lucide-react";

export type Signal = {
  id: string; intake_type: string; intake_summary: string | null;
  sender_name: string | null; sender_handle: string | null; subject: string | null;
  sent_at: string; channel: string; link: string | null;
};

/**
 * Everything the system understood that was not a task.
 *
 * The blueprint's universal intake says only ONE of nine types becomes a task,
 * and its exclusion list rejects "a system that turns every message into a
 * task". Until now anything that was not a task was discarded, so a decision
 * someone needed, a date that moved, or a number worth remembering simply
 * vanished. This is where the other eight go.
 *
 * Noise is classified and then never shown — kept only so it is auditable what
 * the filter threw away.
 */
export const SIGNAL_TYPES: Record<string, { label: string; blurb: string; icon: typeof Info; tone: string }> = {
  decision:    { label: "Decisions", blurb: "a choice is waiting on someone", icon: GitBranch, tone: "text-accent" },
  risk:        { label: "Risks", blurb: "could go wrong", icon: TriangleAlert, tone: "text-danger" },
  request:     { label: "Requests", blurb: "expected of you, not yet a task", icon: HelpCircle, tone: "text-warn" },
  commitment:  { label: "They promised", blurb: "someone owes you this", icon: Handshake, tone: "text-ok" },
  opportunity: { label: "Opportunities", blurb: "possible upside", icon: Sparkles, tone: "text-accent" },
  event:       { label: "Events", blurb: "something happened or is scheduled", icon: CalendarClock, tone: "text-ink-2" },
  information: { label: "Worth knowing", blurb: "no action needed", icon: Info, tone: "text-ink-3" },
};
export const SIGNAL_ORDER = ["decision", "risk", "request", "commitment", "opportunity", "event", "information"];

const SELECT = "id,intake_type,intake_summary,sender_name,sender_handle,subject,sent_at,channel,link";

/**
 * Signals live in `messages`, which — unlike tasks — is not in the zustand
 * store and has no Realtime channel. Two places now show them (Review and the
 * Signals page) plus the sidebar's count, so dismissing one somewhere has to
 * reach the others. A window event is enough for that and costs nothing;
 * widening Realtime to `messages` would stream every incoming email body to
 * the browser to keep one number honest.
 */
const CHANGED = "signals:changed";
const announce = () => window.dispatchEvent(new Event(CHANGED));

function query() {
  return createClient().from("messages").select(SELECT)
    .not("intake_type", "is", null).neq("intake_type", "noise").neq("intake_type", "task")
    .is("intake_seen_at", null)
    .order("sent_at", { ascending: false }).limit(80);
}

/** Ordered most-urgent type first, then newest — the order Review shows them in. */
export function sortSignals(rows: Signal[]): Signal[] {
  return [...rows].sort((a, b) => {
    const rank = SIGNAL_ORDER.indexOf(a.intake_type) - SIGNAL_ORDER.indexOf(b.intake_type);
    return rank !== 0 ? rank : b.sent_at.localeCompare(a.sent_at);
  });
}

export function useSignals() {
  const { toast, addTask, people } = useStore();
  const [rows, setRows] = useState<Signal[] | null>(null);

  const load = useCallback(async () => {
    const { data } = await query();
    setRows((data ?? []) as Signal[]);
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, [load]);

  const dismiss = useCallback(async (ids: string[]) => {
    setRows(r => (r ?? []).filter(x => !ids.includes(x.id)));
    await createClient().from("messages").update({ intake_seen_at: new Date().toISOString() }).in("id", ids);
    announce();
  }, []);

  /**
   * Some signals turn out to be work after all — a risk you decide to act on, a
   * decision you have to go and make. Retyping them by hand was the only way,
   * which meant losing the quote and the sender, the two things that make a task
   * make sense a week later. This carries both across.
   */
  const makeTask = useCallback(async (s: Signal) => {
    const from = s.sender_name || s.sender_handle || null;
    const person = from ? people.find(p => p.name.toLowerCase() === from.toLowerCase()) : undefined;
    await addTask({
      title: (s.intake_summary ?? s.subject ?? "Follow up").slice(0, 200),
      description: from ? `From ${from}${s.subject && s.subject !== s.intake_summary ? ` · ${s.subject}` : ""}` : null,
      // Straight to the list, not Review: Amit pressed the button, so there is
      // nothing left for him to approve.
      status: "todo", priority: s.intake_type === "risk" || s.intake_type === "decision" ? 2 : 3,
      person_id: person?.id ?? null,
      source_kind: s.channel === "whatsapp" ? "whatsapp" : "gmail",
      source_ref: s.id, source_link: s.link,
      source_quote: (s.intake_summary ?? "").slice(0, 300),
      ai_meta: { kind: "signal", signal_type: s.intake_type, subject: s.subject, channel: s.channel },
    } as Partial<Task> & { title: string });
    await dismiss([s.id]);
    toast("Added to your tasks");
  }, [people, addTask, dismiss, toast]);

  return { rows, load, dismiss, makeTask };
}

/** Just the number, for the sidebar badge. */
export function useSignalCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const load = async () => {
      const { data } = await query();
      setN((data ?? []).length);
    };
    load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, []);
  return n;
}

/**
 * One signal. `showType` is for Review, where they are listed flat and the
 * label is the only thing saying whether this is a risk or a stray fact; the
 * Signals page groups by type and puts it in the heading instead.
 */
export function SignalRow({ s, showType, onMakeTask, onDismiss }: {
  s: Signal; showType?: boolean;
  onMakeTask: (s: Signal) => void; onDismiss: (ids: string[]) => void;
}) {
  const type = SIGNAL_TYPES[s.intake_type];
  const Icon = type?.icon ?? Info;
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 items-start px-3 py-2.5 border-b border-line-2 last:border-0">
      <div className="min-w-0">
        <div className="text-[13px] flex items-start gap-1.5">
          {showType && <Icon size={13} className={`${type?.tone ?? "text-ink-3"} mt-[3px] flex-none`} />}
          <span>{s.intake_summary ?? s.subject ?? "(no summary)"}</span>
        </div>
        <div className="flex items-center gap-2 text-[11.5px] text-ink-3 mt-0.5 min-w-0">
          {showType && type && <span className="pill flex-none">{type.label}</span>}
          {s.channel === "whatsapp" ? <MessageSquare size={11} className="flex-none" /> : <Mail size={11} className="flex-none" />}
          <span className="truncate">{s.sender_name || s.sender_handle || "unknown"}</span>
          <span className="flex-none">· {formatDistanceToNow(new Date(s.sent_at), { addSuffix: true })}</span>
          {s.link && (
            <a className="text-accent flex items-center gap-0.5 flex-none" href={s.link} target="_blank" rel="noreferrer">
              open <ExternalLink size={9} />
            </a>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button className="btn ghost sm px-2" title="Make this a task" onClick={() => onMakeTask(s)}>
          <Plus size={13} />
        </button>
        <button className="btn ghost sm px-2" title="Got it" onClick={() => onDismiss([s.id])}>
          <Check size={13} />
        </button>
      </div>
    </div>
  );
}
