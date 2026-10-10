"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView, useReducedMotion } from "framer-motion";
import {
  ArrowRight, BellRing, Bot, Building2, CheckCircle2, FileUp, GraduationCap, Home, Languages, LifeBuoy, LineChart,
  NotebookPen, ShieldCheck, Sparkles, Store, TrendingDown, Zap,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/format";

const MODULES = ["Digital Khata", "Udhaar tracking", "CSV import", "Cash-flow forecast", "Early warnings", "Shock simulator",
  "Recovery plans", "What-if decisions", "Inventory insights", "Printable reports", "Urdu Copilot", "SDG impact"];

const STEPS = [
  { t: "Input", d: "Khata entries, CSV statements, bills and udhaar" },
  { t: "Analyze", d: "Exact paisa ledger, cash vs revenue vs credit" },
  { t: "Predict", d: "Back-tested daily forecast with uncertainty" },
  { t: "Explain", d: "Every alert shows its evidence and limits" },
  { t: "Recommend", d: "Recovery options priced by the engine" },
  { t: "Simulate", d: "Floods, price rises, late customers" },
  { t: "Measure", d: "Held-out benchmark, honest SDG framing" },
];

const FEATURES = [
  { icon: NotebookPen, title: "Digital Khata", urdu: "ڈیجیٹل کھاتہ", text: "Sales, expenses, udhaar and supplier credit in one ledger. A credit sale is revenue — but never confused with cash." },
  { icon: LineChart, title: "Cash-flow forecasting", urdu: "پیشگوئی", text: "Daily projections for 7, 14 and 30+ days from your real bills, invoices and patterns — with a back-tested error band." },
  { icon: BellRing, title: "Early warnings", urdu: "انتباہ", text: "Shortages, reserve breaches, overdue customers, bill spikes and unusual entries — each with evidence and next steps." },
  { icon: Zap, title: "Shock simulator", urdu: "جھٹکا ٹیسٹ", text: "What if sales drop 20%, a flood closes the shop, or your biggest customer pays late? See the new low point and date." },
  { icon: LifeBuoy, title: "Recovery strategies", urdu: "بحالی", text: "Collect, renegotiate, delay or cut — every option re-runs the forecast and is ranked by your own priorities." },
  { icon: Bot, title: "Urdu Copilot", urdu: "مددگار", text: "“Kya main agle hafte 50,000 kharch kar sakta hoon?” Answers come from your numbers, never made up." },
  { icon: FileUp, title: "Smart CSV import", urdu: "ڈیٹا شامل کریں", text: "Bank and wallet exports, Roman Urdu headers, Rs. formats and DD/MM dates — validated and de-duplicated." },
  { icon: ShieldCheck, title: "Private by design", urdu: "رازداری", text: "Each login sees only its own data. No bank passwords. AI is used only with your consent, with customer names masked: it can help understand a Copilot question and word the answer, but never calculates your figures." },
  { icon: Languages, title: "Made for Pakistan", urdu: "پاکستان کے لیے", text: "PKR everywhere, lakh/crore summaries, Urdu explanations and simple words for profit, udhaar and cash flow." },
];

const AUDIENCE = [
  { kind: "sme", icon: Store, title: "Shops & small businesses", urdu: "دکاندار", text: "Kiryana, retail, home-based and micro-businesses with udhaar and supplier credit." },
  { kind: "enterprise", icon: Building2, title: "Enterprises", urdu: "ادارے", text: "Larger operations with export buyers, raw-material contracts and payroll." },
  { kind: "household", icon: Home, title: "Households", urdu: "گھرانے", text: "Salary, rent, school fees, bills and committees — before the month runs out." },
  { kind: "student", icon: GraduationCap, title: "Students", urdu: "طلبہ", text: "Allowance, tutoring income, hostel fees and exam costs, planned ahead." },
];

const SDGS = [
  { t: "1.4", c: "#E5243B", d: "Access to financial services" },
  { t: "1.5", c: "#E5243B", d: "Resilience to shocks" },
  { t: "8.3", c: "#A21942", d: "Support for micro & small enterprises" },
  { t: "9.3", c: "#FD6925", d: "Small enterprises' access to finance" },
  { t: "10.2", c: "#DD1367", d: "Inclusion" },
];

function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={reduce ? false : { opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.6, delay, ease: [0.21, 0.47, 0.32, 0.98] }}>
      {children}
    </motion.div>
  );
}

