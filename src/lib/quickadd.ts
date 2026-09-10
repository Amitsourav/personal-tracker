import * as chrono from "chrono-node";
import type { Project, Tag, Person } from "./types";

export interface ParsedQuickAdd {
  title: string;
  due_at: string | null;
  due_has_time: boolean;
  priority: 1 | 2 | 3 | 4;
  project?: Project;
  projectName?: string;
  tags: Tag[];
  newTags: string[];
  person?: Person;
  personName?: string;
  duration_min: number | null;
  recurrence: string | null;
  scheduled_at: string | null;
  tokens: { kind: string; text: string }[];
}

const RECUR: [RegExp, string][] = [
  [/\bevery\s+day\b|\bdaily\b|\broz\b/i, "FREQ=DAILY"],
  [/\bevery\s+weekday\b/i, "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
  [/\bevery\s+(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i, "DAY"],
  [/\bevery\s+week\b|\bweekly\b/i, "FREQ=WEEKLY"],
  [/\bevery\s+month\b|\bmonthly\b/i, "FREQ=MONTHLY"],
  [/\bevery\s+year\b|\byearly\b|\bannually\b/i, "FREQ=YEARLY"],
];
const DAYMAP: Record<string, string> = { mon: "MO", tue: "TU", wed: "WE", thu: "TH", fri: "FR", sat: "SA", sun: "SU" };

// Hinglish helpers → English so chrono can parse
const HINGLISH: [RegExp, string][] = [
  [/\bkal\s+tak\b/gi, "tomorrow"],
  [/\bkal\b/gi, "tomorrow"],
  [/\bparso\b/gi, "in 2 days"],
  [/\baaj\b/gi, "today"],
  [/\bagle\s+hafte\b/gi, "next week"],
  [/\bagle\s+(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/gi, "next $1"],
  [/\bshaam\b/gi, "6pm"],
  [/\bsubah\b/gi, "9am"],
  [/\braat\b/gi, "9pm"],
  [/\bdopahar\b/gi, "1pm"],
  [/\beod\b/gi, "11:59pm"],
  [/\beow\b/gi, "saturday"],
];

export function parseQuickAdd(input: string, ctx: { projects: Project[]; tags: Tag[]; people: Person[]; now?: Date }): ParsedQuickAdd {
  const now = ctx.now ?? new Date();
  let text = input;
  const tokens: { kind: string; text: string }[] = [];
  const out: ParsedQuickAdd = { title: "", due_at: null, due_has_time: false, priority: 4, tags: [], newTags: [], duration_min: null, recurrence: null, scheduled_at: null, tokens };

  // priority
  const pm = text.match(/(^|\s)(p[1-4]|!{1,3})(?=\s|$)/i);
  if (pm) {
    const t = pm[2].toLowerCase();
    out.priority = t.startsWith("p") ? (Number(t[1]) as 1|2|3|4) : t === "!!!" ? 1 : t === "!!" ? 2 : 3;
    tokens.push({ kind: "priority", text: pm[2] });
    text = text.replace(pm[0], " ");
  }
  // project #name  (allow quotes / multiword via #"x y")
  const prm = text.match(/#(?:"([^"]+)"|(\S+))/);
  if (prm) {
    const name = (prm[1] ?? prm[2]).toLowerCase();
    out.project = ctx.projects.find(p => p.name.toLowerCase() === name) ?? ctx.projects.find(p => p.name.toLowerCase().startsWith(name));
    out.projectName = prm[1] ?? prm[2];
    tokens.push({ kind: "project", text: prm[0] });
    text = text.replace(prm[0], " ");
  }
  // tags @name (multiple)
  for (const m of [...text.matchAll(/(^|\s)@(\S+)/g)]) {
    const name = m[2];
    const tag = ctx.tags.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (tag) out.tags.push(tag); else out.newTags.push(name);
    tokens.push({ kind: "tag", text: "@" + name });
    text = text.replace(m[0], " ");
  }
  // person  from:Name / for:Name / by:Name
  const pem = text.match(/\b(?:from|for|by|with):(?:"([^"]+)"|(\S+))/i);
  if (pem) {
    const name = (pem[1] ?? pem[2]).toLowerCase();
    out.person = ctx.people.find(p => p.name.toLowerCase() === name) ?? ctx.people.find(p => p.name.toLowerCase().startsWith(name));
    out.personName = pem[1] ?? pem[2];
    tokens.push({ kind: "person", text: pem[0] });
    text = text.replace(pem[0], " ");
  }
  // duration ~30m ~2h ~1h30
  const dm = text.match(/(^|\s)~(\d+)\s*(h|hr|hrs|m|min|mins)?(?:\s*(\d+)\s*m)?(?=\s|$)/i);
  if (dm) {
    const n = Number(dm[2]); const unit = (dm[3] ?? "m").toLowerCase();
    out.duration_min = unit.startsWith("h") ? n * 60 + Number(dm[4] ?? 0) : n;
    tokens.push({ kind: "duration", text: dm[0].trim() });
    text = text.replace(dm[0], " ");
  }
  // recurrence
  for (const [re, rule] of RECUR) {
    const m = text.match(re);
    if (m) {
      out.recurrence = rule === "DAY" ? `FREQ=WEEKLY;BYDAY=${DAYMAP[m[1].slice(0,3).toLowerCase()]}` : rule;
      tokens.push({ kind: "repeat", text: m[0] });
      text = text.replace(m[0], " ");
      break;
    }
  }
  // dates (Hinglish → English first, then chrono)
  let dateText = text;
  for (const [re, rep] of HINGLISH) dateText = dateText.replace(re, rep);
  const results = chrono.parse(dateText, now, { forwardDate: true });
  if (results.length) {
    const r = results[0];
    const d = r.start.date();
    out.due_has_time = r.start.isCertain("hour");
    if (!out.due_has_time) d.setHours(23, 59, 0, 0);
    out.due_at = d.toISOString();
    // remove the matched phrase from the original text (best effort: use same offsets when texts equal, else remove from translated)
    if (dateText === text) text = text.slice(0, r.index) + " " + text.slice(r.index + r.text.length);
    else {
      // find the hinglish source phrase to strip
      for (const [re] of HINGLISH) { const m = text.match(re); if (m) { text = text.replace(m[0], " "); break; } }
      if (dateText.includes(r.text) && text.includes(r.text)) text = text.replace(r.text, " ");
    }
    tokens.push({ kind: "date", text: r.text });
  }
  out.title = text.replace(/\s+/g, " ").trim();
  return out;
}
