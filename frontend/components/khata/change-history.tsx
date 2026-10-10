"use client";

import { History } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { formatPKR } from "@/lib/format";

interface AuditEvent { id: string; action: string; changes: { fields?: Record<string, { from: unknown; to: unknown }> }; at: string }

const FIELD_LABEL: Record<string, string> = { occurred_on: "date", amount_paisa: "amount", description: "description",
  category: "category", account: "account", to_account: "to account" };

function show(field: string, v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  return field.endsWith("_paisa") && typeof v === "number" ? formatPKR(v, { decimals: v % 100 !== 0 }) : String(v);
}

/** Read-only change history of one ledger record (from the backend audit trail). */
export function ChangeHistory({ entityId }: { entityId: string }) {
  const { data } = useApi<{ items: AuditEvent[] }>(`/audit?entity_id=${encodeURIComponent(entityId)}&limit=20`);
  if (!data || data.items.length === 0) return null;
  return (
    <details className="mt-4 rounded-md border border-slate-200 p-3 text-xs dark:border-slate-800">
      <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-slate-600 dark:text-slate-300"><History className="h-3.5 w-3.5" /> Change history ({data.items.length})</summary>
      <ul className="mt-2 space-y-1.5">
        {data.items.map((e) => (
          <li key={e.id} className="text-slate-600 dark:text-slate-400">
            <span className="text-slate-400">{new Date(e.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span> · {e.action}
            {e.changes.fields && Object.entries(e.changes.fields).map(([f, c]) => (
              <span key={f}> · {FIELD_LABEL[f] ?? f}: {show(f, c.from)} → {show(f, c.to)}</span>
            ))}
          </li>
        ))}
      </ul>
    </details>
  );
}
