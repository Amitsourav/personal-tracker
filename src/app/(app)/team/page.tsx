"use client";
import { useEffect, useMemo, useState } from "react";
import { useStore, isOpen } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { teamEmail, initials, useTeamUnseen } from "@/lib/team";
import { PageHeader, PageBody } from "@/components/PageHeader";
import { STATUS_LABEL, type Task, type TeamMember } from "@/lib/types";
import { Popover } from "@/components/ui";
import { formatDistanceToNow, format } from "date-fns";
import { AlertTriangle, MoreHorizontal, UserPlus, Eye, MessageSquare, Kanban, BellRing } from "lucide-react";
import Link from "next/link";
import { TeamSummary } from "@/components/TeamSummary";
import clsx from "clsx";

const SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/**
 * Everyone Amit hands work to, and what each of them is holding.
 *
 * "Needs you" sits at the top because it is the only part that is waiting on
 * him: work sent back for review, and replies he has not opened.
 */
export default function TeamPage() {
  const { team, tasks, addMember, select, toast } = useStore();
  const unseen = useTeamUnseen();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [canSend, setCanSend] = useState<boolean | null>(null);
  const [reminders, setReminders] = useState<boolean | null>(null);

  useEffect(() => {
    createClient().from("user_secrets").select("*").maybeSingle()
      .then(({ data }) => {
        setCanSend(!!data?.google_refresh_token && (data.google_scopes ?? []).includes(SEND_SCOPE));
        // Absent until the reminders migration runs; the switch stays hidden till then.
        setReminders(data?.team_reminders_enabled ?? null);
      });
  }, []);
  async function toggleReminders() {
    const next = !reminders;
    setReminders(next);
    const { error } = await createClient().from("user_secrets").update({ team_reminders_enabled: next }).eq("user_id", useStore.getState().userId!);
    if (error) { setReminders(!next); toast("Couldn't change reminders: " + error.message); return; }
    toast(next ? "Automatic reminders on" : "Automatic reminders off");
  }

  const assigned = useMemo(() => tasks.filter(t => t.assignee_id && t.review_state === "accepted"), [tasks]);
  const unseenTasks = new Set(unseen.map(u => u.task_id));
  const needsYou = assigned.filter(t => t.status === "in_review" || unseenTasks.has(t.id));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !/\S+@\S+\.\S+/.test(email)) { toast("Add a name and a valid email"); return; }
    setAdding(true);
    const m = await addMember(name, email);
    if (m) {
      setName(""); setEmail("");
      const { ok } = await teamEmail("invite", { memberId: m.id });
      toast(ok ? `Invite emailed to ${m.email}` : `${m.name} added`);
    }
    setAdding(false);
  }

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Team" count={team.length} hint="People you hand work to. They see only the tasks you assign them."
        actions={<>
          {reminders !== null && team.length > 0 && (
            <button className={clsx("btn sm", reminders && "text-accent border-accent")} onClick={toggleReminders}
              title="Each working morning at 9:00, emails anyone with work due today, due tomorrow or overdue">
              <BellRing size={13} /> <span className="hidden sm:inline">Reminders {reminders ? "on" : "off"}</span>
            </button>
          )}
          <Link href="/team/board" className="btn sm primary"><Kanban size={13} /> Board</Link>
        </>} />
      <PageBody className="grid gap-5 content-start max-w-[820px]">
        {canSend === false && (
          <div className="rounded-xl border border-line bg-p2-soft text-p2 p-3 text-[12.5px] flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 flex-none" />
            <div className="flex-1">Tracker can&apos;t send emails from your Gmail yet, so invites and requests will only show inside the app.
              <a className="underline font-medium ml-1" href="/api/google/start">Reconnect Google</a> once and tick the “Send email on your behalf” box.</div>
          </div>
        )}

        <TeamSummary />

        <form onSubmit={add} className="bg-panel-2 rounded-xl p-4 grid gap-2.5">
          <div className="font-semibold text-[13px] flex items-center gap-1.5"><UserPlus size={14} /> Add someone</div>
          <div className="grid sm:grid-cols-[1fr_1.4fr_auto] gap-2">
            <input className="field" placeholder="Name, e.g. Ravi Kumar" value={name} onChange={e => setName(e.target.value)} />
            <input className="field" type="email" placeholder="Their email" value={email} onChange={e => setEmail(e.target.value)} />
            <button className="btn primary" disabled={adding}>{adding ? "Adding…" : "Add & invite"}</button>
          </div>
          <div className="text-[11.5px] text-ink-3">They get an email from you. They sign in at the app with that email and see only what you assign them — never your emails, WhatsApp, people or notes.</div>
        </form>

        {needsYou.length > 0 && (
          <section className="grid gap-1">
            <h2 className="text-[12px] font-semibold text-ink-2 mb-0.5">Needs you <span className="text-ink-3 font-normal tnum">{needsYou.length}</span></h2>
            {needsYou.map(t => <Row key={t.id} t={t} member={team.find(m => m.id === t.assignee_id)} unseen={unseenTasks.has(t.id)} onOpen={() => select(t.id)} />)}
          </section>
        )}

        {team.map(m => {
          const theirs = assigned.filter(t => t.assignee_id === m.id);
          const open = theirs.filter(t => isOpen(t.status));
          const doneRecently = theirs.filter(t => t.status === "done" && t.completed_at && Date.now() - new Date(t.completed_at).getTime() < 7 * 86_400_000);
          return (
            <section key={m.id} className="rounded-xl border border-line p-4 grid gap-2">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-full bg-p3-soft text-p3 grid place-items-center text-[12px] font-semibold flex-none">{initials(m.name)}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[13.5px] truncate">{m.name}</div>
                  <div className="text-[11.5px] text-ink-3 truncate">{m.email} · {m.joined_at ? `joined ${format(new Date(m.joined_at), "d MMM")}` : "invited, hasn't signed in yet"}</div>
                </div>
                <span className="text-[12px] text-ink-3 tnum">{open.length} open</span>
                <MemberMenu m={m} />
              </div>
              {open.length > 0 && (
                <div className="grid gap-0.5">
                  {open.map(t => <Row key={t.id} t={t} unseen={unseenTasks.has(t.id)} onOpen={() => select(t.id)} />)}
                </div>
              )}
              {!open.length && <div className="text-[12px] text-ink-3">Nothing assigned. Open any task and set “Assigned to”.</div>}
              {doneRecently.length > 0 && <div className="text-[11.5px] text-ink-3">{doneRecently.length} closed this week</div>}
            </section>
          );
        })}

        {!team.length && <div className="text-[12.5px] text-ink-3">No one yet. Add someone above, then open any task and choose “Assigned to”.</div>}
      </PageBody>
    </div>
  );
}

