"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { PageHeader, PageBody } from "@/components/PageHeader";
import { Empty } from "@/components/views/ListView";
import { formatDistanceToNow } from "date-fns";
import {
  Info, Handshake, HelpCircle, GitBranch, CalendarClock,
  TriangleAlert, Sparkles, Check, ExternalLink, MessageSquare, Mail,
} from "lucide-react";

type Signal = {
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
const TYPES: Record<string, { label: string; blurb: string; icon: typeof Info; tone: string }> = {
  decision:    { label: "Decisions", blurb: "a choice is waiting on someone", icon: GitBranch, tone: "text-accent" },
  risk:        { label: "Risks", blurb: "could go wrong", icon: TriangleAlert, tone: "text-danger" },
  request:     { label: "Requests", blurb: "expected of you, not yet a task", icon: HelpCircle, tone: "text-warn" },
  commitment:  { label: "They promised", blurb: "someone owes you this", icon: Handshake, tone: "text-ok" },
  opportunity: { label: "Opportunities", blurb: "possible upside", icon: Sparkles, tone: "text-accent" },
  event:       { label: "Events", blurb: "something happened or is scheduled", icon: CalendarClock, tone: "text-ink-2" },
  information: { label: "Worth knowing", blurb: "no action needed", icon: Info, tone: "text-ink-3" },
};
const ORDER = ["decision", "risk", "request", "commitment", "opportunity", "event", "information"];

export default function Signals() {
  const { toast } = useStore();
  const [rows, setRows] = useState<Signal[] | null>(null);
  const sb = createClient();

  const load = useCallback(async () => {
    const { data } = await sb.from("messages")
      .select("id,intake_type,intake_summary,sender_name,sender_handle,subject,sent_at,channel,link")
      .not("intake_type", "is", null).neq("intake_type", "noise").neq("intake_type", "task")
      .is("intake_seen_at", null)
      .order("sent_at", { ascending: false }).limit(80);
    setRows((data ?? []) as Signal[]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const dismiss = async (ids: string[]) => {
    setRows(r => (r ?? []).filter(x => !ids.includes(x.id)));
    await sb.from("messages").update({ intake_seen_at: new Date().toISOString() }).in("id", ids);
  };

  if (rows === null) return null;

  const groups = ORDER
    .map(t => ({ type: t, ...TYPES[t], items: rows.filter(r => r.intake_type === t) }))
    .filter(g => g.items.length);

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Signals" count={rows.length}
        hint="Things the AI understood that aren't tasks"
        actions={rows.length ? (
          <button className="btn sm" onClick={() => dismiss(rows.map(r => r.id))}>
            <Check size={13} /> Clear all
          </button>
        ) : undefined} />

      <PageBody className="grid gap-6">
        {!groups.length ? (
          <Empty text="Nothing else to report"
            sub="When a message contains something worth knowing that isn't a task — a decision, a date that moved, a risk — it appears here instead of being thrown away." />
        ) : groups.map(g => (
          <section key={g.type}>
            <h2 className="text-[12px] font-semibold text-ink-2 mb-1.5 flex items-center gap-1.5">
              <g.icon size={13} className={g.tone} />
              {g.label} <span className="text-ink-3 font-normal tnum">{g.items.length}</span>
              <span className="text-ink-3 font-normal text-[11px] hidden sm:inline">· {g.blurb}</span>
            </h2>
            <div className="bg-panel-2 rounded-xl overflow-hidden">
              {g.items.map(s => (
                <div key={s.id} className="grid grid-cols-[1fr_auto] gap-3 items-start px-3 py-2.5 border-b border-line-2 last:border-0">
                  <div className="min-w-0">
                    <div className="text-[13px]">{s.intake_summary ?? s.subject ?? "(no summary)"}</div>
                    <div className="flex items-center gap-2 text-[11.5px] text-ink-3 mt-0.5 min-w-0">
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
                  <button className="btn ghost sm shrink-0" title="Got it"
                    onClick={() => { dismiss([s.id]); toast("Cleared"); }}>
                    <Check size={13} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </PageBody>
    </div>
  );
}
