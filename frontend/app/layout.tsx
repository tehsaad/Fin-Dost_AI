import type { Metadata, Viewport } from "next";
import { Inter, Noto_Nastaliq_Urdu } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const urdu = Noto_Nastaliq_Urdu({ subsets: ["arabic"], weight: ["400", "600"], variable: "--font-urdu", display: "swap" });

export const metadata: Metadata = {
  title: { default: "FinDost AI — See cash trouble before it happens", template: "%s · FinDost AI" },
  description:
    "AI-powered financial intelligence for Pakistani shops, micro-businesses, students and households: digital khata, cash-flow forecasting, early warnings, shock simulation and recovery planning.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#070b14" },
  ],
};

// Applies the saved theme before first paint (no light/dark flash).
const themeScript = `(function(){try{var t=localStorage.getItem('findost_theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${urdu.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans antialiased selection:bg-brand-200 selection:text-slate-900">{children}</body>
    </html>
  );
}