function Row({ t, member, unseen, onOpen }: { t: Task; member?: TeamMember; unseen: boolean; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="flex items-center gap-2 h-8 px-2 rounded-lg row-hover text-left text-[13px] w-full">
      {member && <span className="w-5 h-5 rounded-full bg-p3-soft text-p3 grid place-items-center text-[9.5px] font-semibold flex-none" title={member.name}>{initials(member.name)}</span>}
      <span className="flex-1 truncate">{t.title}</span>
      {unseen && <span className="pill bg-accent text-accent-ink flex-none"><MessageSquare size={10} /> new reply</span>}
      <span className={clsx("pill flex-none", t.status === "in_review" ? "bg-p3-soft text-p3" : "text-ink-3")}>
        {t.status === "in_review" && <Eye size={10} />}{STATUS_LABEL[t.status]}
      </span>
      {t.due_at && <span className={clsx("text-[11.5px] tnum flex-none w-14 text-right", new Date(t.due_at) < new Date() ? "text-p1" : "text-ink-3")}>{format(new Date(t.due_at), "d MMM")}</span>}
      <span className="text-[11px] text-ink-3 flex-none w-20 text-right hidden sm:inline">{formatDistanceToNow(new Date(t.updated_at), { addSuffix: true })}</span>
    </button>
  );
}

function MemberMenu({ m }: { m: TeamMember }) {
  const { removeMember, toast } = useStore();
  return (
    <Popover align="right" trigger={<button className="btn ghost sm px-1"><MoreHorizontal size={14} /></button>}>
      {(close) => <>
        <button className="menu-item" onClick={async () => { close(); const { ok } = await teamEmail("invite", { memberId: m.id }); if (ok) toast(`Invite re-sent to ${m.email}`); }}>Resend invite</button>
        <button className="menu-item text-danger" onClick={() => { close(); if (confirm(`Remove ${m.name}? They lose access straight away. Their open tasks come back to you.`)) removeMember(m.id); }}>Remove from team</button>
      </>}
    </Popover>
  );
}
