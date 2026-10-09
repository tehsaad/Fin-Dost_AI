import React from "react";
import { cn } from "@/lib/format";

const control =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

export function Field({ label, hint, error, children, className, htmlFor }: {
  label: string; hint?: string; error?: string | null; children: React.ReactNode; className?: string; htmlFor?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-700 dark:text-slate-300">{label}</label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(control, className)} {...props} />,
);
Input.displayName = "Input";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(control, "pr-8", className)} {...props}>{children}</select>
  ),
);
Select.displayName = "Select";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(control, "min-h-[80px]", className)} {...props} />,
);
Textarea.displayName = "Textarea";

export function Toggle({ checked, onChange, label, description, id }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; id: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</label>
        {description && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn("relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40",
          checked ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-700")}
      >
        <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow transition", checked ? "translate-x-5" : "translate-x-0")} />
      </button>
    </div>
  );
}
