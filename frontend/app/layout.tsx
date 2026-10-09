import type { Metadata } from "next";
import "./globals.css";
import { AppProvider } from "@/lib/state/store";
import { LayoutShell } from "@/components/app-shell/layout-shell";

export const metadata: Metadata = {
  title: "FinDost AI — Financial Operations Assistant",
  description: "Financial operations and cash flow assistant for Pakistani students, households, SMEs, and enterprises.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased selection:bg-slate-200 selection:text-slate-900">
        <AppProvider>
          <LayoutShell>{children}</LayoutShell>
        </AppProvider>
      </body>
    </html>
  );
}
