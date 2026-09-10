"use client";
import { use } from "react";
import { Workspace } from "@/components/Workspace";
import { useStore } from "@/lib/store";
import { Empty } from "@/components/views/ListView";
export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const project = useStore(s => s.projects.find(p => p.id === id));
  if (!project) return <Empty text="Project not found" sub="It may have been archived." />;
  return <Workspace scopeKey={`project:${id}`} title={project.name} subtitle={project.description ?? undefined} baseFilter={{ project_id: [id] }} defaultsForNew={{ project_id: id }} showProject={false} defaultGroup="status" />;
}
