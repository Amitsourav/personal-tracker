"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { formatDistanceToNow } from "date-fns";
import { Paperclip, Link2, FileText, Image as ImageIcon, X, Loader2 } from "lucide-react";
import clsx from "clsx";

const BUCKET = "task-files";
const MAX_BYTES = 25 * 1024 * 1024;

type Item = {
  id: string; kind: "file" | "link"; name: string; path: string | null; url: string | null;
  size_bytes: number | null; mime: string | null; created_at: string; mine: boolean; uploaded_by?: string | null;
};

/**
 * Files and links on a task, for both sides of it.
 *
 * mode "owner" is Amit on his own task: straight to the table and his storage
 * folder. mode "member" is a team member on a task assigned to them: every
 * read and write goes through the member_* functions, and storage only lets
 * them under that one task's folder. Same screen, same behaviour; only the
 * door differs.
 *
 * Files are private. Each is opened through a link that expires after an hour,
 * so a URL pasted somewhere it shouldn't be stops working by itself.
 */
export function Attachments({ taskId, mode, assigned }: { taskId: string; mode: "owner" | "member"; assigned?: boolean }) {
  const userId = useStore(s => s.userId);
  const team = useStore(s => s.team);
  const [items, setItems] = useState<Item[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = (t: string) => useStore.getState().toast(t);

  const load = useCallback(async () => {
    const sb = createClient();
    let rows: Item[];
    if (mode === "owner") {
      const { data } = await sb.from("task_attachments").select("*").eq("task_id", taskId).order("created_at");
      rows = (data ?? []).map(r => ({ ...r, mine: r.uploaded_by === userId })) as Item[];
    } else {
      const { data } = await sb.rpc("member_attachments", { p_task: taskId });
      rows = (data ?? []) as Item[];
    }
    setItems(rows);
    const paths = rows.filter(r => r.path).map(r => r.path!);
    if (paths.length) {
      const { data } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
      setUrls(Object.fromEntries((data ?? []).filter(d => d.signedUrl && d.path).map(d => [d.path!, d.signedUrl as string])));
    }
  }, [taskId, mode, userId]);
  useEffect(() => { load(); }, [load]);

  async function ownerOf(): Promise<string | null> {
    if (mode === "owner") return userId;
    const { data } = await createClient().rpc("assigned_task_owner", { p_task: taskId });
    return (data as string | null) ?? null;
  }

  async function record(row: { kind: "file" | "link"; name: string; path?: string; url?: string; size_bytes?: number; mime?: string }, owner: string) {
    const sb = createClient();
    if (mode === "member") {
      const { error } = await sb.rpc("member_attach", {
        p_task: taskId, p_kind: row.kind, p_name: row.name, p_path: row.path ?? null,
        p_url: row.url ?? null, p_size: row.size_bytes ?? null, p_mime: row.mime ?? null,
      });
      return error?.message ?? null;
    }
    const { error } = await sb.from("task_attachments").insert({ task_id: taskId, owner_id: owner, uploaded_by: userId, ...row });
    if (error) return error.message;
    // Only worth a line in the conversation when someone else is on the task.
    if (assigned) await sb.from("task_comments").insert({ task_id: taskId, owner_id: owner, author_id: userId, kind: "attachment", body: row.name });
    return null;
  }

  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    const tooBig = list.filter(f => f.size > MAX_BYTES);
    if (tooBig.length) toast(`${tooBig.map(f => f.name).join(", ")} is over 25 MB — share it as a Drive link instead`);
    const ok = list.filter(f => f.size <= MAX_BYTES);
    if (!ok.length) return;
    setBusy(true);
    const owner = await ownerOf();
    if (!owner) { setBusy(false); toast("You can't add files to this task"); return; }
    const sb = createClient();
    for (const f of ok) {
      const safe = f.name.replace(/[^\w.\-]+/g, "_").slice(-120) || "file";
      const path = `${owner}/${taskId}/${crypto.randomUUID().slice(0, 8)}-${safe}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined });
      if (error) { toast(`Couldn't upload ${f.name}: ${error.message}`); continue; }
      const err = await record({ kind: "file", name: f.name, path, size_bytes: f.size, mime: f.type || undefined }, owner);
      if (err) toast(`Couldn't save ${f.name}: ${err}`);
    }
    setBusy(false);
    await load();
  }

  async function addLink(e: React.FormEvent) {
    e.preventDefault();
    let url = link.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    let name: string;
    try { const u = new URL(url); name = /drive\.google|docs\.google/.test(u.hostname) ? "Google Drive link" : u.hostname.replace(/^www\./, "") + (u.pathname.length > 1 ? u.pathname : ""); }
    catch { toast("That doesn't look like a link"); return; }
    setBusy(true);
    const owner = await ownerOf();
    const err = owner ? await record({ kind: "link", name: name.slice(0, 120), url }, owner) : "not your task";
    setBusy(false);
    if (err) { toast("Couldn't add link: " + err); return; }
    setLink(""); setLinkOpen(false);
    await load();
  }

  async function remove(it: Item) {
    if (!confirm(`Remove “${it.name}”?`)) return;
    const sb = createClient();
    if (mode === "member") {
      const { error } = await sb.rpc("member_detach", { p_id: it.id });
      if (error) { toast(error.message); return; }
    } else {
      if (it.path) await sb.storage.from(BUCKET).remove([it.path]);
      await sb.from("task_attachments").delete().eq("id", it.id);
    }
    await load();
  }

  const open = (it: Item) => it.kind === "link" ? it.url! : (it.path ? urls[it.path] : undefined);

  return (
    <div
      className={clsx("rounded-xl border p-2.5 grid gap-1.5 transition-colors", drag ? "border-accent bg-selected" : "border-line")}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
      // A screenshot pasted while the box has focus is the quickest way to show a problem.
      onPaste={e => { const fs = [...e.clipboardData.files]; if (fs.length) { e.preventDefault(); upload(fs); } }}
      tabIndex={-1}>
      <div className="flex items-center gap-1">
        <span className="text-[11px] font-semibold text-ink-3 uppercase tracking-wide">Attachments</span>
        {items.length > 0 && <span className="text-[11px] text-ink-3 tnum">{items.length}</span>}
        {busy && <Loader2 size={12} className="animate-spin text-ink-3 ml-1" />}
        <div className="ml-auto flex gap-1">
          <button className="btn ghost sm" disabled={busy} onClick={() => fileRef.current?.click()} title="Upload files (or drag them here)"><Paperclip size={13} /> File</button>
          <button className="btn ghost sm" disabled={busy} onClick={() => setLinkOpen(!linkOpen)} title="Add a link, e.g. Google Drive"><Link2 size={13} /> Link</button>
        </div>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={e => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
      </div>

      {linkOpen && (
        <form onSubmit={addLink} className="flex gap-1.5">
          <input autoFocus className="field h-7 flex-1" placeholder="Paste a link (Drive, Sheets, website…)" value={link} onChange={e => setLink(e.target.value)} />
          <button className="btn sm primary" disabled={busy || !link.trim()}>Add</button>
        </form>
      )}

      {items.map(it => {
        const href = open(it);
        const isImg = it.kind === "file" && it.mime?.startsWith("image/") && href;
        return (
          <div key={it.id} className="group flex items-center gap-2 rounded-lg px-1.5 py-1 row-hover text-[12.5px]">
            {isImg
              // eslint-disable-next-line @next/next/no-img-element -- a signed, expiring URL; nothing for next/image to optimise
              ? <img src={href} alt="" className="w-9 h-9 rounded object-cover flex-none border border-line" />
              : <span className="w-9 h-9 rounded bg-panel-2 grid place-items-center flex-none text-ink-3">
                  {it.kind === "link" ? <Link2 size={14} /> : it.mime?.startsWith("image/") ? <ImageIcon size={14} /> : <FileText size={14} />}
                </span>}
            <div className="flex-1 min-w-0">
              {href
                ? <a href={href} target="_blank" rel="noopener noreferrer" className="block truncate text-accent hover:underline">{it.name}</a>
                : <span className="block truncate">{it.name}</span>}
              <div className="text-[11px] text-ink-3 truncate">
                {it.size_bytes != null && `${fmtSize(it.size_bytes)} · `}{it.mine ? "you" : mode === "owner" ? (team.find(m => m.member_id === it.uploaded_by)?.name ?? "team member") : "shared with you"} · {formatDistanceToNow(new Date(it.created_at), { addSuffix: true })}
              </div>
            </div>
            {(mode === "owner" || it.mine) && (
              <button className="btn ghost sm px-1 opacity-0 group-hover:opacity-100 max-md:opacity-60" onClick={() => remove(it)} title="Remove"><X size={13} /></button>
            )}
          </div>
        );
      })}
      {!items.length && !linkOpen && <div className="text-[11.5px] text-ink-3 px-0.5">Drag files here, paste a screenshot, or add a Drive link.</div>}
    </div>
  );
}

function fmtSize(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
