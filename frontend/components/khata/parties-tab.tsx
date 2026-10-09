"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/shared/button";
import { Card } from "@/components/shared/card";
import { Input } from "@/components/shared/form";
import { Notice } from "@/components/shared/feedback";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { formatPKR } from "@/lib/format";
import { useApp } from "@/components/app/app-provider";

type Party = { id: string; name: string; outstanding_paisa: number };

function PartyList({ title, endpoint, owedLabel }: { title: string; endpoint: string; owedLabel: string }) {
  const { data, reload } = useApi<{ items: Party[] }>(endpoint);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api(endpoint, { body: { name: name.trim() } });
      setName("");
      setErr(null);
      reload();
    } catch (e2) {
      setErr(errorMessage(e2));
    }
  };
  return (
    <Card title={title} subtitle={`${data?.items.length ?? 0} saved`}>
      <form onSubmit={add} className="mb-3 flex gap-2">
        <Input aria-label={`New ${title.toLowerCase()} name`} placeholder="Add a name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="outline"><Plus className="h-4 w-4" /></Button>
      </form>
      {err && <Notice tone="danger" className="mb-3">{err}</Notice>}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {(data?.items ?? []).map((p) => (
          <li key={p.id} className="flex items-center justify-between py-2 text-sm">
            <span className="text-slate-800 dark:text-slate-200">{p.name}</span>
            <span className="tabular text-xs text-slate-500">{p.outstanding_paisa ? `${owedLabel} ${formatPKR(p.outstanding_paisa)}` : "—"}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function PartiesTab() {
  const { has } = useApp();
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {has("receivables") && <PartyList title="Customers" endpoint="/customers" owedLabel="owes you" />}
      <PartyList title="Suppliers & payees" endpoint="/suppliers" owedLabel="you owe" />
    </div>
  );
}
