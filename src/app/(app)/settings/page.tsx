"use client";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Suspense } from "react";
import { IntegrationsSettings } from "@/components/IntegrationsSettings";
import { PageHeader, PageBody } from "@/components/PageHeader";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Settings() {
  const { profile, updateProfile, tasks, projects, people, tags, taskTags, toast } = useStore();
  const router = useRouter();
  if (!profile) return null;
  const toggleDay = (d: number) => updateProfile({ work_days: profile.work_days.includes(d) ? profile.work_days.filter(x => x !== d) : [...profile.work_days, d].sort() });
  function exportJson() {
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), tasks, projects, people, tags, task_tags: taskTags }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `tracker-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  }
  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["title", "status", "priority", "due_at", "project", "from", "waiting_on", "created_at", "completed_at", "description"].join(",")];
    for (const t of tasks) rows.push([t.title, t.status, t.priority, t.due_at, projects.find(p => p.id === t.project_id)?.name, people.find(p => p.id === t.person_id)?.name, people.find(p => p.id === t.waiting_on_person_id)?.name, t.created_at, t.completed_at, t.description].map(esc).join(","));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" })); a.download = `tracker-tasks-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  }
  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Settings" />
      <PageBody className="grid gap-5 content-start max-w-[720px]">
        <Section title="You">
          <Row label="Name"><input className="field" defaultValue={profile.display_name ?? ""} onBlur={e => updateProfile({ display_name: e.target.value })} /></Row>
          <Row label="Timezone"><input className="field" defaultValue={profile.timezone} onBlur={e => updateProfile({ timezone: e.target.value })} /></Row>
        </Section>
        <Section title="Working hours" hint="Used when reading deadlines like “EOD” and “end of week” from messages, and for planning your day.">
          <Row label="“EOD” means"><input type="time" className="field w-[140px]" defaultValue={profile.eod_time.slice(0, 5)} onBlur={e => updateProfile({ eod_time: e.target.value })} /></Row>
          <Row label="Work days"><div className="flex gap-1">{DAYS.map((d, i) => <button key={d} className={`btn sm ${profile.work_days.includes(i) ? "primary" : ""}`} onClick={() => toggleDay(i)}>{d}</button>)}</div></Row>
          <Row label="Day starts / ends"><div className="flex gap-2"><input type="time" className="field w-[120px]" defaultValue={profile.day_start.slice(0, 5)} onBlur={e => updateProfile({ day_start: e.target.value })} /><input type="time" className="field w-[120px]" defaultValue={profile.day_end.slice(0, 5)} onBlur={e => updateProfile({ day_end: e.target.value })} /></div></Row>
        </Section>
        <Suspense><IntegrationsSettings /></Suspense>
        <Section title="Your data" hint="Everything stays in your own database. Export anytime.">
          <div className="flex gap-2"><button className="btn sm" onClick={exportJson}>Export JSON</button><button className="btn sm" onClick={exportCsv}>Export tasks CSV</button></div>
        </Section>
        <Section title="Keyboard">
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px] text-ink-2">
            {[["N", "New task"], ["⌘K or /", "Search & commands"], ["J / K", "Move down / up"], ["↵ / Esc", "Open / close task"], ["X or Space", "Complete"], ["1 – 4", "Set priority"], ["T / M / W", "Due today / tomorrow / next week"], ["⌫", "Delete selected"], ["G then T/U/I/A/P/L", "Go to Today / Upcoming / Inbox / All / People / Logbook"]].map(([k, v]) => <><kbd key={k} className="justify-self-start">{k}</kbd><span key={v}>{v}</span></>)}
          </div>
        </Section>
        <div><button className="btn sm" onClick={async () => { await createClient().auth.signOut(); toast("Signed out"); router.push("/login"); }}>Sign out</button></div>
      </PageBody>
    </div>
  );
}
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) { return <section className="bg-panel-2 rounded-xl p-5 grid gap-3.5"><div><h2 className="font-semibold text-[13px]">{title}</h2>{hint && <p className="text-[11.5px] text-ink-3 mt-0.5">{hint}</p>}</div>{children}</section>; }
function Row({ label, children }: { label: string; children: React.ReactNode }) { return <div className="grid grid-cols-[130px_1fr] items-center gap-2 text-[12.5px]"><span className="text-ink-2">{label}</span>{children}</div>; }
