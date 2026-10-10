import type { Metadata } from "next";
import { AppProvider } from "@/components/app/app-provider";
import { AppShell } from "@/components/app/shell";

// Private workspace pages: never indexed by search engines.
export const metadata: Metadata = { title: "Workspace", robots: { index: false, follow: false } };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