function Counter({ value, suffix = "", decimals = 0 }: { value: number; suffix?: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, value, { duration: 1.6, ease: "easeOut", onUpdate: (v) => setShown(v) });
    return () => controls.stop();
  }, [inView, value]);
  return <span ref={ref} className="tabular">{shown.toFixed(decimals)}{suffix}</span>;
}

function HeroVisual() {
  const reduce = useReducedMotion();
  const chips = [
    { cls: "left-0 top-6 md:-left-10", delay: 0.9, icon: TrendingDown, tone: "text-red-500", title: "Shortage in 9 days", sub: "Lowest point −Rs. 128,782" },
    { cls: "right-0 top-28 md:-right-8", delay: 1.3, icon: BellRing, tone: "text-amber-500", title: "Rs. 215,000 udhaar overdue", sub: "4 customers · oldest 95 days" },
    { cls: "bottom-4 left-6 md:-left-6", delay: 1.7, icon: CheckCircle2, tone: "text-emerald-500", title: "Plan removes the shortage", sub: "Collect + renegotiate + clear stock" },
  ];
  return (
    <div className="relative mx-auto w-full max-w-lg">
      <motion.div initial={reduce ? false : { opacity: 0, scale: 0.96, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.2 }}
        className="relative rounded-2xl border border-white/10 bg-white/80 p-5 shadow-2xl shadow-brand-900/10 backdrop-blur-xl dark:bg-slate-900/80">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">30-day cash forecast</p>
            <p className="text-2xl font-semibold text-slate-900 dark:text-white">Rs. 118,000 <span className="text-xs font-normal text-slate-500">today</span></p>
          </div>
          <span className="rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-bold uppercase text-red-700 dark:bg-red-900/40 dark:text-red-300">High risk</span>
        </div>
        <svg viewBox="0 0 400 180" className="mt-4 w-full" aria-hidden>
          <defs>
            <linearGradient id="hero-line" x1="0" x2="1"><stop offset="0" stopColor="#64748b" /><stop offset="0.35" stopColor="#2563eb" /><stop offset="1" stopColor="#059669" /></linearGradient>
            <linearGradient id="hero-band" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b82f6" stopOpacity="0.18" /><stop offset="1" stopColor="#3b82f6" stopOpacity="0.02" /></linearGradient>
          </defs>
          {[30, 70, 110, 150].map((y) => <line key={y} x1="0" x2="400" y1={y} y2={y} stroke="#94a3b8" strokeOpacity="0.15" />)}
          <line x1="0" x2="400" y1="120" y2="120" stroke="#dc2626" strokeDasharray="4 5" strokeOpacity="0.8" />
          <path d="M140 70 C 180 60, 200 150, 240 160 S 290 70, 330 60 S 380 40, 400 35 L 400 80 C 380 85, 340 110, 300 120 S 250 110, 240 135 S 180 95, 140 80 Z" fill="url(#hero-band)" />
          <path d="M0 60 C 30 70, 60 50, 90 66 S 130 72, 140 74 C 180 64, 200 148, 240 158 S 290 82, 330 66 S 380 52, 400 50"
            fill="none" stroke="url(#hero-line)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="1200" className="animate-draw-line" />
          <circle cx="240" cy="158" r="6" fill="#dc2626" className="origin-center" style={{ transformBox: "fill-box" }}>
            <animate attributeName="r" values="5;9;5" dur="1.8s" repeatCount="indefinite" />
          </circle>
          <text x="248" y="176" fontSize="10" fill="#dc2626">cash short</text>
          <line x1="140" x2="140" y1="20" y2="170" stroke="#94a3b8" strokeDasharray="2 4" />
          <text x="112" y="16" fontSize="10" fill="#94a3b8">today</text>
        </svg>
      </motion.div>
      {chips.map((c) => (
        <motion.div key={c.title} initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: c.delay }}
          className={cn("absolute hidden animate-float rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg dark:border-slate-700 dark:bg-slate-900 sm:block", c.cls)}
          style={{ animationDelay: `${c.delay}s` }}>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-white"><c.icon className={cn("h-3.5 w-3.5", c.tone)} />{c.title}</p>
          <p className="text-[10px] text-slate-500">{c.sub}</p>
        </motion.div>
      ))}
      <p className="mt-3 text-center text-[10px] text-slate-500">Illustration from the fictional demo shop (Bilal General Store)</p>
    </div>
  );
}

