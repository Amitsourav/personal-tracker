import { addDays, endOfDay, format, isBefore, isSameDay, isSameYear, startOfDay, startOfWeek, endOfWeek, differenceInCalendarDays } from "date-fns";

export function fmtDue(iso: string | null, hasTime = false, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = differenceInCalendarDays(d, now);
  let day: string;
  if (diff === 0) day = "Today";
  else if (diff === 1) day = "Tomorrow";
  else if (diff === -1) day = "Yesterday";
  else if (diff > 1 && diff < 7) day = format(d, "EEE");
  else if (isSameYear(d, now)) day = format(d, "d MMM");
  else day = format(d, "d MMM yyyy");
  return hasTime ? `${day} ${format(d, "h:mm a")}` : day;
}
export function isOverdue(t: { due_at: string | null; status: string }, now = new Date()) {
  return !!t.due_at && t.status !== "done" && t.status !== "cancelled" && isBefore(new Date(t.due_at), startOfDay(now));
}
export function dueBucket(iso: string | null, now = new Date()): "overdue" | "today" | "tomorrow" | "week" | "later" | "none" {
  if (!iso) return "none";
  const d = new Date(iso);
  if (isBefore(d, startOfDay(now))) return "overdue";
  if (isSameDay(d, now)) return "today";
  if (isSameDay(d, addDays(now, 1))) return "tomorrow";
  if (isBefore(d, endOfDay(addDays(now, 6)))) return "week";
  return "later";
}
export { startOfDay, endOfDay, addDays, startOfWeek, endOfWeek, isSameDay, format };

/**
 * The date a task shows up under in date views: its deadline if it has one,
 * otherwise the day it is planned for. Only due_at can make something overdue —
 * see isOverdue — because only a deadline can actually be broken.
 */
export function effectiveDate(t: { due_at: string | null; start_at?: string | null }) {
  return t.due_at ?? t.start_at ?? null;
}
