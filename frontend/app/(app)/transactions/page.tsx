"use client";

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/app/shell";
import { useApp } from "@/components/app/app-provider";
import { Tabs } from "@/components/shared/feedback";
import { TransactionsTab } from "@/components/khata/transactions-tab";
import { ReceivablesTab } from "@/components/khata/receivables-tab";
import { PayablesTab } from "@/components/khata/payables-tab";
import { PartiesTab } from "@/components/khata/parties-tab";

type Tab = "transactions" | "receivables" | "payables" | "parties";

function Khata() {
  const { has } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initial = (params.get("tab") as Tab) ?? "transactions";
  const [tab, setTab] = useState<Tab>(initial === "receivables" && !has("receivables") ? "transactions" : initial);
  const tabs: { id: Tab; label: string }[] = [
    { id: "transactions", label: "Transactions" },
    ...(has("receivables") ? [{ id: "receivables" as Tab, label: "Udhaar (receivables)" }] : []),
    { id: "payables", label: "Bills & payables" },
    { id: "parties", label: has("receivables") ? "Customers & suppliers" : "Payees" },
  ];
  const change = (t: Tab) => {
    setTab(t);
    router.replace(`${pathname}?tab=${t}`, { scroll: false });
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Digital Khata" urdu="ڈیجیٹل کھاتہ" description="Every rupee in and out, what customers owe you and what you owe others. Revenue, cash received, expenses and liabilities are kept separate." />
      <Tabs tabs={tabs} value={tab} onChange={change} />
      {tab === "transactions" && <TransactionsTab />}
      {tab === "receivables" && <ReceivablesTab />}
      {tab === "payables" && <PayablesTab />}
      {tab === "parties" && <PartiesTab />}
    </div>
  );
}

export default function TransactionsPage() {
  return <Suspense><Khata /></Suspense>;
}
