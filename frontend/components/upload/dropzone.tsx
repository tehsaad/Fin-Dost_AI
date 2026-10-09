"use client";

import React, { useState, useRef } from "react";
import { UploadCloud, FileText, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { Button } from "@/components/shared/button";
import { Badge } from "@/components/shared/badge";

interface DropzoneProps {
  onFileAccepted: (file: File) => void;
  onSampleRequested: () => void;
  isProcessing: boolean;
}

export function Dropzone({ onFileAccepted, onSampleRequested, isProcessing }: DropzoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastUploadedName, setLastUploadedName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ];

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setErrorMsg(null);

    // Validate size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg("File exceeds maximum allowed size of 10MB.");
      return;
    }

    // Validate extension
    const extension = file.name.split(".").pop()?.toLowerCase();
    const validExtensions = ["jpg", "jpeg", "png", "webp", "pdf", "csv", "xlsx"];
    if (!extension || !validExtensions.includes(extension)) {
      setErrorMsg(
        `Unsupported file type .${extension}. Supported formats: JPG, PNG, PDF, CSV, XLSX.`
      );
      return;
    }

    setLastUploadedName(file.name);
    onFileAccepted(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
          dragOver
            ? "border-slate-900 bg-slate-50 dark:border-slate-400 dark:bg-slate-800/50"
            : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.pdf,.csv,.xlsx"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="p-3 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            <UploadCloud className="w-6 h-6" />
          </div>

          <div>
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Drag & drop financial documents or click to browse
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Supports Urdu & English receipts (JPG, PNG), Bank Statements (PDF), or Ledgers (CSV, XLSX) up to 10MB
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              Select File from Computer
            </Button>
            <span className="text-xs text-slate-400">or</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={onSampleRequested}
              disabled={isProcessing}
            >
              Load Demo Batch (FMCG Sample)
            </Button>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-md bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {lastUploadedName && !errorMsg && (
        <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-500" />
            <span>Uploaded: <strong className="font-mono">{lastUploadedName}</strong></span>
          </div>
          <Badge variant="info">Synthetic Sample Parser</Badge>
        </div>
      )}

      <div className="p-3 rounded-md bg-slate-100/70 dark:bg-slate-800/40 text-[11px] text-slate-600 dark:text-slate-400 flex items-start gap-2 border border-slate-200/60 dark:border-slate-700/60">
        <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
        <div>
          <strong>Extraction Service Transparency:</strong> In this evaluation environment, live cloud OCR APIs are offline. Document uploads trigger a local synthetic parser with realistic OCR confidence values. No private documents or credentials leave your computer.
        </div>
      </div>
    </div>
  );
}
