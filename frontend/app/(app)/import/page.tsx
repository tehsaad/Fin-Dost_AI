"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, Download, FileSpreadsheet, Pencil, RefreshCw, UploadCloud, XCircle } from "lucide-react";
import { PageHeader } from "@/components/app/shell";
import { Card } from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { Select } from "@/components/shared/form";
import { Notice, Spinner, Tabs } from "@/components/shared/feedback";
import { RowEditor, type ImportRow, type ImportSummary } from "@/components/import/row-editor";
import type { AiStatus } from "@/components/app/ai-status";
import { useApi } from "@/lib/hooks";
import { api, errorMessage } from "@/lib/api";
import { cn, formatPKR, KIND_LABEL } from "@/lib/format";

const FIELDS: { id: string; label: string }[] = [
  { id: "date", label: "Date *" }, { id: "amount", label: "Amount" }, { id: "debit", label: "Debit (money out)" },
  { id: "credit", label: "Credit (money in)" }, { id: "type", label: "Type (in/out…)" }, { id: "description", label: "Description" },
  { id: "category", label: "Category" }, { id: "account", label: "Account / method" }, { id: "party", label: "Customer / supplier" },
  { id: "due_date", label: "Due date" }, { id: "reference", label: "Reference" },
];
const MAX_BYTES = 2 * 1024 * 1024;

type PreviewRow = ImportRow;
interface Preview {
  batch_id: string;
  filename: string;
  adapter: string;
  adapter_label: string;
  mapping: Record<string, string>;
  headers: string[];
  day_first: boolean;
  rows: PreviewRow[];
  summary: ImportSummary;
  extraction?: { provider: string; confidence: number; document_type: string; line_items: { description: string; amount_paisa: number | null }[] };
}
interface ConfirmResult { imported: number; skipped_duplicates: number; skipped_by_user: number; rejected: number; unmatched_payments: number; duplicates_included: number }

