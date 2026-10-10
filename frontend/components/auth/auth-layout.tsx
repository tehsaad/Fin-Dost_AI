import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { BackendWarmup } from "@/components/backend-warmup";

export function AuthLayout({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <BackendWarmup />
      <div className="relative hidden overflow-hidden bg-slate-950 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -left-20 top-10 h-80 w-80 animate-blob rounded-full bg-brand-500/30 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-96 w-96 animate-blob rounded-full bg-blue-600/20 blur-3xl [animation-delay:-5s]" />
        <Link href="/" className="relative"><Logo light /></Link>
        <div className="relative space-y-6">
          <svg viewBox="0 0 400 160" className="w-full max-w-md" aria-hidden>
            <defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stopColor="#34d399" /><stop offset="1" stopColor="#60a5fa" /></linearGradient></defs>
            <path d="M0 120 C 40 110, 60 70, 100 80 S 160 130, 200 100 S 260 20, 300 50 S 360 110, 400 60" fill="none" stroke="url(#lg)" strokeWidth="4" strokeLinecap="round" strokeDasharray="1200" className="animate-draw-line" />
            <line x1="0" y1="140" x2="400" y2="140" stroke="#ef4444" strokeOpacity="0.5" strokeDasharray="4 6" />
          </svg>
          <h2 className="max-w-md text-3xl font-semibold leading-tight">See cash trouble <span className="text-brand-400">before</span> it happens.</h2>
          <p className="urdu max-w-md text-xl text-slate-300">نقدی کی کمی سے پہلے خبردار ہو جائیں</p>
          <p className="max-w-md text-sm text-slate-400">Digital khata, forecasts, early warnings, shock tests and recovery plans for Pakistani shops, households, students and enterprises.</p>
        </div>
        <p className="relative text-xs text-slate-500">Decision support only · not financial advice · demo data is fictional</p>
      </div>
      <div className="flex flex-col">
        <div className="flex items-center justify-between p-5">
          <Link href="/" className="lg:invisible"><Logo /></Link>
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-5 pb-10">
          <div className="w-full max-w-md animate-fade-up">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
