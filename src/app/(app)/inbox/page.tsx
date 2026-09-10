"use client";
import { Workspace } from "@/components/Workspace";
export default function InboxPage() {
  return <Workspace scopeKey="inbox" title="Inbox" subtitle="Unsorted tasks — give each a project, date or priority" baseFilter={{ status: ["inbox"] }} defaultsForNew={{ status: "inbox" }} />;
}
