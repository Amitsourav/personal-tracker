"use client";
import { create } from "zustand";
import { createClient } from "./supabase/client";
import type { Task, Project, Tag, Person, TaskTag, SavedView, Profile, TaskStatus } from "./types";
import { RRule } from "rrule";

type Toast = { id: number; text: string; undo?: () => void };

interface State {
  ready: boolean;
  userId: string | null;
  profile: Profile | null;
  tasks: Task[];
  projects: Project[];
  tags: Tag[];
  people: Person[];
  taskTags: TaskTag[];
  views: SavedView[];
  selectedId: string | null;
  focusId: string | null;
  toasts: Toast[];
  cmdOpen: boolean;
  quickAddOpen: boolean;
  load: () => Promise<void>;
  select: (id: string | null) => void;
  setFocus: (id: string | null) => void;
  setCmdOpen: (v: boolean) => void;
  setQuickAddOpen: (v: boolean) => void;
  toast: (text: string, undo?: () => void) => void;
  dismissToast: (id: number) => void;
  addTask: (t: Partial<Task> & { title: string }, tagIds?: string[]) => Promise<Task | null>;
  updateTask: (id: string, patch: Partial<Task>, opts?: { silent?: boolean }) => Promise<void>;
  completeTask: (id: string, done?: boolean) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  setTaskTags: (id: string, tagIds: string[]) => Promise<void>;
  addProject: (p: Partial<Project> & { name: string }) => Promise<Project | null>;
  updateProject: (id: string, patch: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  addTag: (name: string, color?: string) => Promise<Tag | null>;
  addPerson: (p: Partial<Person> & { name: string }) => Promise<Person | null>;
  updatePerson: (id: string, patch: Partial<Person>) => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  addView: (v: Partial<SavedView> & { name: string }) => Promise<SavedView | null>;
  deleteView: (id: string) => Promise<void>;
}

let toastSeq = 1;
const sb = () => createClient();

export const useStore = create<State>((set, get) => ({
  ready: false, userId: null, profile: null, tasks: [], projects: [], tags: [], people: [], taskTags: [], views: [],
  selectedId: null, focusId: null, toasts: [], cmdOpen: false, quickAddOpen: false,

  async load() {
    const s = sb();
    const { data: { user } } = await s.auth.getUser();
    if (!user) return;
    const [tasks, projects, tags, people, taskTags, views, profile] = await Promise.all([
      s.from("tasks").select("*").is("deleted_at", null).order("sort_order").order("created_at"),
      s.from("projects").select("*").is("archived_at", null).order("sort_order").order("created_at"),
      s.from("tags").select("*").order("name"),
      s.from("people").select("*").order("name"),
      s.from("task_tags").select("*"),
      s.from("saved_views").select("*").order("sort_order"),
      s.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    ]);
    set({
      ready: true, userId: user.id,
      tasks: (tasks.data ?? []) as Task[], projects: (projects.data ?? []) as Project[], tags: (tags.data ?? []) as Tag[],
      people: (people.data ?? []) as Person[], taskTags: (taskTags.data ?? []) as TaskTag[], views: (views.data ?? []) as SavedView[],
      profile: (profile.data ?? null) as Profile | null,
    });
    // realtime: keep Mac + iPhone in sync
    s.channel("tracker")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (payload) => {
        const st = get();
        if (payload.eventType === "DELETE") { set({ tasks: st.tasks.filter(t => t.id !== (payload.old as Task).id) }); return; }
        const row = payload.new as Task;
        if (row.deleted_at) { set({ tasks: st.tasks.filter(t => t.id !== row.id) }); return; }
        const exists = st.tasks.some(t => t.id === row.id);
        set({ tasks: exists ? st.tasks.map(t => t.id === row.id ? { ...t, ...row } : t) : [...st.tasks, row] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, (payload) => {
        const st = get(); const row = payload.new as Project;
        if (payload.eventType === "DELETE") { set({ projects: st.projects.filter(p => p.id !== (payload.old as Project).id) }); return; }
        if (row.archived_at) { set({ projects: st.projects.filter(p => p.id !== row.id) }); return; }
        set({ projects: st.projects.some(p => p.id === row.id) ? st.projects.map(p => p.id === row.id ? row : p) : [...st.projects, row] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "task_tags" }, async () => {
        const { data } = await sb().from("task_tags").select("*");
        set({ taskTags: (data ?? []) as TaskTag[] });
      })
      .subscribe();
  },

  select: (id) => set({ selectedId: id }),
  setFocus: (id) => set({ focusId: id }),
  setCmdOpen: (v) => set({ cmdOpen: v }),
  setQuickAddOpen: (v) => set({ quickAddOpen: v }),
  toast(text, undo) {
    const id = toastSeq++;
    set(s => ({ toasts: [...s.toasts, { id, text, undo }] }));
    setTimeout(() => get().dismissToast(id), undo ? 6000 : 3000);
  },
  dismissToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),

  async addTask(t, tagIds = []) {
    const userId = get().userId!;
    const siblings = get().tasks.filter(x => x.project_id === (t.project_id ?? null) && !x.parent_id);
    const sort_order = siblings.length ? Math.min(...siblings.map(x => x.sort_order)) - 1 : 0;
    const row = { user_id: userId, priority: 4, status: "todo", sort_order, ...t } as Partial<Task>;
    const { data, error } = await sb().from("tasks").insert(row).select("*").single();
    if (error || !data) { get().toast("Couldn't add task: " + error?.message); return null; }
    const task = data as Task;
    set(s => ({ tasks: s.tasks.some(x => x.id === task.id) ? s.tasks : [...s.tasks, task] }));
    if (tagIds.length) await get().setTaskTags(task.id, tagIds);
    return task;
  },

  async updateTask(id, patch, opts) {
    const prev = get().tasks.find(t => t.id === id);
    if (!prev) return;
    set(s => ({ tasks: s.tasks.map(t => t.id === id ? { ...t, ...patch } : t) }));
    const { error } = await sb().from("tasks").update(patch).eq("id", id);
    if (error) { set(s => ({ tasks: s.tasks.map(t => t.id === id ? prev : t) })); if (!opts?.silent) get().toast("Save failed: " + error.message); }
  },

  async completeTask(id, done = true) {
    const t = get().tasks.find(x => x.id === id);
    if (!t) return;
    const prevStatus = t.status;
    if (done) {
      // Finishing work someone else asked for records that Amit believes it is
      // done — not that they received it. Those are different facts, and the
      // verification ladder keeps them apart. Work nobody asked for stays
      // 'none': there is no one to confirm it and nagging would be noise.
      const needsConfirming = !!t.person_id && t.verification === "none";
      await get().updateTask(id, {
        status: "done", completed_at: new Date().toISOString(),
        ...(needsConfirming ? { verification: "self" as const } : {}),
      });
      // recurring → create the next occurrence
      if (t.recurrence) {
        try {
          const anchor = t.due_at ? new Date(t.due_at) : new Date();
          const rule = RRule.fromString(`DTSTART:${anchor.toISOString().replace(/[-:]|\.\d{3}/g, "")}\nRRULE:${t.recurrence}`);
          const next = rule.after(new Date(Math.max(anchor.getTime(), Date.now())), false);
          if (next) {
            const { id: _i, created_at: _c, updated_at: _u, completed_at: _co, ...rest } = t; void _i; void _c; void _u; void _co;
            await get().addTask({ ...rest, status: "todo", due_at: next.toISOString(), scheduled_at: null, sort_order: t.sort_order });
          }
        } catch { /* bad rule: ignore */ }
      }
      get().toast("Completed", () => get().updateTask(id, { status: prevStatus === "done" ? "todo" : prevStatus, completed_at: null }));
    } else {
      await get().updateTask(id, {
        status: "todo", completed_at: null,
        ...(t.verification === "self" ? { verification: "none" as const, verified_at: null } : {}),
      });
    }
  },

  async deleteTask(id) {
    const t = get().tasks.find(x => x.id === id);
    if (!t) return;
    set(s => ({ tasks: s.tasks.filter(x => x.id !== id && x.parent_id !== id), selectedId: s.selectedId === id ? null : s.selectedId }));
    await sb().from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    get().toast("Deleted", async () => {
      await sb().from("tasks").update({ deleted_at: null }).eq("id", id);
      set(s => ({ tasks: [...s.tasks, t] }));
    });
  },

  async setTaskTags(id, tagIds) {
    set(s => ({ taskTags: [...s.taskTags.filter(tt => tt.task_id !== id), ...tagIds.map(tag_id => ({ task_id: id, tag_id }))] }));
    await sb().from("task_tags").delete().eq("task_id", id);
    if (tagIds.length) await sb().from("task_tags").insert(tagIds.map(tag_id => ({ task_id: id, tag_id })));
  },

  async addProject(p) {
    const { data, error } = await sb().from("projects").insert({ user_id: get().userId, color: "#3144C2", ...p }).select("*").single();
    if (error || !data) { get().toast("Couldn't add project"); return null; }
    set(s => ({ projects: s.projects.some(x => x.id === data.id) ? s.projects : [...s.projects, data as Project] }));
    return data as Project;
  },
  async updateProject(id, patch) {
    set(s => ({ projects: s.projects.map(p => p.id === id ? { ...p, ...patch } : p) }));
    await sb().from("projects").update(patch).eq("id", id);
  },
  async deleteProject(id) {
    set(s => ({ projects: s.projects.filter(p => p.id !== id) }));
    await sb().from("projects").update({ archived_at: new Date().toISOString() }).eq("id", id);
    get().toast("Project archived");
  },
  async addTag(name, color = "#566172") {
    const existing = get().tags.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const { data, error } = await sb().from("tags").insert({ user_id: get().userId, name, color }).select("*").single();
    if (error || !data) return null;
    set(s => ({ tags: [...s.tags, data as Tag].sort((a, b) => a.name.localeCompare(b.name)) }));
    return data as Tag;
  },
  async addPerson(p) {
    const { data, error } = await sb().from("people").insert({ user_id: get().userId, ...p }).select("*").single();
    if (error || !data) { get().toast("Couldn't add person"); return null; }
    set(s => ({ people: [...s.people, data as Person].sort((a, b) => a.name.localeCompare(b.name)) }));
    return data as Person;
  },
  async updatePerson(id, patch) {
    set(s => ({ people: s.people.map(p => p.id === id ? { ...p, ...patch } : p) }));
    await sb().from("people").update(patch).eq("id", id);
  },
  async updateProfile(patch) {
    set(s => ({ profile: s.profile ? { ...s.profile, ...patch } : s.profile }));
    await sb().from("profiles").update(patch).eq("id", get().userId!);
  },
  async addView(v) {
    const { data, error } = await sb().from("saved_views").insert({ user_id: get().userId, layout: "list", filter: {}, sort: [], ...v }).select("*").single();
    if (error || !data) { get().toast("Couldn't save view"); return null; }
    set(s => ({ views: [...s.views, data as SavedView] }));
    return data as SavedView;
  },
  async deleteView(id) {
    set(s => ({ views: s.views.filter(v => v.id !== id) }));
    await sb().from("saved_views").delete().eq("id", id);
  },
}));

// ---------- selectors ----------
export function applyFilter(tasks: Task[], taskTags: TaskTag[], f: import("./types").ViewFilter, now = new Date()): Task[] {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const endToday = new Date(start); endToday.setDate(endToday.getDate() + 1);
  const endWeek = new Date(start); endWeek.setDate(endWeek.getDate() + 7);
  return tasks.filter(t => {
    if (t.review_state !== "accepted") return false;
    if (!f.include_done && (t.status === "done" || t.status === "cancelled")) return false;
    if (f.status?.length && !f.status.includes(t.status)) return false;
    if (f.priority?.length && !f.priority.includes(t.priority)) return false;
    if (f.project_id?.length && !f.project_id.includes(t.project_id ?? "")) return false;
    if (f.person_id?.length && !(f.person_id.includes(t.person_id ?? "") || f.person_id.includes(t.waiting_on_person_id ?? ""))) return false;
    if (f.tag_id?.length && !taskTags.some(tt => tt.task_id === t.id && f.tag_id!.includes(tt.tag_id))) return false;
    if (f.due && f.due !== "any") {
      // Date views answer "is this on my plate today", so a planned date counts
      // as much as a deadline. They stay separate everywhere it matters: only
      // due_at can make something overdue, because only a deadline can be
      // broken. A planned day that slipped is just a day that went differently.
      const due = t.due_at ? new Date(t.due_at) : null;
      const planned = t.start_at ? new Date(t.start_at) : null;
      const dated = due ?? planned;
      if (f.due === "none" && dated) return false;
      if (f.due === "overdue" && !(due && due < start)) return false;
      if (f.due === "today" && !(dated && dated < endToday)) return false;
      if (f.due === "week" && !(dated && dated < endWeek)) return false;
    }
    if (f.search) {
      const q = f.search.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !(t.description ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

export function sortTasks(tasks: Task[], sort: import("./types").SortSpec[]): Task[] {
  if (!sort.length) return [...tasks].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  return [...tasks].sort((a, b) => {
    for (const s of sort) {
      const av = s.field === "due_at" ? (a.due_at ?? a.start_at) : a[s.field];
      const bv = s.field === "due_at" ? (b.due_at ?? b.start_at) : b[s.field];
      if (av === bv) continue;
      if (av == null) return 1; if (bv == null) return -1;
      const c = av < bv ? -1 : 1;
      return s.dir === "asc" ? c : -c;
    }
    return a.sort_order - b.sort_order;
  });
}
export const isOpen = (s: TaskStatus) => s !== "done" && s !== "cancelled";
