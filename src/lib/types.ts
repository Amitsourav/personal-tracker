export type TaskStatus = "inbox" | "todo" | "in_progress" | "waiting" | "done" | "cancelled";
export type ReviewState = "suggested" | "accepted" | "rejected";
export type SourceKind = "manual" | "gmail" | "whatsapp" | "bot" | "calendar" | "meeting" | "other";

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: 1 | 2 | 3 | 4;
  due_at: string | null;
  due_has_time: boolean;
  start_at: string | null;
  scheduled_at: string | null;
  duration_min: number | null;
  completed_at: string | null;
  project_id: string | null;
  parent_id: string | null;
  person_id: string | null;
  waiting_on_person_id: string | null;
  recurrence: string | null;
  recurrence_anchor: string | null;
  custom_fields: Record<string, unknown>;
  source_kind: SourceKind;
  source_ref: string | null;
  source_link: string | null;
  source_quote: string | null;
  confidence: number | null;
  review_state: ReviewState;
  /** Only set when someone else asked for this — see the verification ladder. */
  verification: "none" | "self" | "evidence" | "confirmed";
  verified_at: string | null;
  verification_note: string | null;
  ai_meta: Record<string, unknown>;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Project {
  id: string; user_id: string; name: string; description: string | null; color: string; icon: string | null;
  status: string; sort_order: number; parent_id: string | null; created_at: string; updated_at: string; archived_at: string | null;
}
export interface Person {
  id: string; user_id: string; name: string; emails: string[]; phones: string[]; whatsapp_ids: string[];
  company: string | null; role: string | null; notes: string | null; trust_level: string; last_contact_at: string | null;
  created_at: string; updated_at: string;
}
export interface Tag { id: string; user_id: string; name: string; color: string; created_at: string }
export interface TaskTag { task_id: string; tag_id: string }
export interface SavedView {
  id: string; user_id: string; name: string; layout: Layout; filter: ViewFilter; sort: SortSpec[]; group_by: string | null; icon: string | null; sort_order: number; created_at: string;
}
export interface Profile {
  id: string; display_name: string | null; timezone: string; eod_time: string; work_days: number[]; day_start: string; day_end: string; settings: Record<string, unknown>;
}
export interface TaskEvent { id: string; task_id: string | null; kind: string; actor: "user"|"ai"|"system"; changes: Record<string, {from: unknown; to: unknown}>; note: string | null; created_at: string }

export type Layout = "list" | "table" | "board" | "calendar";
export interface ViewFilter {
  status?: TaskStatus[];
  priority?: number[];
  project_id?: string[];
  tag_id?: string[];
  person_id?: string[];
  due?: "overdue" | "today" | "week" | "none" | "any";
  search?: string;
  include_done?: boolean;
}
export interface SortSpec { field: keyof Task; dir: "asc" | "desc" }

export const STATUS_LABEL: Record<TaskStatus, string> = {
  inbox: "Inbox", todo: "To do", in_progress: "In progress", waiting: "Waiting", done: "Done", cancelled: "Cancelled",
};
export const STATUS_ORDER: TaskStatus[] = ["inbox", "todo", "in_progress", "waiting", "done", "cancelled"];
export const PRIORITY_LABEL: Record<number, string> = { 1: "Urgent", 2: "High", 3: "Medium", 4: "None" };
