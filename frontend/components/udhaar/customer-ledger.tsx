"use client";

import React, { useState } from "react";
import { UdhaarRecord } from "@/types/domain";
import { formatMoney } from "@/lib/domain/money";
import { Badge } from "@/components/shared/badge";
import { Button } from "@/components/shared/button";
import { FileText, Phone, Calendar, AlertTriangle, CheckCircle2, DollarSign } from "lucide-react";
import { Modal } from "@/components/shared/modal";

interface CustomerLedgerProps {
  records: UdhaarRecord[];
  onOpenSettlement: (record: UdhaarRecord) => void;
}

export function CustomerLedger({ records, onOpenSettlement }: CustomerLedgerProps) {
  const [evidenceRecord, setEvidenceRecord] = useState<UdhaarRecord | null>(null);

  const getStatusBadge = (rec: UdhaarRecord) => {
    if (rec.status === "settled") {
      return <Badge variant="success">Settled</Badge>;
    }
    if (rec.status === "overdue") {
      return (
        <Badge variant="danger">
          <AlertTriangle className="w-3 h-3 text-red-600" />
          Overdue ({rec.ageBucket})
        </Badge>
      );
    }
    return <Badge variant="neutral">Current ({rec.ageBucket})</Badge>;
  };

  return (
    <>
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-white dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-3.5 py-2.5">Customer / Khata Account</th>
                <th className="px-3.5 py-2.5">Phone / Contact</th>
                <th className="px-3.5 py-2.5">Issued Date</th>
                <th className="px-3.5 py-2.5">Due Date</th>
                <th className="px-3.5 py-2.5">Aging Bucket</th>
                <th className="px-3.5 py-2.5">Outstanding (PKR)</th>
                <th className="px-3.5 py-2.5">Status</th>
                <th className="px-3.5 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {records.map((rec) => (
                <tr
                  key={rec.id}
                  className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors ${
                    rec.status === "settled" ? "opacity-60 bg-slate-50/30" : ""
                  }`}
                >
                  <td className="px-3.5 py-2.5">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {rec.customerName}
                    </div>
                    {rec.notes && (
                      <div className="text-[10px] text-slate-400 truncate max-w-xs">
                        {rec.notes}
                      </div>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5 text-slate-600 dark:text-slate-400 font-mono">
                    {rec.phone || "N/A"}
                  </td>
                  <td className="px-3.5 py-2.5 font-mono text-slate-600 dark:text-slate-400">
                    {rec.issuedAt}
                  </td>
                  <td className="px-3.5 py-2.5 font-mono text-slate-600 dark:text-slate-400">
                    {rec.dueAt || "Rolling"}
                  </td>
                  <td className="px-3.5 py-2.5">
                    <span className="font-mono text-[11px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                      {rec.ageBucket}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 font-bold text-slate-900 dark:text-slate-100">
                    {formatMoney(rec.outstanding)}
                  </td>
                  <td className="px-3.5 py-2.5">{getStatusBadge(rec)}</td>
                  <td className="px-3.5 py-2.5 text-right space-x-1.5">
                    <button
                      onClick={() => setEvidenceRecord(rec)}
                      className="p-1.5 rounded text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                      title="Inspect synthetic khata page reference"
                    >
                      <FileText className="w-3.5 h-3.5" />
                    </button>
                    {rec.status !== "settled" && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => onOpenSettlement(rec)}
                      >
                        <DollarSign className="w-3 h-3 mr-0.5" />
                        Settle
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Synthetic Khata Evidence Modal */}
      {evidenceRecord && (
        <Modal
          isOpen={!!evidenceRecord}
          onClose={() => setEvidenceRecord(null)}
          title={`Khata Evidence Record: ${evidenceRecord.customerName}`}
          description={`Synthetic ledger reference ${evidenceRecord.sourceRef}`}
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 space-y-1 font-mono">
              <div className="flex justify-between">
                <span>Account Holder:</span>
                <strong>{evidenceRecord.customerName}</strong>
              </div>
              <div className="flex justify-between">
                <span>Synthetic Physical Ledger Leaf:</span>
                <strong className="text-blue-600 dark:text-blue-400">{evidenceRecord.sourceRef}</strong>
              </div>
              <div className="flex justify-between">
                <span>Date Account Opened:</span>
                <span>{evidenceRecord.issuedAt}</span>
              </div>
              <div className="flex justify-between">
                <span>Payment Terms:</span>
                <span>Net-30 Days rolling</span>
              </div>
            </div>

            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200">
              <div className="font-semibold mb-1">Commercial Notes:</div>
              <p>{evidenceRecord.notes || "Standard customer credit agreement."}</p>
            </div>

            <div className="text-right pt-2">
              <Button variant="secondary" size="sm" onClick={() => setEvidenceRecord(null)}>
                Close Evidence View
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
