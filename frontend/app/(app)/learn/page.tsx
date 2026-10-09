"use client";

import { PageHeader } from "@/components/app/shell";
import { ErrorState, PageSkeleton } from "@/components/shared/feedback";
import { useApi } from "@/lib/hooks";

interface Term { term: string; urdu: string; simple: string; urdu_simple: string }

export default function LearnPage() {
  const { data, error, reload } = useApi<{ terms: Term[] }>("/glossary");
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  return (
    <div className="space-y-6">
      <PageHeader title="Money words, made simple" urdu="آسان مالی الفاظ" description="Plain explanations of the terms FinDost uses — in English and Urdu." />
      <div className="grid gap-4 md:grid-cols-2">
        {data.terms.map((t) => (
          <div key={t.term} className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t.term}</h2>
              <span className="urdu text-lg text-brand-700 dark:text-brand-400" lang="ur">{t.urdu}</span>
            </div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t.simple}</p>
            <p className="urdu mt-2 text-base text-slate-700 dark:text-slate-200" lang="ur">{t.urdu_simple}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
