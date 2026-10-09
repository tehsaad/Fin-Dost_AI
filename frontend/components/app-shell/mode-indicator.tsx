"use client";

import React, { useState } from "react";
import { useApp } from "@/lib/state/store";
import { Database, Wifi, WifiOff, RefreshCw, AlertCircle } from "lucide-react";
import { Badge } from "@/components/shared/badge";
import { Modal } from "@/components/shared/modal";
import { Button } from "@/components/shared/button";
import { API_BASE_URL } from "@/lib/api/client";

export function ModeIndicator() {
  const { isDemoMode, setDemoMode, apiStatus, checkApiConnection } = useApp();
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [checking, setChecking] = useState(false);

  const handleTestConnection = async () => {
    setChecking(true);
    await checkApiConnection();
    setChecking(false);
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowConfigModal(true)}
          className="flex items-center gap-2 px-2.5 py-1 rounded text-xs font-medium border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Click to view API & Demo Mode status"
        >
          {isDemoMode ? (
            <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span>Demo Mode</span>
              <span className="text-[10px] text-slate-400 font-mono">(Offline Safe)</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>API Mode</span>
            </span>
          )}

          {apiStatus === "offline" ? (
            <WifiOff className="w-3.5 h-3.5 text-slate-400" />
          ) : apiStatus === "connected" ? (
            <Wifi className="w-3.5 h-3.5 text-emerald-600" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5 text-slate-400 animate-spin" />
          )}
        </button>
      </div>

      <Modal
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
        title="Environment & Data Source Status"
        description="Inspect backend connectivity, demo mode controls, and data fidelity guarantees."
      >
        <div className="space-y-4 text-sm">
          <div className="p-3.5 rounded bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-medium text-slate-700 dark:text-slate-300">Backend API URL</span>
              <code className="text-xs bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 font-mono">
                {API_BASE_URL}
              </code>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-medium text-slate-700 dark:text-slate-300">Backend Status</span>
              {apiStatus === "connected" ? (
                <Badge variant="success">Online & Connected</Badge>
              ) : apiStatus === "checking" ? (
                <Badge variant="warning">Checking Health...</Badge>
              ) : (
                <Badge variant="neutral">Offline / Standalone Fallback</Badge>
              )}
            </div>
            <div className="flex justify-between items-center">
              <span className="font-medium text-slate-700 dark:text-slate-300">Active Engine</span>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {isDemoMode ? "Local Deterministic Synthetic Engine" : "FastAPI HTTP Client"}
              </span>
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2">
            <h4 className="font-medium text-slate-800 dark:text-slate-200">Demo Mode Toggle</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              When Demo Mode is active, all calculations, sample uploads, Udhaar FIFO settlements, and shock simulations run deterministically in browser memory with zero external network requirement.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <Button
                variant={isDemoMode ? "primary" : "outline"}
                size="sm"
                onClick={() => setDemoMode(true)}
              >
                Force Demo Mode (Offline Safe)
              </Button>
              <Button
                variant={!isDemoMode ? "primary" : "outline"}
                size="sm"
                disabled={apiStatus !== "connected"}
                onClick={() => setDemoMode(false)}
              >
                Connect Live API
              </Button>
            </div>
            {apiStatus !== "connected" && (
              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1">
                <AlertCircle className="w-3.5 h-3.5" />
                Live API cannot be connected because no backend server is currently responding on {API_BASE_URL}.
              </p>
            )}
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 pt-3 flex justify-between items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestConnection}
              disabled={checking}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} />
              Test API Health Ping
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setShowConfigModal(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
