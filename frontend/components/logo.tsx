export function Logo({ className = "", light = false }: { className?: string; light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 64 64" className="h-8 w-8" aria-hidden>
        <rect width="64" height="64" rx="14" fill="#059669" />
        <path d="M14 44 L26 32 L34 38 L50 20" stroke="#fff" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="50" cy="20" r="4" fill="#fff" />
      </svg>
      <span className={`text-base font-bold tracking-tight ${light ? "text-white" : "text-slate-900 dark:text-white"}`}>
        FinDost <span className="text-brand-600 dark:text-brand-400">AI</span>
      </span>
    </span>
  );
}
