"use client";
import { Workspace } from "@/components/Workspace";
export default function Logbook() {
  return <Workspace scopeKey="logbook" title="Logbook" subtitle="Completed and cancelled" baseFilter={{ status: ["done", "cancelled"], include_done: true }} defaultSort={[{ field: "completed_at", dir: "desc" }]} allowSaveView={false} />;
}
