"use client";

import React, { useState } from "react";
import { useApp } from "@/lib/state/store";
import { Building2, Store, User, Users, ChevronDown, Check } from "lucide-react";
import { WorkspaceKind } from "@/types/domain";

export function WorkspaceSwitcher() {
  const { workspaces, activeWorkspace, setActiveWorkspaceId } = useApp();
  const [isOpen, setIsOpen] = useState(false);

  const getIcon = (kind: WorkspaceKind) => {
    switch (kind) {
      case "sme":
        return <Store className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />;
      case "student":
        return <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />;
      case "household":
        return <Users className="w-4 h-4 text-amber-600 dark:text-amber-400" />;
      case "enterprise":
        return <Building2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />;
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className="p-1 rounded bg-slate-100 dark:bg-slate-800">
          {getIcon(activeWorkspace.kind)}
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 leading-tight">
            {activeWorkspace.name}
          </span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
            {activeWorkspace.kind === "sme"
              ? "Hero Demo (SME Kiryana)"
              : activeWorkspace.kind === "student"
              ? "Student Persona"
              : activeWorkspace.kind === "household"
              ? "Household Persona"
              : "Enterprise Persona"}
          </span>
        </div>
        <ChevronDown className="w-4 h-4 text-slate-400 ml-1" />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
          <div
            role="listbox"
            className="absolute left-0 mt-1.5 w-64 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg z-40 py-1.5 animate-in fade-in duration-100"
          >
            <div className="px-3 py-1.5 text-[11px] font-semibold tracking-wider text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
              Select Financial Workspace
            </div>
            {workspaces.map((ws) => {
              const isSelected = ws.id === activeWorkspace.id;
              return (
                <button
                  key={ws.id}
                  onClick={() => {
                    setActiveWorkspaceId(ws.id);
                    setIsOpen(false);
                  }}
                  role="option"
                  aria-selected={isSelected}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${
                    isSelected ? "bg-slate-50 dark:bg-slate-800/60" : ""
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-1 rounded bg-slate-100 dark:bg-slate-800">
                      {getIcon(ws.kind)}
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        {ws.name}
                        {ws.kind === "sme" && (
                          <span className="text-[9px] bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 px-1 rounded font-bold">
                            HERO
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">
                        {ws.description}
                      </div>
                    </div>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-slate-900 dark:text-slate-100" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