interface Bench {
  businesses_evaluated: number; horizon_days: number; accuracy_pct: number; recall_pct: number; false_positive_rate_pct: number;
  naive_recall_pct: number; naive_false_positive_rate_pct: number; avg_warning_lead_days: number | null; note: string;
}

export default function Landing() {
  const [bench, setBench] = useState<Bench | null | "unavailable">(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    fetch("/api/v1/public/benchmark").then((r) => (r.ok ? r.json() : "unavailable")).then(setBench).catch(() => setBench("unavailable"));
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-white text-slate-900 dark:bg-[#070b14] dark:text-white">
      <header className={cn("fixed inset-x-0 top-0 z-50 transition-all", scrolled ? "border-b border-slate-200/70 bg-white/80 backdrop-blur-xl dark:border-slate-800/70 dark:bg-[#070b14]/80" : "bg-transparent")}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
          <Link href="/" aria-label="FinDost home"><Logo /></Link>
          <nav className="hidden items-center gap-7 text-sm text-slate-600 dark:text-slate-300 md:flex" aria-label="Sections">
            <a href="#how" className="hover:text-slate-900 dark:hover:text-white">How it works</a>
            <a href="#features" className="hover:text-slate-900 dark:hover:text-white">Features</a>
            <a href="#for-whom" className="hover:text-slate-900 dark:hover:text-white">Who it&apos;s for</a>
            <a href="#impact" className="hover:text-slate-900 dark:hover:text-white">Impact</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/login" className="hidden rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 sm:block">Sign in</Link>
            <Link href="/signup" className="rounded-md bg-slate-900 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 dark:bg-white dark:text-slate-900">Get started</Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative pb-20 pt-32 md:pt-40">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-32 top-0 h-[28rem] w-[28rem] animate-blob rounded-full bg-brand-300/40 blur-3xl dark:bg-brand-600/20" />
          <div className="absolute right-0 top-20 h-[26rem] w-[26rem] animate-blob rounded-full bg-sky-300/40 blur-3xl [animation-delay:-4s] dark:bg-blue-700/20" />
          <div className="absolute bottom-0 left-1/3 h-72 w-72 animate-blob rounded-full bg-amber-200/40 blur-3xl [animation-delay:-8s] dark:bg-amber-600/10" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_75%)]" />
        </div>
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 lg:grid-cols-2">
          <div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50/80 px-3 py-1 text-xs font-medium text-brand-800 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-300">
              <Sparkles className="h-3.5 w-3.5" /> AICON&apos;26 · Financial intelligence built for Pakistan
            </motion.div>
            <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1 }}
              className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              See cash trouble <span className="bg-gradient-to-r from-brand-600 via-emerald-500 to-sky-500 bg-clip-text text-transparent">before</span> it happens.
            </motion.h1>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7, delay: 0.3 }} className="urdu mt-4 text-2xl text-slate-600 dark:text-slate-300" lang="ur">
              نقدی کی کمی سے پہلے خبردار — اور بچاؤ کا منصوبہ بھی
            </motion.p>
            <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.4 }} className="mt-4 max-w-xl text-lg text-slate-600 dark:text-slate-400">
              FinDost turns your khata into a forecast, warns you weeks ahead, stress-tests your business against real shocks and compares recovery plans — with every number traceable to your own records.
            </motion.p>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.55 }} className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className="group inline-flex items-center gap-2 rounded-lg bg-brand-700 px-5 py-3 text-sm font-semibold text-white shadow-glow transition hover:bg-brand-800">
                Create free account <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link href="/login" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white/70 px-5 py-3 text-sm font-semibold text-slate-800 backdrop-blur transition hover:bg-white dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100">
                Try a demo account
              </Link>
            </motion.div>
            <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-500">
              {["PKR & lakh/crore", "Urdu explanations", "No bank logins needed", "Works without paid AI"].map((t) => (
                <li key={t} className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-brand-600" />{t}</li>
              ))}
            </motion.ul>
          </div>
          <HeroVisual />
        </div>
      </section>

      {/* MARQUEE */}
      <section className="border-y border-slate-200 bg-slate-50/80 py-4 dark:border-slate-800 dark:bg-slate-900/40" aria-label="Modules">
        <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
          <div className="flex w-max animate-marquee gap-10">
            {[...MODULES, ...MODULES].map((m, i) => (
              <span key={i} className="flex items-center gap-2 whitespace-nowrap text-sm font-medium text-slate-500 dark:text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-brand-500" />{m}</span>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-600">How it works</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">From a paper khata to a plan</h2>
          <p className="mt-3 text-slate-600 dark:text-slate-400">AI that does the maths, not just the talking. Each step produces numbers you can check.</p>
        </Reveal>
        <div className="relative mt-14">
          <div className="absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-brand-300 to-transparent lg:block dark:via-brand-700" />
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-7">
            {STEPS.map((s, i) => (
              <Reveal key={s.t} delay={i * 0.08} className="relative text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border-4 border-white bg-brand-600 text-sm font-bold text-white shadow-lg dark:border-[#070b14]">{i + 1}</div>
                <p className="mt-3 font-semibold">{s.t}</p>
                <p className="mt-1 text-xs text-slate-500">{s.d}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="scroll-mt-20 bg-slate-50 py-24 dark:bg-slate-950/60">
        <div className="mx-auto max-w-7xl px-5">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-brand-600">Features</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Everything a small business needs to stay afloat</h2>
          </Reveal>
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 0.08}>
                <div className="group h-full rounded-2xl border border-slate-200 bg-white p-6 transition duration-300 hover:-translate-y-1 hover:border-brand-300 hover:shadow-glow dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <div className="rounded-xl bg-brand-50 p-2.5 text-brand-700 transition group-hover:scale-110 group-hover:bg-brand-600 group-hover:text-white dark:bg-brand-950/50 dark:text-brand-400"><f.icon className="h-5 w-5" /></div>
                    <span className="urdu text-sm text-slate-400" lang="ur">{f.urdu}</span>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{f.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* MEASURED */}
      <section className="mx-auto max-w-7xl px-5 py-24">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-slate-950 px-6 py-14 text-white md:px-14">
            <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 animate-blob rounded-full bg-brand-500/30 blur-3xl" />
            <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">Measured, not claimed</p>
            <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight">We test the forecaster on businesses it has never seen</h2>
            {bench === "unavailable" ? (
              <p className="mt-10 text-sm text-slate-400">Benchmark results could not be loaded right now. They are published in the app&apos;s SDG Impact page with full definitions.</p>
            ) : (
              <div className="mt-10 grid grid-cols-2 gap-8 md:grid-cols-4">
                {[
                  ["Synthetic test businesses", bench ? <Counter key="a" value={bench.businesses_evaluated} /> : "—"],
                  [`Shortages caught within ${bench?.horizon_days ?? 14} days`, bench ? <Counter key="b" value={bench.recall_pct} suffix="%" decimals={1} /> : "—"],
                  ["False alarms vs naive rule", bench ? <span key="c"><Counter value={bench.false_positive_rate_pct} suffix="%" decimals={1} /> <span className="text-base text-slate-400">vs {bench.naive_false_positive_rate_pct}%</span></span> : "—"],
                  ["Average early warning", bench?.avg_warning_lead_days ? <Counter key="d" value={bench.avg_warning_lead_days} suffix=" days" decimals={1} /> : "—"],
                ].map(([l, v], i) => (
                  <div key={i}><p className="text-3xl font-semibold md:text-4xl">{v}</p><p className="mt-1 text-sm text-slate-400">{l}</p></div>
                ))}
              </div>
            )}
            <p className="mt-8 max-w-3xl text-xs text-slate-500">
              {bench && bench !== "unavailable" && `The naive rule (cash minus recorded bills) catches ${bench.naive_recall_pct}% of shortages but warns ${bench.naive_false_positive_rate_pct}% of businesses that were fine; FinDost warns ${bench.false_positive_rate_pct}%. `}
              Measured on synthetic, held-out test businesses generated from our own assumptions — these figures describe the software&apos;s behaviour, not real-world outcomes.
            </p>
          </div>
        </Reveal>
      </section>

      {/* FOR WHOM */}
      <section id="for-whom" className="mx-auto max-w-7xl scroll-mt-20 px-5 pb-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-600">Who it&apos;s for</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Four account types, one login each</h2>
          <p className="mt-3 text-slate-600 dark:text-slate-400">Pick yours at sign-up. Your account type decides your modules, and your data stays yours.</p>
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {AUDIENCE.map((a, i) => (
            <Reveal key={a.kind} delay={i * 0.08}>
              <Link href={`/signup?type=${a.kind}`} className="group flex h-full flex-col rounded-2xl border border-slate-200 p-6 transition hover:-translate-y-1 hover:border-brand-400 hover:shadow-xl dark:border-slate-800">
                <a.icon className="h-7 w-7 text-brand-600 transition group-hover:scale-110" />
                <h3 className="mt-4 font-semibold">{a.title}</h3>
                <p className="urdu text-sm text-slate-400" lang="ur">{a.urdu}</p>
                <p className="mt-2 flex-1 text-sm text-slate-600 dark:text-slate-400">{a.text}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-700 dark:text-brand-400">Start <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" /></span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* SDG */}
      <section id="impact" className="scroll-mt-20 bg-slate-50 py-24 dark:bg-slate-950/60">
        <div className="mx-auto max-w-5xl px-5 text-center">
          <Reveal>
            <p className="text-sm font-semibold uppercase tracking-widest text-brand-600">Sustainable Development Goals</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Built toward resilience, measured honestly</h2>
            <p className="mx-auto mt-3 max-w-2xl text-slate-600 dark:text-slate-400">FinDost relates to these UN SDG targets. Software alone doesn&apos;t achieve them — the Impact Center separates what we measure from what we hope.</p>
          </Reveal>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            {SDGS.map((s, i) => (
              <Reveal key={s.t} delay={i * 0.06}>
                <div className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 text-left shadow-subtle dark:bg-slate-900">
                  <span className="rounded-lg px-2.5 py-1.5 text-sm font-bold text-white" style={{ background: s.c }}>{s.t}</span>
                  <span className="text-sm text-slate-700 dark:text-slate-300">{s.d}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-5 py-24">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-emerald-600 to-sky-700 px-6 py-16 text-center text-white">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_45%)]" />
            <h2 className="relative text-3xl font-semibold tracking-tight md:text-4xl">Your next cash crunch is predictable.</h2>
            <p className="urdu relative mt-3 text-xl text-emerald-50" lang="ur">آج ہی تیاری شروع کریں</p>
            <div className="relative mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/signup" className="rounded-lg bg-white px-6 py-3 text-sm font-semibold text-emerald-800 shadow-lg transition hover:scale-105">Create free account</Link>
              <Link href="/login" className="rounded-lg border border-white/50 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10">Explore a demo</Link>
            </div>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-slate-200 py-10 dark:border-slate-800">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-5 text-xs text-slate-500 md:flex-row">
          <Logo />
          <p className="max-w-xl text-center md:text-right">FinDost AI provides decision support, not financial advice, and does not replace a qualified accountant or adviser. Forecasts and simulations are estimates. Demo data is fictional. © {new Date().getFullYear()} FinDost AI · AICON&apos;26</p>
        </div>
      </footer>
    </div>
  );
}
