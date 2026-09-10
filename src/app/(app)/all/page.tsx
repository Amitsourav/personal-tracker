"use client";
import { Workspace } from "@/components/Workspace";
export default function All() {
  return <Workspace scopeKey="all" title="All tasks" baseFilter={{}} defaultGroup="project" />;
}
