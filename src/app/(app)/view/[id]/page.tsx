"use client";
import { use } from "react";
import { Workspace, type GroupBy } from "@/components/Workspace";
import { useStore } from "@/lib/store";
import { Empty } from "@/components/views/ListView";
export default function ViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const v = useStore(s => s.views.find(x => x.id === id));
  if (!v) return <Empty text="View not found" />;
  return <Workspace scopeKey={`view:${id}`} title={v.name} baseFilter={v.filter} defaultLayout={v.layout} defaultGroup={(v.group_by as GroupBy) ?? "none"} defaultSort={v.sort} allowSaveView={false} />;
}