const TEMPLATES = [
  { name: "findost-template.csv", label: "FinDost template", hint: "date, type, amount, category… incl. credit sales" },
  { name: "bank-statement-sample.csv", label: "Bank statement sample", hint: "Debit / Credit columns, DD/MM/YYYY" },
  { name: "messy-sample.csv", label: "Messy sample", hint: "Roman Urdu headers, bad rows, a duplicate" },
];

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [forced, setForced] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<PreviewRow | null>(null);
  const [filter, setFilter] = useState<"all" | "accepted" | "rejected" | "duplicate">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef<HTMLInputElement>(null);
  const aiStatus = useApi<AiStatus>("/ai/status").data;

  const uploadReceipt = async (f: File) => {
    setError(null);
    setResult(null);
    if (f.size > 4 * 1024 * 1024) return setError("The photo is larger than 4 MB. Take a smaller photo.");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const p = await api<Preview>("/import/receipt", { form });
      setFile(null);
      setPreview(p);
      setMapping({});
      setExcluded(new Set());
      setForced(new Set());
      setFilter("all");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (f: File, map?: Record<string, string>) => {
    setError(null);
    setResult(null);
    if (!f.name.toLowerCase().endsWith(".csv")) return setError("Please choose a .csv file (save Excel sheets as CSV first).");
    if (f.size > MAX_BYTES) return setError("The file is larger than 2 MB. Split it into smaller files.");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f);
      if (map) form.append("mapping", JSON.stringify(Object.fromEntries(Object.entries(map).filter(([, v]) => v))));
      const p = await api<Preview>("/import/preview", { form });
      setFile(f);
      setPreview(p);
      setMapping(p.mapping);
      setExcluded(new Set());
      setForced(new Set());
      setFilter("all");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api<ConfirmResult>("/import/confirm", { body: { batch_id: preview.batch_id, exclude_rows: [...excluded], include_duplicates: [...forced] } }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const rows = useMemo(() => (preview?.rows ?? []).filter((r) => filter === "all" || r.status === filter), [preview, filter]);
  const forcedDuplicates = (preview?.rows ?? []).filter((r) => r.status === "duplicate" && forced.has(r.row_number)).length;
  const toImport = preview ? preview.summary.accepted - [...excluded].filter((n) => preview.rows.some((r) => r.row_number === n && r.status === "accepted")).length + forcedDuplicates : 0;
  const step = result ? 3 : preview ? 2 : 1;

  return (
    <div className="space-y-6">
      <PageHeader title="Import financial data" urdu="ڈیٹا شامل کریں" description="Upload a CSV from your bank, wallet or spreadsheet. FinDost maps columns, normalises dates and amounts, categorises, and flags invalid rows and duplicates — nothing is saved until you confirm." />

      <ol className="flex flex-wrap gap-2 text-xs" aria-label="Import steps">
        {["Upload", "Review & map", "Imported"].map((s, i) => (
          <li key={s} className={cn("flex items-center gap-2 rounded-full border px-3 py-1",
            step === i + 1 ? "border-brand-600 bg-brand-50 font-semibold text-brand-800 dark:bg-brand-950/40 dark:text-brand-300" : step > i + 1 ? "border-emerald-200 text-emerald-700" : "border-slate-200 text-slate-500 dark:border-slate-700")}>
            <span className="tabular">{i + 1}</span> {s}
          </li>
        ))}
      </ol>

      {error && <Notice tone="danger">{error}</Notice>}

      {step === 1 && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
              className={cn("flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center transition",
                dragging ? "border-brand-500 bg-brand-50/60 dark:bg-brand-950/30" : "border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900")}
            >
              <UploadCloud className="mb-3 h-10 w-10 text-brand-600" />
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Drag a CSV file here</p>
              <p className="mt-1 text-xs text-slate-500">.csv only · up to 2 MB · up to 5,000 rows</p>
              <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
              <Button className="mt-4" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? <Spinner /> : <FileSpreadsheet className="h-4 w-4" />} Choose file</Button>
            </div>
          </div>
          <Card title="Sample templates" subtitle="Download, fill in, upload">
            <ul className="space-y-3">
              {TEMPLATES.map((t) => (
                <li key={t.name}>
                  <a href={`/api/v1/import/templates/${t.name}`} download className="group flex items-start gap-3 rounded-md border border-slate-100 p-2.5 hover:border-slate-300 dark:border-slate-800">
                    <Download className="mt-0.5 h-4 w-4 text-slate-400 group-hover:text-brand-600" />
                    <span><span className="block text-sm font-medium text-slate-800 dark:text-slate-200">{t.label}</span><span className="text-[11px] text-slate-500">{t.hint}</span></span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[11px] leading-relaxed text-slate-500">Dates like 05/06/2026 are read day-first (Pakistani style) unless the file shows otherwise; ISO dates (2026-06-05) are never swapped. Amounts like &quot;Rs. 1,25,000&quot; and &quot;(500)&quot; are understood.</p>
          </Card>
          <Card title="Receipt or bill photo" subtitle="Optional · read by AI, reviewed by you" className="lg:col-span-3">
            {!aiStatus ? <Spinner /> : !aiStatus.tasks.extract_receipt.available ? (
              <p className="text-xs text-slate-500">Not available on this server (no Gemini key configured). CSV import above works without AI.</p>
            ) : !aiStatus.consent ? (
              <p className="text-xs text-slate-500">Turn on <Link href="/settings" className="font-medium text-brand-700 underline">AI assistance in Settings</Link> first: the photo is sent to Google Gemini to be read.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <input ref={receiptRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadReceipt(f); e.target.value = ""; }} />
                <Button variant="outline" onClick={() => receiptRef.current?.click()} disabled={busy}>{busy ? <Spinner /> : <Camera className="h-4 w-4" />} Upload receipt / bill</Button>
                <p className="text-xs text-slate-500">JPG, PNG, WEBP or PDF, up to 4 MB. The amount and date are a <strong>proposal</strong>: check them, correct anything wrong, then import. Unclear photos are held back until you fix them.</p>
              </div>
            )}
          </Card>
        </div>
      )}

      {step === 2 && preview && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ["Rows read", preview.summary.total_rows, "text-slate-900 dark:text-white"],
              ["Ready to import", toImport, "text-emerald-600"],
              ["Rejected", preview.summary.rejected, "text-red-600"],
              ["Duplicates", preview.summary.duplicates, "text-amber-600"],
              ["Auto-categorised", preview.summary.auto_categorized, "text-blue-600"],
            ].map(([l, v, c]) => (
              <div key={l as string} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">{l}</p><p className={cn("tabular text-2xl font-semibold", c as string)}>{v}</p>
              </div>
            ))}
          </div>

          {preview.extraction && (
            <Notice tone="warning">
              Read by AI ({preview.extraction.provider}) with {Math.round(preview.extraction.confidence * 100)}% confidence as a {preview.extraction.document_type}.
              {preview.extraction.line_items.length > 0 && ` Line items: ${preview.extraction.line_items.map((li) => `${li.description}${li.amount_paisa !== null ? ` ${formatPKR(li.amount_paisa, { decimals: true })}` : ""}`).join("; ")}.`}
              {" "}Check the row below against the paper before importing — use the pencil to correct it.
            </Notice>
          )}
          {!preview.extraction && <Card title={`Detected format: ${preview.adapter_label}`} subtitle={`${preview.filename} · dates read ${preview.day_first ? "day-first (DD/MM)" : "month-first (MM/DD)"} · cash in ${formatPKR(preview.summary.cash_in_paisa)}, out ${formatPKR(preview.summary.cash_out_paisa)}`}
            action={<Button size="sm" variant="outline" disabled={busy || !file} onClick={() => file && upload(file, mapping)}>{busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Re-check with this mapping</Button>}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
              {FIELDS.map((f) => (
                <label key={f.id} className="space-y-1 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  {f.label}
                  <Select value={mapping[f.id] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.id]: e.target.value })} className="py-1.5 text-xs">
                    <option value="">— not in file —</option>
                    {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </label>
              ))}
            </div>
          </Card>}

          <Card title="Preview of normalised records" subtitle="Untick rows you don't want. Fix rejected rows with the pencil. Duplicates are skipped unless you tick “import anyway” (e.g. two genuine identical sales)."
            action={<Tabs tabs={[{ id: "all", label: "All", count: preview.rows.length }, { id: "accepted", label: "Ready", count: preview.summary.accepted }, { id: "rejected", label: "Rejected", count: preview.summary.rejected }, { id: "duplicate", label: "Duplicates", count: preview.summary.duplicates }]} value={filter} onChange={setFilter} />}>
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white text-left uppercase tracking-wide text-slate-500 dark:bg-slate-900">
                  <tr><th className="py-2 pr-2">Import</th><th className="py-2 pr-2"><span className="sr-only">Edit</span></th><th className="py-2 pr-2">Row</th><th className="py-2 pr-2">Status</th><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Type</th><th className="py-2 pr-2 text-right">Amount</th><th className="py-2 pr-2">Category</th><th className="py-2 pr-2">Description</th><th className="py-2">Notes</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.map((r) => (
                    <tr key={r.row_number} className={cn(r.status !== "accepted" && "bg-slate-50/70 dark:bg-slate-800/20")}>
                      <td className="py-2 pr-2">
                        {r.status === "duplicate" ? (
                          <label className="flex items-center gap-1 text-[10px] text-amber-700">
                            <input type="checkbox" aria-label={`Import duplicate row ${r.row_number} anyway`} checked={forced.has(r.row_number)}
                              onChange={(e) => { const next = new Set(forced); if (e.target.checked) next.add(r.row_number); else next.delete(r.row_number); setForced(next); }} />
                            anyway
                          </label>
                        ) : (
                          <input type="checkbox" aria-label={`Import row ${r.row_number}`} disabled={r.status !== "accepted"} checked={r.status === "accepted" && !excluded.has(r.row_number)}
                            onChange={(e) => { const next = new Set(excluded); if (e.target.checked) next.delete(r.row_number); else next.add(r.row_number); setExcluded(next); }} />
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <button type="button" onClick={() => setEditing(r)} aria-label={`Correct row ${r.row_number}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </td>
                      <td className="tabular py-2 pr-2 text-slate-400">{r.row_number}</td>
                      <td className="py-2 pr-2">
                        {r.status === "accepted" ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Ready</span>
                          : r.status === "duplicate" ? <span className="text-amber-700">Duplicate</span>
                          : <span className="inline-flex items-center gap-1 text-red-700"><XCircle className="h-3.5 w-3.5" />Rejected</span>}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-2">{r.date ?? "—"}</td>
                      <td className="whitespace-nowrap py-2 pr-2">{r.kind ? KIND_LABEL[r.kind] ?? r.kind : "—"}</td>
                      <td className="tabular whitespace-nowrap py-2 pr-2 text-right">{r.amount_paisa !== null ? formatPKR(r.amount_paisa, { decimals: r.amount_paisa % 100 !== 0 }) : "—"}</td>
                      <td className="py-2 pr-2">{r.category ?? "—"}{r.category_reason && <p className="text-[10px] text-slate-400">{r.category_reason}</p>}</td>
                      <td className="max-w-[180px] truncate py-2 pr-2">{r.description || "—"}{r.party && <p className="text-[10px] text-slate-400">{r.party}</p>}</td>
                      <td className="py-2 text-[11px]">
                        {r.corrected && <p className="text-blue-600">corrected by you</p>}
                        {r.reasons.map((x) => <p key={x} className={r.status === "duplicate" ? "text-amber-700" : "text-red-600"}>{x}</p>)}
                        {r.warnings.map((x) => <p key={x} className="text-amber-600">{x}</p>)}
                        {r.settles?.type && <p className="text-emerald-700">settles an open {r.settles.type === "receivable" ? "invoice" : "bill"}</p>}
                        {r.settles && !r.settles.type && <p className="text-amber-700">{r.settles.note}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => { setPreview(null); setFile(null); }}>Start over</Button>
            <Button onClick={confirm} disabled={busy || toImport <= 0}>{busy && <Spinner />}Import {toImport} rows</Button>
          </div>
          {editing && (
            <RowEditor batchId={preview.batch_id} row={editing} onClose={() => setEditing(null)}
              onSaved={(updated, summary) => setPreview({ ...preview, rows: updated, summary })} />
          )}
        </div>
      )}

      {step === 3 && result && (
        <Card>
          <div className="flex flex-col items-center py-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-600" />
            <h2 className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">{result.imported} transactions imported</h2>
            <p className="mt-1 text-sm text-slate-500">{result.skipped_duplicates} duplicates skipped{result.duplicates_included > 0 && ` · ${result.duplicates_included} confirmed duplicates imported`} · {result.rejected} rejected · {result.skipped_by_user} skipped by you</p>
            {result.unmatched_payments > 0 && <p className="mt-1 text-xs text-amber-700">{result.unmatched_payments} payment(s) had no matching open invoice/bill and were recorded as income/expense.</p>}
            <div className="mt-5 flex gap-2">
              <Link href="/transactions"><Button variant="outline">Open khata</Button></Link>
              <Link href="/forecast"><Button>See updated forecast</Button></Link>
              <Button variant="ghost" onClick={() => { setResult(null); setPreview(null); setFile(null); }}>Import another file</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
