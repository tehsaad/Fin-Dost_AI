"use client";

import Link from "next/link";
import { useState } from "react";
import { ClipboardPlus } from "lucide-react";
import { useApp } from "./app-provider";
import { Button } from "@/components/shared/button";
import { Spinner } from "@/components/shared/feedback";
import { api, errorMessage } from "@/lib/api";

/** Turn a recommendation, alert or data-check finding into a tracked action. The server re-prices any
 * adjustments with the forecast engine; nothing is executed. Hidden when the module or role doesn't allow it. */
export function ProposeAction({ title, description, sourceType, sourceRef, adjustments = [], requiresApproval = true }: {
  title: string; description?: string; sourceType: "recovery" | "alert" | "control" | "manual"; sourceRef?: string;
  adjustments?: Record<string, unknown>[]; requiresApproval?: boolean;
}) {
  const { has, can } = useApp();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  if (!has("actions") || !can("propose")) return null;
  const create = async () => {
    setState("busy");
    try {
      await api("/actions", { body: { title: title.slice(0, 200), description: description?.slice(0, 1000), source_type: sourceType,
        source_ref: sourceRef?.slice(0, 120), adjustments, requires_approval: requiresApproval } });
      setState("done");
    } catch (e) {
      setState("error");
      setMsg(errorMessage(e));
    }
  };
  if (state === "done") {
    return <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Added as a proposed action. <Link href="/actions" className="font-medium underline">Open Tasks &amp; Approvals</Link></p>;
  }
  return (
    <div className="space-y-1">
      <Button type="button" size="sm" variant="outline" onClick={create} disabled={state === "busy"}>
        {state === "busy" ? <Spinner /> : <ClipboardPlus className="h-4 w-4" />} Propose as action
      </Button>
      {state === "error" && <p className="text-[11px] text-red-600">{msg}</p>}
    </div>
  );
}
