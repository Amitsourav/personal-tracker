"use client";
import { Workspace } from "@/components/Workspace";
export default function Upcoming() {
  return <Workspace scopeKey="upcoming" title="Upcoming" subtitle="Everything with a date" baseFilter={{ due: "any" }} defaultGroup="due" defaultSort={[{ field: "due_at", dir: "asc" }]} defaultLayout="list" />;
}
