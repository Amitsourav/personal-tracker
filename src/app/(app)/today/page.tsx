"use client";
import { Workspace } from "@/components/Workspace";
import { format } from "date-fns";
import { WhatChanged } from "@/components/WhatChanged";
import { Risks } from "@/components/Risks";
export default function Today() {
  return <Workspace scopeKey="today" title="Today" subtitle={format(new Date(), "EEEE, d MMMM")} baseFilter={{ due: "today" }} defaultGroup="due" defaultsForNew={{ due_at: (() => { const d = new Date(); d.setHours(23, 59, 0, 0); return d.toISOString(); })() }} banner={<><Risks /><WhatChanged /></>} />;
}
