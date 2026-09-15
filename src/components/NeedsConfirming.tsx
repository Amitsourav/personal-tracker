"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui";
import { formatDistanceToNow } from "date-fns";
import { CircleCheck, ShieldQuestion, Send, Copy, X } from "lucide-react";
import type { Task } from "@/lib/types";

/**
 * Work Amit says he finished, that nobody has acknowledged.
 *
 * The blueprint's sharpest line: completion is not success. Ticking a box
 * records a claim; it does not record that the person who asked received
 * anything. This surfaces the gap between the two.
 *
 * Evidence is weak by design — a reply arriving after completion is a hint, not
 * proof, so it is shown as "they replied since" rather than treated as
 * confirmation. Only Amit, or an explicit acknowledgement, closes it.
 */
export function NeedsConfirming() {
  const { tasks, people, updateTask, toast } = useStore();
  const [repliedSince, setRepliedSince] = useState<Record<string, string>>({});
  // Drafting "it's done" is the step that closes the loop, and the one nobody
  // does — which is why people chase work that was finished last week.
  const [draft, setDraft] = useState<{ id: string; text: string; channel: string } | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);

  const pending = tasks.filter(t =>
    t.verification === "self" && t.status === "done" && !t.deleted_at && t.person_id);

  const key = pending.map(t => t.id).join(",");
  useEffect(() => {
    if (!pending.length) { setRepliedSince({}); return; }
    const sb = createClient();
    const earliest = pending.map(t => t.completed_at).filter(Boolean).sort()[0]!;
    sb.from("messages")
      .select("person_id,sent_at")
      .eq("is_outgoing", false).gt("sent_at", earliest)
      .order("sent_at", { ascending: false })
      .then(({ data }) => {
        const byPerson: Record<string, string> = {};
        for (const m of data ?? []) if (m.person_id && !byPerson[m.person_id]) byPerson[m.person_id] = m.sent_at;
        const out: Record<string, string> = {};
        for (const t of pending) {
          const last = t.person_id ? byPerson[t.person_id] : undefined;
          if (last && t.completed_at && last > t.completed_at) out[t.id] = last;
        }
        setRepliedSince(out);
      });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pending.length) return null;

  const confirm = async (t: Task) => {
    await updateTask(t.id, {
      verification: "confirmed", verified_at: new Date().toISOString(),
      verification_note: "Confirmed by you",
    });
    toast("Confirmed — they have it");
  };

  const tellThem = async (t: Task) => {
    setDrafting(t.id);
    const res = await fetch("/api/ai/draft", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: t.id, kind: "done" }),
    });
    const j = await res.json();
    setDrafting(null);
    if (!res.ok) return toast(j.error ?? "Could not write it");
    setDraft({ id: t.id, text: j.text, channel: j.channel });
  };

  const reopen = async (t: Task) => {
    await updateTask(t.id, { status: "todo", completed_at: null, verification: "none", verified_at: null });
    toast("Reopened");
  };

  return (
    <section className="grid gap-2">
      <h2 className="text-[12px] font-semibold text-ink-2 flex items-center gap-1.5">
        <ShieldQuestion size={13} className="text-warn" />
        Done, but not confirmed <span className="text-ink-3 font-normal tnum">{pending.length}</span>
        <span className="text-ink-3 font-normal text-[11px] hidden sm:inline">
          · you finished these — did they land?
        </span>
      </h2>
      <div className="bg-panel-2 rounded-xl overflow-hidden">
        {pending.map(t => {
          const p = people.find(x => x.id === t.person_id);
          const replied = repliedSince[t.id];
          return (
            <div key={t.id} className="grid grid-cols-[1fr_auto] gap-3 items-center px-3 py-2.5 border-b border-line-2 last:border-0">
              <div className="min-w-0">
                <div className="text-[13px] truncate">{t.title}</div>
                <div className="flex items-center gap-2 text-[11.5px] text-ink-3 mt-0.5">
                  {p && <Link href={`/people/${p.id}`} className="flex items-center gap-1 hover:text-ink">
                    <Avatar name={p.name} size={14} />{p.name}
                  </Link>}
                  {t.completed_at && <span>done {formatDistanceToNow(new Date(t.completed_at), { addSuffix: true })}</span>}
                  {replied ? (
                    <span className="text-ok">· they replied since</span>
                  ) : (
                    <span>· nothing heard back</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button className="btn sm" onClick={() => tellThem(t)} disabled={drafting === t.id}
                  title="Write them a message saying it is done">
                  <Send size={12} /> {drafting === t.id ? "Writing…" : "Tell them"}
                </button>
                <button className="btn sm" onClick={() => confirm(t)} title="They have it — close this out">
                  <CircleCheck size={12} /> Confirm
                </button>
                <button className="btn ghost sm text-[11.5px]" onClick={() => reopen(t)} title="It did not actually land">
                  Reopen
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {draft && (() => {
        const t = pending.find(x => x.id === draft.id);
        return (
          <div className="rounded-xl bg-panel-2 p-3 grid gap-2">
            <div className="text-[11.5px] text-ink-3">
              {draft.channel === "whatsapp" ? "WhatsApp" : "Email"} to {people.find(p => p.id === t?.person_id)?.name ?? "them"} — check it, then send it yourself
            </div>
            <textarea className="field h-auto py-2 text-[12.5px] leading-relaxed" rows={3}
              value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} />
            <div className="flex items-center gap-1.5">
              <button className="btn sm" onClick={async () => {
                try { await navigator.clipboard.writeText(draft.text); toast("Copied — send it, then Confirm"); }
                catch { toast("Could not copy"); }
              }}><Copy size={12} /> Copy</button>
              {/* Confirming here would record that they received it, which pressing
                  Copy does not establish. It stays a separate, deliberate act. */}
              <button className="btn ghost sm text-[11.5px]" onClick={() => setDraft(null)}><X size={12} /> Close</button>
            </div>
          </div>
        );
      })()}
    </section>
  );
}
